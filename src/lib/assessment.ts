import { randomUUID } from "node:crypto";
import type { LearningGoal } from "@/lib/learningGoals";
import type { AssessmentQuestion } from "@/lib/types";

export const assessmentQuestionCount = 10;
export const questionsPerDifficulty = 5;

const assessmentDifficultyLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type AssessmentDifficulty = (typeof assessmentDifficultyLevels)[number];

interface QuestionSeed {
  word: string;
  correctAnswer: string;
  distractors: [string, string, string];
}

type AssessmentBankSeed = Record<AssessmentDifficulty, QuestionSeed[]>;

function q(
  word: string,
  correctAnswer: string,
  distractors: [string, string, string]
): QuestionSeed {
  return { word, correctAnswer, distractors };
}

const generalSeeds: AssessmentBankSeed = {
  1: [
    q("cat", "猫", ["帽子", "车", "地图"]),
    q("red", "红色的", ["寒冷的", "圆形的", "快速的"]),
    q("big", "大的", ["薄的", "新的", "干净的"]),
    q("run", "跑", ["读", "卖", "画"]),
    q("happy", "开心的", ["沉重的", "空的", "吵闹的"])
  ],
  2: [
    q("borrow", "借入", ["忘记", "修理", "购买"]),
    q("quiet", "安静的", ["明亮的", "昂贵的", "危险的"]),
    q("weather", "天气", ["财富", "重量", "周末"]),
    q("arrive", "到达", ["争论", "允许", "避免"]),
    q("choose", "选择", ["追逐", "改变", "关闭"])
  ],
  3: [
    q("ordinary", "普通的", ["危险的", "透明的", "遥远的"]),
    q("improve", "改善", ["证明", "涉及", "邀请"]),
    q("support", "支持", ["怀疑", "供应", "假设"]),
    q("reduce", "减少", ["重复", "拒绝", "营救"]),
    q("include", "包括", ["增加", "指示", "介绍"])
  ],
  4: [
    q("reluctant", "不情愿的", ["慷慨的", "准时的", "熟悉的"]),
    q("consequence", "后果", ["证据", "习惯", "边界"]),
    q("accurate", "准确的", ["尴尬的", "古老的", "可获得的"]),
    q("frequent", "频繁的", ["脆弱的", "正式的", "遥远的"]),
    q("organize", "组织", ["反对", "观察", "忽略"])
  ],
  5: [
    q("meticulous", "一丝不苟的", ["短暂的", "顽固的", "易碎的"]),
    q("ambiguous", "含糊的", ["持续的", "可信的", "猛烈的"]),
    q("efficient", "高效的", ["粗心的", "熟悉的", "空闲的"]),
    q("analyze", "分析", ["宣布", "道歉", "安排"]),
    q("maintain", "维持", ["迁移", "测量", "提到"])
  ],
  6: [
    q("resilient", "有复原力的", ["可疑的", "光滑的", "过时的"]),
    q("scrutinize", "仔细检查", ["公开宣布", "迅速离开", "轻声抱怨"]),
    q("substantial", "大量的", ["微妙的", "暂时的", "主观的"]),
    q("strategy", "策略", ["结构", "压力", "统计"]),
    q("encounter", "遇到", ["鼓励", "包围", "扩大"])
  ],
  7: [
    q("ubiquitous", "无处不在的", ["不可避免的", "难以置信的", "无关紧要的"]),
    q("pragmatic", "务实的", ["脆弱的", "傲慢的", "秘密的"]),
    q("coherent", "连贯的", ["冷漠的", "商业的", "偶然的"]),
    q("allocate", "分配", ["加速", "承认", "陪伴"]),
    q("diminish", "减少", ["区分", "分发", "决定"])
  ],
  8: [
    q("ephemeral", "短暂的", ["深刻的", "神圣的", "古老的"]),
    q("equanimity", "镇定", ["怨恨", "繁荣", "谨慎"]),
    q("plausible", "貌似合理的", ["可怜的", "可携带的", "可见的"]),
    q("imperative", "必要的", ["冲动的", "不完整的", "想象的"]),
    q("discrepancy", "差异", ["发现", "纪律", "折扣"])
  ],
  9: [
    q("perspicacious", "敏锐的", ["迟钝的", "奢华的", "鲁莽的"]),
    q("obfuscate", "使模糊", ["使加速", "使合法", "使平静"]),
    q("magnanimous", "宽宏大量的", ["恶意的", "机械的", "微不足道的"]),
    q("intractable", "难处理的", ["互动的", "直观的", "无形的"]),
    q("idiosyncratic", "特异的", ["理想化的", "工业的", "不合逻辑的"])
  ]
};

