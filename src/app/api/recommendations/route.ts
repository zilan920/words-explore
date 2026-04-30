import { z } from "zod";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { recommendWords } from "@/lib/llm/recommendations";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema
});

export async function POST(request: Request) {
  try {
    const { username } = bodySchema.parse(await request.json());
    const storage = await getStorage();
    const context = await storage.getLearningContext(username);
    const result = await recommendWords(context);
    const batch = await storage.createRecommendationBatch(
      username,
      result.words,
      result.source,
      context.targetDifficulty
    );
    const state = await storage.getUserState(username);

    console.info("[api/recommendations] completed", {
      username,
      source: result.source,
      wordCount: batch.words.length,
      batchId: batch.batch.id
    });

    return ok({
      source: result.source,
      batch: batch.batch,
      words: batch.words,
      state
    });
  } catch (error) {
    return fail(error);
  }
}
