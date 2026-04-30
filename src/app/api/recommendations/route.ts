import { z } from "zod";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { recommendWords } from "@/lib/llm/recommendations";
import { serverConfig } from "@/lib/serverConfig";
import {
  acquireRequestLock,
  enforceRateLimit,
  getClientIp,
  rateLimitKey,
  requireUserAuth
} from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema
});

export async function POST(request: Request) {
  try {
    const { username } = bodySchema.parse(await request.json());
    const storage = await getStorage();
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
    const releaseLock = await acquireRequestLock(
      storage,
      rateLimitKey("recommendations:lock", username),
      serverConfig.security.recommendationRateLimit.lockTtlMs
    );

    try {
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
    } finally {
      await releaseLock();
    }
  } catch (error) {
    return fail(error);
  }
}