const cet4Seeds: AssessmentBankSeed = {
  1: [
    q("book", "书", ["账单", "盒子", "银行"]),
    q("class", "班级", ["玻璃", "云", "衣服"]),
    q("library", "图书馆", ["实验室", "宿舍", "大厅"]),
    q("student", "学生", ["员工", "陌生人", "游客"]),
    q("exam", "考试", ["例子", "练习", "借口"])
  ],
  2: [
    q("campus", "校园", ["现金", "章节", "机会"]),
    q("borrow", "借入", ["浏览", "打扰", "建造"]),
    q("average", "平均的", ["正式的", "古老的", "私人的"]),
    q("delay", "延误", ["设计", "争论", "捐赠"]),
    q("available", "可获得的", ["可疑的", "有害的", "严格的"])
  ],
  3: [
    q("efficient", "高效的", ["粗心的", "熟悉的", "空闲的"]),
    q("consume", "消耗", ["保护", "比较", "承认"]),
    q("indicate", "表明", ["忽略", "扩大", "拒绝"]),
    q("improve", "改善", ["证明", "包含", "进口"]),
    q("reduce", "减少", ["拒绝", "提醒", "重复"])
  ],
  4: [
    q("priority", "优先事项", ["许可证", "利润", "压力"]),
    q("sufficient", "足够的", ["临时的", "明显的", "复杂的"]),
    q("perspective", "观点", ["许可", "比例", "财产"]),
    q("environment", "环境", ["娱乐", "就业", "评价"]),
    q("community", "社区", ["委员会", "商品", "承诺"])
  ],
  5: [
    q("phenomenon", "现象", ["恐惧", "阶段", "哲学"]),
    q("concentrate", "集中", ["祝贺", "贡献", "连接"]),
    q("encourage", "鼓励", ["遇到", "扩大", "忍受"]),
    q("recognize", "认出，认可", ["推荐", "恢复", "减少"]),
    q("economy", "经济", ["生态", "平等", "效率"])
  ],
  6: [
    q("consequence", "后果", ["证据", "习惯", "边界"]),
    q("significant", "重要的", ["相似的", "沉默的", "简单的"]),
    q("responsibility", "责任", ["回应", "可能性", "资源"]),
    q("opportunity", "机会", ["反对", "义务", "操作"]),
    q("technology", "技术", ["地质", "术语", "理论"])
  ],
  7: [
    q("sustainable", "可持续的", ["可替代的", "可疑的", "敏感的"]),
    q("complicated", "复杂的", ["完整的", "竞争的", "礼貌的"]),
    q("professional", "专业的", ["个人的", "临时的", "实际的"]),
    q("communication", "交流", ["社区", "商品", "通勤"]),
    q("achievement", "成就", ["协议", "陪伴", "账户"])
  ],
  8: [
    q("interpret", "解释", ["打断", "干预", "介绍"]),
    q("tendency", "趋势", ["租期", "紧张", "温度"]),
    q("commercial", "商业的", ["普通的", "复杂的", "古典的"]),
    q("majority", "大多数", ["少数", "优先", "成熟"]),
    q("psychology", "心理学", ["生理学", "哲学", "摄影"])
  ],
  9: [
    q("criterion", "标准", ["批评", "危机", "课程"]),
    q("integrity", "正直，完整", ["强度", "兴趣", "相互作用"]),
    q("statistics", "统计数据", ["地位", "策略", "刺激"]),
    q("infrastructure", "基础设施", ["通货膨胀", "研究所", "说明书"]),
    q("innovation", "创新", ["通货膨胀", "干预", "调查"])
  ]
};

