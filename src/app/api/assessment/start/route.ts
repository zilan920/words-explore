import { z } from "zod";
import { startAssessmentSession } from "@/lib/assessment";
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
    const user = await storage.getUser(username);
    if (!user) {
      throw new Error("User not found");
    }
    const assessment = startAssessmentSession(user.learningGoal);
    await storage.startAssessment(username, assessment.sessionId);

    return ok({
      sessionId: assessment.sessionId,
      questions: assessment.questions.map((question) => ({
        id: question.id,
        word: question.word,
        difficulty: question.difficulty,
        options: question.options
      }))
    });
  } catch (error) {
    return fail(error);
  }
}
