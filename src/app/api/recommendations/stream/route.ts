import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, usernameSchema, fail } from "@/lib/api";
import { appConfig } from "@/lib/appConfig";
import { getStorage, type StorageAdapter } from "@/lib/db/storage";
import { streamRecommendationWords, type RecommendationStreamEvent } from "@/lib/llm/recommendations";
import { serverConfig } from "@/lib/serverConfig";
import type { RecommendationBatchRow, WordRecordRow } from "@/lib/types";
import {
  acquireRequestLock,
  enforceRateLimit,
  getClientIp,
  rateLimitKey,
  requireUserAuth
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: usernameSchema,
  count: z.number().int().min(1).max(appConfig.wordBatchSize).default(appConfig.wordBatchSize)
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  let username = "";
  let requestedWords = appConfig.wordBatchSize;
  let storage!: StorageAdapter;
  let releaseLock!: () => Promise<void>;

  try {
    const body = bodySchema.parse(await request.json());
    username = body.username;
    requestedWords = body.count;
    storage = await getStorage();
    const clientIp = getClientIp(request);
    await requireUserAuth(request, storage, username);
    await enforceRateLimit(storage, {
      key: rateLimitKey("recommendations:user", username, clientIp),
      windowMs: serverConfig.security.recommendationRateLimit.windowMs,
      max: serverConfig.security.recommendationRateLimit.max
    });
    await enforceRateLimit(storage, {
      key: rateLimitKey("recommendations:ip", clientIp),
      ...serverConfig.security.recommendationIpRateLimit
    });
    await enforceRateLimit(storage, {
      key: rateLimitKey("recommendations:global"),
      ...serverConfig.security.recommendationGlobalRateLimit
    });
    releaseLock = await acquireRequestLock(
      storage,
      rateLimitKey("recommendations:lock", username),
      serverConfig.security.recommendationRateLimit.lockTtlMs
    );
    console.info("[api/recommendations/stream] accepted", {
      requestId,
      username,
      requestedWords
    });
  } catch (error) {
    console.warn("[api/recommendations/stream] rejected", {
      requestId,
      username: username || null,
      status: error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : null,
      error: error instanceof Error ? error.message : String(error)
    });
    return fail(error);
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown): boolean => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch (error) {
          closed = true;
          console.info("[api/recommendations/stream] client disconnected", {
            requestId,
            username,
            event,
            error: error instanceof Error ? error.message : String(error)
          });
          return false;
        }
      };
      const close = () => {
        if (closed) {
          return;
        }

        try {
          controller.close();
        } catch {
          // The client may have already closed the SSE connection.
        } finally {
          closed = true;
        }
      };

      void (async () => {
        try {
          const context = await storage.getLearningContext(username);
          let thinking = false;
          let lastBatch: RecommendationBatchRow | null = null;
          const persistedWords: WordRecordRow[] = [];
          const ensureStreamBatch = async (source: string): Promise<RecommendationBatchRow> => {
            if (lastBatch) {
              return lastBatch;
            }

            const persisted = await storage.createRecommendationBatch(
              username,
              [],
              source,
              context.targetDifficulty
            );
            lastBatch = persisted.batch;
            return persisted.batch;
          };
          console.info("[api/recommendations/stream] context loaded", {
            requestId,
            username,
            learningGoal: context.learningGoal,
            targetDifficulty: context.targetDifficulty,
            learnedWords: context.learnedWords.length,
            tooEasyWords: context.tooEasyWords.length,
            learningWords: context.learningWords.length,
            unreviewedWords: context.unreviewedWords.length,
            recentWords: context.recentWords.length
          });

          const result = await streamRecommendationWords(context, async (event: RecommendationStreamEvent) => {
            if (event.type === "start") {
              if (!send("status", {
                source: event.source,
                model: event.model,
                thinkingMode: event.thinking
              })) {
                return;
              }
              return;
            }

            if (event.type === "thinking") {
              thinking = true;
              send("thinking", { active: true });
              return;
            }

            if (event.type === "fallback") {
              if (closed) {
                return;
              }
              thinking = false;
              console.warn("[api/recommendations/stream] llm fallback", {
                requestId,
                username,
                reason: event.reason
              });
              send("fallback", { reason: event.reason });
              return;
            }

            if (closed) {
              return;
            }
            const batch = await ensureStreamBatch(event.source);
            const word = await storage.appendRecommendationWord(
              username,
              batch.id,
              event.word,
              persistedWords.length
            );
            persistedWords.push(word);
            send("word", {
              source: event.source,
              index: event.index,
              word
            });
          }, { requestId, wordCount: requestedWords });

          console.info("[api/recommendations/stream] persisted stream words", {
            requestId,
            username,
            source: result.source,
            wordCount: persistedWords.length,
            requestedWords
          });

          if (closed) {
            return;
          }

          if (persistedWords.length === 0 && result.words.length > 0) {
            const persisted = await storage.createRecommendationBatch(
              username,
              result.words,
              result.source,
              context.targetDifficulty
            );
            lastBatch = persisted.batch;
            persistedWords.push(...persisted.words);
          }
          const state = await storage.getUserState(username);

          console.info("[api/recommendations/stream] completed", {
            requestId,
            username,
            source: result.source,
            wordCount: persistedWords.length,
            batchId: lastBatch?.id ?? null,
            thinking
          });

          send("complete", {
            source: result.source,
            thinking,
            batch: lastBatch,
            words: persistedWords,
            state
          });
          close();
        } catch (error) {
          if (!closed) {
            console.warn("[api/recommendations/stream] failed", {
              requestId,
              username,
              error: error instanceof Error ? error.message : String(error)
            });
            send("error", { error: "推荐失败，请稍后再试" });
            close();
          }
        } finally {
          try {
            await releaseLock();
          } catch (error) {
            console.warn("[api/recommendations/stream] release lock failed", {
              requestId,
              username,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      })();
    },
    cancel() {
      closed = true;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