const cet6Seeds: AssessmentBankSeed = {
  1: [
    q("survey", "调查", ["服务", "安全", "供应"]),
    q("policy", "政策", ["礼貌", "诗歌", "警察"]),
    q("region", "地区", ["原因", "宗教", "制度"]),
    q("method", "方法", ["金属", "媒介", "成员"]),
    q("factor", "因素", ["工厂", "事实", "特征"])
  ],
  2: [
    q("currency", "货币", ["课程", "礼貌", "紧急"]),
    q("derive", "获得，源自", ["剥夺", "分发", "保留"]),
    q("notion", "概念", ["通知", "动机", "营养"]),
    q("stable", "稳定的", ["严重的", "微妙的", "浅的"]),
    q("expand", "扩展", ["解释", "出口", "暴露"])
  ],
  3: [
    q("initiative", "主动性", ["直觉", "感染", "机构"]),
    q("substitute", "替代品", ["订阅", "补贴", "地位"]),
    q("regulate", "管理，调节", ["注册", "后悔", "拒绝"]),
    q("evidence", "证据", ["事件", "进化", "例外"]),
    q("resource", "资源", ["度假村", "研究", "结果"])
  ],
  4: [
    q("controversial", "有争议的", ["保守的", "连续的", "方便的"]),
    q("substantial", "大量的", ["微妙的", "暂时的", "主观的"]),
    q("innovation", "创新", ["通货膨胀", "干预", "调查"]),
    q("obligation", "义务", ["观察", "机会", "反对"]),
    q("paradigm", "范式", ["悖论", "参数", "段落"])
  ],
  5: [
    q("welfare", "福利", ["战争", "财富", "仓库"]),
    q("dimension", "维度", ["决定", "捐赠", "方向"]),
    q("facilitate", "促进", ["伪造", "预测", "形成"]),
    q("inevitable", "不可避免的", ["隐形的", "不规则的", "非法的"]),
    q("preliminary", "初步的", ["主要的", "可预测的", "预防性的"])
  ],
  6: [
    q("empirical", "经验主义的", ["帝国的", "暂时的", "热情的"]),
    q("implicit", "含蓄的", ["明确的", "冲动的", "复杂的"]),
    q("coherent", "连贯的", ["冷漠的", "商业的", "偶然的"]),
    q("diminish", "减少", ["区分", "分发", "决定"]),
    q("allocate", "分配", ["加速", "承认", "陪伴"])
  ],
  7: [
    q("hierarchy", "等级制度", ["遗产", "假设", "和谐"]),
    q("incentive", "激励", ["事件", "本能", "发明"]),
    q("integrate", "整合", ["打断", "解释", "调查"]),
    q("constraint", "限制", ["建设", "一致", "合同"]),
    q("proposition", "主张，提议", ["比例", "财产", "反对"])
  ],
  8: [
    q("consensus", "共识", ["同意", "审查", "后果"]),
    q("marginal", "边缘的", ["宏大的", "机械的", "成熟的"]),
    q("orientation", "方向，取向", ["起源", "组织", "义务"]),
    q("resilience", "复原力", ["抵抗", "居住", "相似"]),
    q("scrutiny", "仔细审查", ["安全", "策略", "统计"])
  ],
  9: [
    q("juxtapose", "并置，对照", ["证明", "判断", "跳跃"]),
    q("ubiquitous", "无处不在的", ["不可避免的", "难以置信的", "无关紧要的"]),
    q("meticulous", "一丝不苟的", ["短暂的", "顽固的", "易碎的"]),
    q("ambiguity", "模糊性", ["雄心", "便利", "相似"]),
    q("exacerbate", "加剧", ["夸大", "交换", "耗尽"])
  ]
};

