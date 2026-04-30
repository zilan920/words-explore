import { describe, expect, it } from "vitest";
import {
  assessmentBank,
  getAssessmentBank,
  scoreAssessment,
  startAssessmentSession
} from "@/lib/assessment";
import { learningGoalOptions } from "@/lib/learningGoals";

describe("assessment", () => {
  it("starts a mixed 10 question assessment", () => {
    const session = startAssessmentSession();

    expect(session.questions).toHaveLength(10);
    expect(session.questions.some((question) => question.difficulty <= 3)).toBe(true);
    expect(session.questions.some((question) => question.difficulty >= 7)).toBe(true);
  });

  it("uses a goal-specific question bank", () => {
    for (const goal of learningGoalOptions) {
      const session = startAssessmentSession(goal.id);
      const bankIds = new Set(getAssessmentBank(goal.id).map((question) => question.id));

      expect(session.questions).toHaveLength(10);
      expect(session.questions.every((question) => bankIds.has(question.id))).toBe(true);
    }
  });

  it("scores answers and estimates a target difficulty", () => {
    const questions = assessmentBank.slice(0, 10);
    const result = scoreAssessment(
      "00000000-0000-4000-8000-000000000000",
      questions.map((question, index) => ({
        questionId: question.id,
        selectedAnswer: index < 7 ? question.correctAnswer : question.options[1]
      })),
      questions
    );

    expect(result.score).toBe(7);
    expect(result.estimatedLevel).toBe("熟练");
    expect(result.targetDifficulty).toBeGreaterThanOrEqual(2);
    expect(result.targetDifficulty).toBeLessThanOrEqual(9);
  });
});
