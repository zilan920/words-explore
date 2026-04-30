export const learningGoalOptions = [
  {
    id: "general",
    label: "通用提升",
    shortLabel: "通用",
    description: "日常、阅读和表达里的高频词"
  },
  {
    id: "cet4",
    label: "大学英语四级",
    shortLabel: "四级",
    description: "CET-4 高频核心词"
  },
  {
    id: "cet6",
    label: "大学英语六级",
    shortLabel: "六级",
    description: "CET-6 阅读和写作常见词"
  },
  {
    id: "ielts",
    label: "雅思",
    shortLabel: "雅思",
    description: "IELTS 学术和生活场景词"
  },
  {
    id: "toefl",
    label: "托福",
    shortLabel: "托福",
    description: "TOEFL 校园和学术词"
  }
] as const;

export type LearningGoal = (typeof learningGoalOptions)[number]["id"];

export const learningGoalIds = learningGoalOptions.map((goal) => goal.id) as [
  LearningGoal,
  ...LearningGoal[]
];

export const defaultLearningGoal: LearningGoal = "general";

export function isLearningGoal(value: string): value is LearningGoal {
  return learningGoalOptions.some((goal) => goal.id === value);
}

export function normalizeLearningGoal(value: string | null | undefined): LearningGoal {
  return value && isLearningGoal(value) ? value : defaultLearningGoal;
}

export function getLearningGoalLabel(goal: LearningGoal): string {
  return learningGoalOptions.find((option) => option.id === goal)?.label ?? "通用提升";
}

export function getLearningGoalShortLabel(goal: LearningGoal): string {
  return learningGoalOptions.find((option) => option.id === goal)?.shortLabel ?? "通用";
}
