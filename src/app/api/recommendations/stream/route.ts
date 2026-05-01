import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, usernameSchema, fail } from "@/lib/api";
import { getStorage, type StorageAdapter } from "@/lib/db/storage";
import { streamRecommendationWords, type RecommendationStreamEvent } from "@/lib/llm/recommendations";
import { serverConfig } from "@/lib/serverConfig";
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
  username: usernameSchema
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  let username = "";
  let storage!: StorageAdapter;
  let releaseLock!: () => Promise<void>;

  try {
    const body = bodySchema.parse(await request.json());
    username = body.username;
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
      username
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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      void (async () => {
        try {
          const context = await storage.getLearningContext(username);
          let thinking = false;
          console.info("[api/recommendations/stream] context loaded", {
            requestId,
            username,
            learningGoal: context.learningGoal,
            targetDifficulty: context.targetDifficulty,
            learnedWords: context.learnedWords.length,
            tooEasyWords: context.tooEasyWords.length,
            learningWords: context.learningWords.length,
            recentWords: context.recentWords.length
          });

          const result = await streamRecommendationWords(context, (event: RecommendationStreamEvent) => {
            if (event.type === "start") {
              send("status", {
                source: event.source,
                model: event.model,
                thinkingMode: event.thinking
              });
              return;
            }

            if (event.type === "thinking") {
              thinking = true;
              send("thinking", { active: true });
              return;
            }

            if (event.type === "fallback") {
              thinking = false;
              console.warn("[api/recommendations/stream] llm fallback", {
                requestId,
                username,
                reason: event.reason
              });
              send("fallback", { reason: event.reason });
              return;
            }

            send("word", {
              source: event.source,
              index: event.index,
              word: event.word
            });
          }, { requestId });

          console.info("[api/recommendations/stream] creating batch", {
            requestId,
            username,
            source: result.source,
            wordCount: result.words.length
          });

          const batch = await storage.createRecommendationBatch(
            username,
            result.words,
            result.source,
            context.targetDifficulty
          );
          const state = await storage.getUserState(username);

          console.info("[api/recommendations/stream] completed", {
            requestId,
            username,
            source: result.source,
            wordCount: batch.words.length,
            batchId: batch.batch.id,
            thinking
          });

          send("complete", {
            source: result.source,
            thinking,
            batch: batch.batch,
            words: batch.words,
            state
          });
          controller.close();
        } catch (error) {
          console.warn("[api/recommendations/stream] failed", {
            requestId,
            username,
            error: error instanceof Error ? error.message : String(error)
          });
          send("error", { error: "推荐失败，请稍后再试" });
          controller.close();
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
