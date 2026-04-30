import { randomUUID } from "node:crypto";
import type { LearningGoal } from "@/lib/learningGoals";
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

const goalAssessmentBanks: Record<LearningGoal, AssessmentQuestion[]> = {
  general: assessmentBank,
  cet4: [
    {
      id: "cet4-1",
      word: "campus",
      difficulty: 2,
      correctAnswer: "校园",
      options: ["校园", "现金", "章节", "机会"]
    },
    {
      id: "cet4-2",
      word: "average",
      difficulty: 3,
      correctAnswer: "平均的",
      options: ["平均的", "正式的", "古老的", "私人的"]
    },
    {
      id: "cet4-3",
      word: "delay",
      difficulty: 3,
      correctAnswer: "延误",
      options: ["延误", "设计", "争论", "捐赠"]
    },
    {
      id: "cet4-4",
      word: "efficient",
      difficulty: 4,
      correctAnswer: "高效的",
      options: ["高效的", "粗心的", "熟悉的", "空闲的"]
    },
    {
      id: "cet4-5",
      word: "available",
      difficulty: 4,
      correctAnswer: "可获得的",
      options: ["可获得的", "可疑的", "有害的", "严格的"]
    },
    {
      id: "cet4-6",
      word: "consume",
      difficulty: 5,
      correctAnswer: "消耗",
      options: ["消耗", "保护", "比较", "承认"]
    },
    {
      id: "cet4-7",
      word: "indicate",
      difficulty: 5,
      correctAnswer: "表明",
      options: ["表明", "忽略", "扩大", "拒绝"]
    },
    {
      id: "cet4-8",
      word: "priority",
      difficulty: 6,
      correctAnswer: "优先事项",
      options: ["优先事项", "许可证", "利润", "压力"]
    },
    {
      id: "cet4-9",
      word: "sufficient",
      difficulty: 6,
      correctAnswer: "足够的",
      options: ["足够的", "临时的", "明显的", "复杂的"]
    },
    {
      id: "cet4-10",
      word: "perspective",
      difficulty: 7,
      correctAnswer: "观点",
      options: ["观点", "许可", "比例", "财产"]
    }
  ],
  cet6: [
    {
      id: "cet6-1",
      word: "notion",
      difficulty: 3,
      correctAnswer: "概念",
      options: ["概念", "通知", "动机", "营养"]
    },
    {
      id: "cet6-2",
      word: "currency",
      difficulty: 4,
      correctAnswer: "货币",
      options: ["货币", "课程", "礼貌", "紧急"]
    },
    {
      id: "cet6-3",
      word: "derive",
      difficulty: 4,
      correctAnswer: "获得，源自",
      options: ["获得，源自", "剥夺", "分发", "保留"]
    },
    {
      id: "cet6-4",
      word: "initiative",
      difficulty: 5,
      correctAnswer: "主动性",
      options: ["主动性", "直觉", "感染", "机构"]
    },
    {
      id: "cet6-5",
      word: "substitute",
      difficulty: 5,
      correctAnswer: "替代品",
      options: ["替代品", "订阅", "补贴", "地位"]
    },
    {
      id: "cet6-6",
      word: "controversial",
      difficulty: 6,
      correctAnswer: "有争议的",
      options: ["有争议的", "保守的", "连续的", "方便的"]
    },
    {
      id: "cet6-7",
      word: "substantial",
      difficulty: 6,
      correctAnswer: "大量的",
      options: ["大量的", "微妙的", "暂时的", "主观的"]
    },
    {
      id: "cet6-8",
      word: "innovation",
      difficulty: 7,
      correctAnswer: "创新",
      options: ["创新", "通货膨胀", "干预", "调查"]
    },
    {
      id: "cet6-9",
      word: "obligation",
      difficulty: 7,
      correctAnswer: "义务",
      options: ["义务", "观察", "机会", "反对"]
    },
    {
      id: "cet6-10",
      word: "paradigm",
      difficulty: 8,
      correctAnswer: "范式",
      options: ["范式", "悖论", "参数", "段落"]
    }
  ],
  ielts: [
    {
      id: "ielts-1",
      word: "accommodation",
      difficulty: 4,
      correctAnswer: "住宿",
      options: ["住宿", "成就", "陪伴", "账户"]
    },
    {
      id: "ielts-2",
      word: "commute",
      difficulty: 4,
      correctAnswer: "通勤",
      options: ["通勤", "交流", "承诺", "计算"]
    },
    {
      id: "ielts-3",
      word: "sustainable",
      difficulty: 5,
      correctAnswer: "可持续的",
      options: ["可持续的", "可替代的", "可疑的", "敏感的"]
    },
    {
      id: "ielts-4",
      word: "adequate",
      difficulty: 5,
      correctAnswer: "足够的",
      options: ["足够的", "准确的", "古代的", "尴尬的"]
    },
    {
      id: "ielts-5",
      word: "urbanization",
      difficulty: 6,
      correctAnswer: "城市化",
      options: ["城市化", "工业化", "全球化", "现代化"]
    },
    {
      id: "ielts-6",
      word: "emission",
      difficulty: 6,
      correctAnswer: "排放",
      options: ["排放", "使命", "遗漏", "许可"]
    },
    {
      id: "ielts-7",
      word: "infrastructure",
      difficulty: 7,
      correctAnswer: "基础设施",
      options: ["基础设施", "通货膨胀", "研究所", "说明书"]
    },
    {
      id: "ielts-8",
      word: "proficiency",
      difficulty: 7,
      correctAnswer: "熟练程度",
      options: ["熟练程度", "利润", "偏好", "预防"]
    },
    {
      id: "ielts-9",
      word: "deteriorate",
      difficulty: 8,
      correctAnswer: "恶化",
      options: ["恶化", "决定", "装饰", "检测"]
    },
    {
      id: "ielts-10",
      word: "mitigate",
      difficulty: 8,
      correctAnswer: "缓解",
      options: ["缓解", "模仿", "迁移", "调解"]
    }
  ],
  toefl: [
    {
      id: "toefl-1",
      word: "lecture",
      difficulty: 3,
      correctAnswer: "讲座",
      options: ["讲座", "休闲", "法律", "实验室"]
    },
    {
      id: "toefl-2",
      word: "hypothesis",
      difficulty: 5,
      correctAnswer: "假设",
      options: ["假设", "强调", "习惯", "地平线"]
    },
    {
      id: "toefl-3",
      word: "habitat",
      difficulty: 5,
      correctAnswer: "栖息地",
      options: ["栖息地", "习惯", "港口", "收获"]
    },
    {
      id: "toefl-4",
      word: "archaeology",
      difficulty: 6,
      correctAnswer: "考古学",
      options: ["考古学", "建筑学", "天文学", "人类学"]
    },
    {
      id: "toefl-5",
      word: "photosynthesis",
      difficulty: 6,
      correctAnswer: "光合作用",
      options: ["光合作用", "心理分析", "物理治疗", "地质运动"]
    },
    {
      id: "toefl-6",
      word: "empirical",
      difficulty: 7,
      correctAnswer: "经验主义的",
      options: ["经验主义的", "帝国的", "暂时的", "热情的"]
    },
    {
      id: "toefl-7",
      word: "phenomenon",
      difficulty: 7,
      correctAnswer: "现象",
      options: ["现象", "恐惧", "阶段", "哲学"]
    },
    {
      id: "toefl-8",
      word: "predominant",
      difficulty: 8,
      correctAnswer: "占主导的",
      options: ["占主导的", "可预测的", "初步的", "预防性的"]
    },
    {
      id: "toefl-9",
      word: "stratification",
      difficulty: 8,
      correctAnswer: "分层",
      options: ["分层", "简化", "刺激", "稳定"]
    },
    {
      id: "toefl-10",
      word: "corroborate",
      difficulty: 9,
      correctAnswer: "证实",
      options: ["证实", "合作", "腐蚀", "庆祝"]
    }
  ]
};

export const allAssessmentQuestions = Object.values(goalAssessmentBanks).flat();

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

export function getAssessmentBank(goal: LearningGoal): AssessmentQuestion[] {
  return goalAssessmentBanks[goal] ?? assessmentBank;
}

export function startAssessmentSession(goal: LearningGoal = "general"): AssessmentStart {
  const bank = getAssessmentBank(goal);
  const seeded = [
    ...shuffle(bank.filter((question) => question.difficulty <= 3)).slice(0, 3),
    ...shuffle(
      bank.filter((question) => question.difficulty >= 4 && question.difficulty <= 6)
    ).slice(0, 4),
    ...shuffle(bank.filter((question) => question.difficulty >= 7)).slice(0, 3)
  ];
  const selectedIds = new Set(seeded.map((question) => question.id));
  const fill = shuffle(bank.filter((question) => !selectedIds.has(question.id))).slice(
    0,
    Math.max(0, 10 - seeded.length)
  );

  return {
    sessionId: randomUUID(),
    questions: shuffle([...seeded, ...fill])
  };
}

export function scoreAssessment(
  sessionId: string,
  answers: SubmittedAnswer[],
  questions = allAssessmentQuestions
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