const ieltsSeeds: AssessmentBankSeed = {
  1: [
    q("map", "地图", ["餐食", "邮件", "会议"]),
    q("train", "火车", ["雨", "贸易", "训练"]),
    q("price", "价格", ["奖品", "练习", "压力"]),
    q("hotel", "酒店", ["医院", "历史", "假日"]),
    q("ticket", "票", ["任务", "话题", "技术"])
  ],
  2: [
    q("commute", "通勤", ["交流", "承诺", "计算"]),
    q("tourist", "游客", ["导师", "租户", "翻译"]),
    q("survey", "调查", ["服务", "安全", "供应"]),
    q("climate", "气候", ["客户", "文化", "候选"]),
    q("pollution", "污染", ["人口", "位置", "出版物"])
  ],
  3: [
    q("sustainable", "可持续的", ["可替代的", "可疑的", "敏感的"]),
    q("adequate", "足够的", ["准确的", "古代的", "尴尬的"]),
    q("urban", "城市的", ["紧急的", "统一的", "有用的"]),
    q("resource", "资源", ["度假村", "研究", "结果"]),
    q("benefit", "益处", ["边界", "负担", "预算"])
  ],
  4: [
    q("emission", "排放", ["使命", "遗漏", "许可"]),
    q("urbanization", "城市化", ["工业化", "全球化", "现代化"]),
    q("infrastructure", "基础设施", ["通货膨胀", "研究所", "说明书"]),
    q("proficiency", "熟练程度", ["利润", "偏好", "预防"]),
    q("environment", "环境", ["娱乐", "就业", "评价"])
  ],
  5: [
    q("deteriorate", "恶化", ["决定", "装饰", "检测"]),
    q("mitigate", "缓解", ["模仿", "迁移", "调解"]),
    q("fluctuate", "波动", ["流动", "形成", "预报"]),
    q("concentrate", "集中", ["祝贺", "贡献", "连接"]),
    q("alternative", "替代方案", ["态度", "分配", "联盟"])
  ],
  6: [
    q("sanitation", "卫生设施", ["制裁", "统计", "饱和"]),
    q("workforce", "劳动力", ["工作坊", "工作流程", "福利"]),
    q("biodiversity", "生物多样性", ["传记", "生物学", "边界"]),
    q("implement", "实施", ["暗示", "进口", "改善"]),
    q("attain", "获得，达到", ["尝试", "吸引", "参加"])
  ],
  7: [
    q("demographic", "人口统计的", ["民主的", "地理的", "图表的"]),
    q("renewable", "可再生的", ["可靠的", "可移动的", "可逆的"]),
    q("congestion", "拥堵", ["消费", "连接", "结论"]),
    q("ecosystem", "生态系统", ["经济", "效率", "平等"]),
    q("subsidy", "补贴", ["物质", "替代", "订阅"])
  ],
  8: [
    q("scarcity", "稀缺", ["安全", "严重", "策略"]),
    q("resilience", "复原力", ["抵抗", "居住", "相似"]),
    q("feasibility", "可行性", ["灵活性", "脆弱性", "熟悉度"]),
    q("disparity", "差距", ["纪律", "发现", "分布"]),
    q("intervention", "干预", ["发明", "调查", "介绍"])
  ],
  9: [
    q("anthropogenic", "人为造成的", ["人类学的", "考古的", "大气的"]),
    q("desertification", "荒漠化", ["认证", "分层", "简化"]),
    q("socioeconomic", "社会经济的", ["社会化的", "科学的", "系统性的"]),
    q("counterproductive", "适得其反的", ["合作的", "保守的", "有争议的"]),
    q("ubiquitous", "无处不在的", ["不可避免的", "难以置信的", "无关紧要的"])
  ]
};

const toeflSeeds: AssessmentBankSeed = {
  1: [
    q("lecture", "讲座", ["休闲", "法律", "实验室"]),
    q("campus", "校园", ["现金", "章节", "机会"]),
    q("dormitory", "宿舍", ["目录", "领域", "捐款"]),
    q("professor", "教授", ["专业人士", "利润", "提议"]),
    q("assignment", "作业", ["评估", "援助", "假设"])
  ],
  2: [
    q("hypothesis", "假设", ["强调", "习惯", "地平线"]),
    q("habitat", "栖息地", ["习惯", "港口", "收获"]),
    q("laboratory", "实验室", ["图书馆", "讲座", "位置"]),
    q("experiment", "实验", ["经验", "专家", "出口"]),
    q("species", "物种", ["空间", "特殊", "演讲"])
  ],
  3: [
    q("archaeology", "考古学", ["建筑学", "天文学", "人类学"]),
    q("photosynthesis", "光合作用", ["心理分析", "物理治疗", "地质运动"]),
    q("fossil", "化石", ["燃料", "公式", "森林"]),
    q("migration", "迁移", ["调解", "缓解", "使命"]),
    q("evidence", "证据", ["事件", "进化", "例外"])
  ],
  4: [
    q("empirical", "经验主义的", ["帝国的", "暂时的", "热情的"]),
    q("phenomenon", "现象", ["恐惧", "阶段", "哲学"]),
    q("predominant", "占主导的", ["可预测的", "初步的", "预防性的"]),
    q("theory", "理论", ["治疗", "剧院", "威胁"]),
    q("sample", "样本", ["符号", "简单", "供应"])
  ],
  5: [
    q("stratification", "分层", ["简化", "刺激", "稳定"]),
    q("corroborate", "证实", ["合作", "腐蚀", "庆祝"]),
    q("sediment", "沉积物", ["情绪", "部分", "句子"]),
    q("organism", "生物体", ["组织", "机制", "乐观主义"]),
    q("simulate", "模拟", ["刺激", "简化", "提交"])
  ],
  6: [
    q("synthesis", "合成", ["分析", "假设", "同情"]),
    q("adaptation", "适应", ["采用", "上瘾", "加法"]),
    q("cognitive", "认知的", ["集体的", "竞争的", "保守的"]),
    q("ecosystem", "生态系统", ["经济", "效率", "平等"]),
    q("mechanism", "机制", ["机械师", "媒体", "方法"])
  ],
  7: [
    q("terrestrial", "陆地的", ["领土的", "可怕的", "理论的"]),
    q("tectonic", "构造的", ["技术的", "战术的", "有毒的"]),
    q("inference", "推论", ["影响", "干预", "参考"]),
    q("variable", "变量", ["可见的", "可行的", "多样的"]),
    q("chronology", "年代顺序", ["气候学", "考古学", "生态学"])
  ],
  8: [
    q("diffusion", "扩散", ["分裂", "混乱", "决定"]),
    q("equilibrium", "平衡", ["等式", "设备", "平等"]),
    q("precipitation", "降水", ["参与", "预防", "预测"]),
    q("ritual", "仪式", ["常规", "农村", "角色"]),
    q("artifact", "人工制品", ["建筑师", "文章", "效果"])
  ],
  9: [
    q("paleolithic", "旧石器时代的", ["政治的", "病理的", "古生物的"]),
    q("bioluminescence", "生物发光", ["生物多样性", "传记", "生物学"]),
    q("symbiosis", "共生", ["综合", "符号", "症状"]),
    q("metamorphosis", "变态，蜕变", ["隐喻", "新陈代谢", "方法论"]),
    q("nomadic", "游牧的", ["规范的", "海洋的", "神经的"])
  ]
};

