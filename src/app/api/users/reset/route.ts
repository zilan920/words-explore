import { z } from "zod";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { requireUserAuth } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema
});

export async function POST(request: Request) {
  try {
    const { username } = bodySchema.parse(await request.json());
    const storage = await getStorage();
    await requireUserAuth(request, storage, username);
    const user = await storage.resetUserData(username);
    const state = await storage.getUserState(user.username);

    return ok({ user, state });
  } catch (error) {
    return fail(error);
  }
}
