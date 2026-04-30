import { z } from "zod";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { learningGoalIds } from "@/lib/learningGoals";
import { requireUserAuth } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema,
  learningGoal: z.enum(learningGoalIds)
});

export async function POST(request: Request) {
  try {
    const { username, learningGoal } = bodySchema.parse(await request.json());
    const storage = await getStorage();
    await requireUserAuth(request, storage, username);
    const user = await storage.updateLearningGoal(username, learningGoal);
    const state = await storage.getUserState(user.username);

    return ok({ user, state });
  } catch (error) {
    return fail(error);
  }
}