function buildAssessmentBank(prefix: string, seed: AssessmentBankSeed): AssessmentQuestion[] {
  return assessmentDifficultyLevels.flatMap((difficulty) =>
    seed[difficulty].map((question, index) => ({
      id: `${prefix}-${difficulty}-${index + 1}`,
      word: question.word,
      difficulty,
      correctAnswer: question.correctAnswer,
      options: [question.correctAnswer, ...question.distractors]
    }))
  );
}

export const assessmentBank = buildAssessmentBank("general", generalSeeds);

const goalAssessmentBanks: Record<LearningGoal, AssessmentQuestion[]> = {
  general: assessmentBank,
  cet4: buildAssessmentBank("cet4", cet4Seeds),
  cet6: buildAssessmentBank("cet6", cet6Seeds),
  ielts: buildAssessmentBank("ielts", ieltsSeeds),
  toefl: buildAssessmentBank("toefl", toeflSeeds)
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
  const onePerDifficulty = assessmentDifficultyLevels.flatMap((difficulty) =>
    shuffle(bank.filter((question) => question.difficulty === difficulty)).slice(0, 1)
  );
  const selectedIds = new Set(onePerDifficulty.map((question) => question.id));
  const extraQuestions = shuffle(
    bank.filter((question) => !selectedIds.has(question.id) && question.difficulty === 5)
  ).slice(0, assessmentQuestionCount - onePerDifficulty.length);
  const fallbackQuestions = shuffle(bank.filter((question) => !selectedIds.has(question.id))).slice(
    0,
    Math.max(0, assessmentQuestionCount - onePerDifficulty.length - extraQuestions.length)
  );
  const selected = shuffle([...onePerDifficulty, ...extraQuestions, ...fallbackQuestions])
    .slice(0, assessmentQuestionCount)
    .map(withShuffledOptions);

  return {
    sessionId: randomUUID(),
    questions: preventAllCorrectAnswersFirst(selected)
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

function withShuffledOptions(question: AssessmentQuestion): AssessmentQuestion {
  return {
    ...question,
    options: shuffle(question.options)
  };
}

function preventAllCorrectAnswersFirst(questions: AssessmentQuestion[]): AssessmentQuestion[] {
  if (!questions.every((question) => question.options[0] === question.correctAnswer)) {
    return questions;
  }

  const [firstQuestion, ...rest] = questions;
  if (!firstQuestion || firstQuestion.options.length < 2) {
    return questions;
  }

  return [
    {
      ...firstQuestion,
      options: [firstQuestion.options[1], firstQuestion.options[0], ...firstQuestion.options.slice(2)]
    },
    ...rest
  ];
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
