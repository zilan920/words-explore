import { randomUUID } from "node:crypto";
import type { AssessmentQuestion } from "@/lib/types";

export const assessmentBank: AssessmentQuestion[] = [
  {
    id: "a1",
    word: "tiny",
    difficulty: 1,
    correctAnswer: "很小的",
    options: ["很小的", "昂贵的", "潮湿的", "安静的"]
  },
  {
    id: "a2",
    word: "borrow",
    difficulty: 2,
    correctAnswer: "借入",
    options: ["借入", "忘记", "修理", "购买"]
  },
  {
    id: "a3",
    word: "ordinary",
    difficulty: 3,
    correctAnswer: "普通的",
    options: ["普通的", "危险的", "透明的", "遥远的"]
  },
  {
    id: "a4",
    word: "reluctant",
    difficulty: 4,
    correctAnswer: "不情愿的",
    options: ["不情愿的", "慷慨的", "准时的", "熟悉的"]
  },
  {
    id: "a5",
    word: "consequence",
    difficulty: 4,
    correctAnswer: "后果",
    options: ["后果", "证据", "习惯", "边界"]
  },
  {
    id: "a6",
    word: "meticulous",
    difficulty: 5,
    correctAnswer: "一丝不苟的",
    options: ["一丝不苟的", "短暂的", "顽固的", "易碎的"]
  },
  {
    id: "a7",
    word: "ambiguous",
    difficulty: 5,
    correctAnswer: "含糊的",
    options: ["含糊的", "持续的", "可信的", "猛烈的"]
  },
  {
    id: "a8",
    word: "resilient",
    difficulty: 6,
    correctAnswer: "有复原力的",
    options: ["有复原力的", "可疑的", "光滑的", "过时的"]
  },
  {
    id: "a9",
    word: "scrutinize",
    difficulty: 6,
    correctAnswer: "仔细检查",
    options: ["仔细检查", "公开宣布", "迅速离开", "轻声抱怨"]
  },
  {
    id: "a10",
    word: "ubiquitous",
    difficulty: 7,
    correctAnswer: "无处不在的",
    options: ["无处不在的", "不可避免的", "难以置信的", "无关紧要的"]
  },
  {
    id: "a11",
    word: "pragmatic",
    difficulty: 7,
    correctAnswer: "务实的",
    options: ["务实的", "脆弱的", "傲慢的", "秘密的"]
  },
  {
    id: "a12",
    word: "ephemeral",
    difficulty: 8,
    correctAnswer: "短暂的",
    options: ["短暂的", "深刻的", "神圣的", "古老的"]
  },
  {
    id: "a13",
    word: "equanimity",
    difficulty: 8,
    correctAnswer: "镇定",
    options: ["镇定", "怨恨", "繁荣", "谨慎"]
  },
  {
    id: "a14",
    word: "perspicacious",
    difficulty: 9,
    correctAnswer: "敏锐的",
    options: ["敏锐的", "迟钝的", "奢华的", "鲁莽的"]
  },
  {
    id: "a15",
    word: "obfuscate",
    difficulty: 9,
    correctAnswer: "使模糊",
    options: ["使模糊", "使加速", "使合法", "使平静"]
  }
];

export interface AssessmentStart {
  sessionId: string;
  questions: AssessmentQuestion[];
}

export interface SubmittedAnswer {
  questionId: string;
  selectedAnswer: string;
}

export interface ScoredAnswer {
  question: AssessmentQuestion;
  selectedAnswer: string;
  isCorrect: boolean;
}

export interface AssessmentScore {
  sessionId: string;
  score: number;
  estimatedLevel: string;
  targetDifficulty: number;
  answers: ScoredAnswer[];
}

export function startAssessmentSession(): AssessmentStart {
  const easy = shuffle(assessmentBank.filter((question) => question.difficulty <= 3)).slice(0, 3);
  const mid = shuffle(
    assessmentBank.filter((question) => question.difficulty >= 4 && question.difficulty <= 6)
  ).slice(0, 4);
  const hard = shuffle(assessmentBank.filter((question) => question.difficulty >= 7)).slice(0, 3);

  return {
    sessionId: randomUUID(),
    questions: shuffle([...easy, ...mid, ...hard])
  };
}

export function scoreAssessment(
  sessionId: string,
  answers: SubmittedAnswer[],
  questions = assessmentBank
): AssessmentScore {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const scoredAnswers = answers.map((answer) => {
    const question = questionMap.get(answer.questionId);

    if (!question) {
      throw new Error(`Unknown assessment question: ${answer.questionId}`);
    }

    return {
      question,
      selectedAnswer: answer.selectedAnswer,
      isCorrect: answer.selectedAnswer === question.correctAnswer
    };
  });

  const score = scoredAnswers.filter((answer) => answer.isCorrect).length;
  const correctDifficulty = scoredAnswers
    .filter((answer) => answer.isCorrect)
    .reduce((sum, answer) => sum + answer.question.difficulty, 0);
  const missedDifficulty = scoredAnswers
    .filter((answer) => !answer.isCorrect)
    .reduce((sum, answer) => sum + answer.question.difficulty, 0);

  const weighted = correctDifficulty / Math.max(1, scoredAnswers.length);
  const penalty = missedDifficulty > 0 ? 0.5 : 0;
  const targetDifficulty = clamp(Math.round(weighted + 3 - penalty), 2, 9);
  const estimatedLevel =
    score <= 3 ? "入门" : score <= 6 ? "进阶" : score <= 8 ? "熟练" : "高阶";

  return {
    sessionId,
    score,
    estimatedLevel,
    targetDifficulty,
    answers: scoredAnswers
  };
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
