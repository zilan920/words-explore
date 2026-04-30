import { z } from "zod";
import { scoreAssessment } from "@/lib/assessment";
import { usernameSchema, fail, ok } from "@/lib/api";
import { getStorage } from "@/lib/db/storage";
import { requireUserAuth } from "@/lib/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: usernameSchema,
  sessionId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        selectedAnswer: z.string().min(1)
      })
    )
    .length(10)
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = scoreAssessment(body.sessionId, body.answers);
    const storage = await getStorage();

    await requireUserAuth(request, storage, body.username);
    await storage.saveAssessmentResult(body.username, result);

    const state = await storage.getUserState(body.username);
    return ok({
      score: result.score,
      estimatedLevel: result.estimatedLevel,
      targetDifficulty: result.targetDifficulty,
      answers: result.answers.map((answer) => ({
        questionId: answer.question.id,
        word: answer.question.word,
        selectedAnswer: answer.selectedAnswer,
        correctAnswer: answer.question.correctAnswer,
        isCorrect: answer.isCorrect
      })),
      state
    });
  } catch (error) {
    return fail(error);
  }
}
