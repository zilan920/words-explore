import type { LearningGoal } from "@/lib/learningGoals";

export type WordAction = "learned" | "too_easy" | "learning";

export type WordStatus = "new" | WordAction;

export interface UserRow {
  username: string;
  createdAt: string;
  learningGoal: LearningGoal;
  targetDifficulty: number | null;
  estimatedLevel: string | null;
  assessmentCompletedAt: string | null;
}

export interface AssessmentQuestion {
  id: string;
  word: string;
  difficulty: number;
  correctAnswer: string;
  options: string[];
}

export interface AssessmentSessionRow {
  id: string;
  username: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  estimatedLevel: string | null;
  targetDifficulty: number | null;
}

export interface AssessmentAnswerRow {
  id: string;
  sessionId: string;
  username: string;
  questionId: string;
  word: string;
  correctAnswer: string;
  selectedAnswer: string;
  isCorrect: number;
  difficulty: number;
}

export interface RecommendationWordInput {
  word: string;
  partOfSpeech: string;
  definitionZh: string;
  exampleEn: string;
  exampleZh: string;
  difficultyReason: string;
  difficulty: number;
}

export interface RecommendationBatchRow {
  id: string;
  username: string;
  createdAt: string;
  source: string;
  targetDifficulty: number;
}

export interface WordRecordRow extends RecommendationWordInput {
  id: string;
  batchId: string;
  username: string;
  status: WordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WordActionRow {
  id: string;
  wordId: string;
  username: string;
  action: WordAction;
  createdAt: string;
}

export interface UserState {
  user: UserRow;
  latestBatch: RecommendationBatchRow | null;
  latestWords: WordRecordRow[];
  history: WordRecordRow[];
  stats: {
    totalWords: number;
    learned: number;
    tooEasy: number;
    learning: number;
  };
}

export interface LearningContext {
  learningGoal: LearningGoal;
  targetDifficulty: number;
  estimatedLevel: string | null;
  learnedWords: string[];
  tooEasyWords: string[];
  learningWords: string[];
  unreviewedWords: string[];
  recentWords: string[];
}

export interface UserBundle {
  user: UserRow;
  assessmentSessions: AssessmentSessionRow[];
  assessmentAnswers: AssessmentAnswerRow[];
  recommendationBatches: RecommendationBatchRow[];
  wordRecords: WordRecordRow[];
  wordActions: WordActionRow[];
}
