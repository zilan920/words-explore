import { z } from "zod";
import { usernameSchema, fail } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { streamRecommendationWords, type RecommendationStreamEvent } from "@/lib/llm/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: usernameSchema
});

export async function POST(request: Request) {
  let username: string;

  try {
    const body = bodySchema.parse(await request.json());
    username = body.username;
  } catch (error) {
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
          const storage = await getStorage();
          const context = await storage.getLearningContext(username);
          let thinking = false;

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
              send("fallback", { reason: event.reason });
              return;
            }

            send("word", {
              source: event.source,
              index: event.index,
              word: event.word
            });
          });

          const batch = await storage.createRecommendationBatch(
            username,
            result.words,
            result.source,
            context.targetDifficulty
          );
          const state = await storage.getUserState(username);

          console.info("[api/recommendations/stream] completed", {
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
          const message = error instanceof Error ? error.message : "推荐失败";
          console.warn("[api/recommendations/stream] failed", {
            username,
            error: message
          });
          send("error", { error: message });
          controller.close();
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
