import { z } from "zod";
import { ApiError, usernameSchema, fail, ok } from "@/lib/api";
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
    const state = await storage.getUserState(username);

    if (!state) {
      return fail(new ApiError(404, "用户不存在"));
    }

    return ok({ state });
  } catch (error) {
    return fail(error);
  }
}
