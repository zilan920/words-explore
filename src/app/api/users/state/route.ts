import { z } from "zod";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema
});

export async function POST(request: Request) {
  try {
    const { username } = bodySchema.parse(await request.json());
    const storage = await getStorage();
    const state = await storage.getUserState(username);

    if (!state) {
      return fail(new Error("User not found"), 404);
    }

    return ok({ state });
  } catch (error) {
    return fail(error);
  }
}
