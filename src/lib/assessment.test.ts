import { describe, expect, it } from "vitest";
import {
  assessmentBank,
  getAssessmentBank,
  scoreAssessment,
  startAssessmentSession
} from "@/lib/assessment";
import { learningGoalOptions } from "@/lib/learningGoals";

describe("assessment", () => {
  it("starts a 10 question assessment that covers every difficulty level", () => {
    const session = startAssessmentSession();
    const difficulties = new Set(session.questions.map((question) => question.difficulty));

    expect(session.questions).toHaveLength(10);
    expect([...difficulties].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(session.questions.every((question) => question.options[0] === question.correctAnswer)).toBe(false);
  });

  it("uses an expanded goal-specific question bank", () => {
    for (const goal of learningGoalOptions) {
      const session = startAssessmentSession(goal.id);
      const bank = getAssessmentBank(goal.id);
      const bankIds = new Set(bank.map((question) => question.id));

      for (let difficulty = 1; difficulty <= 9; difficulty += 1) {
        expect(bank.filter((question) => question.difficulty === difficulty)).toHaveLength(5);
      }
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
