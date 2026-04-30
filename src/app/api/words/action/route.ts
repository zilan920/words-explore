import { z } from "zod";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { requireUserAuth } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema,
  wordId: z.string().uuid(),
  action: z.enum(["learned", "too_easy", "learning"])
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const storage = await getStorage();
    await requireUserAuth(request, storage, body.username);
    const word = await storage.recordWordAction(body.username, body.wordId, body.action);
    const state = await storage.getUserState(body.username);

    return ok({ word, state });
  } catch (error) {
    return fail(error);
  }
}
