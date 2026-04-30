import { appConfig } from "@/lib/appConfig";
import { getLearningGoalLabel } from "@/lib/learningGoals";
import type { LearningContext } from "@/lib/types";

export const WORD_DELIMITER = "<<<WORD_DONE>>>";

export function buildRecommendationPrompt(context: LearningContext): string {
  const { wordBatchSize } = appConfig;

  return [
    `任务：为当前学习者推荐下一批 ${wordBatchSize} 个适合学习的英文词汇。`,
    "",
    "输出要求：",
    `- 每推荐 1 个单词，立刻输出 1 个独立 JSON object，然后单独输出一行分隔符 ${WORD_DELIMITER}。`,
    `- 总共必须输出 ${wordBatchSize} 个 JSON object。`,
    "- 不要输出 JSON array，不要输出 {\"words\": [...]} 包装对象，不要输出 Markdown。",
    "- 每个 JSON object 必须包含这些字段：word, partOfSpeech, definitionZh, exampleEn, exampleZh, difficultyReason, difficulty。",
    "- difficulty 必须是 1 到 10 的整数。",
    "- word 只能是英文单词、短语、空格或连字符，避免专有名词。",
    "",
    "筛选约束：",
    "- 推荐词必须贴合学习目标对应的考试/场景词库，优先给该目标高频词。",
    "- 不要推荐“已学会词”和“太简单词”中的词。",
    "- “继续学习词”可以再次出现，但优先推荐同难度的新词。",
    "- 避免和“最近出现词”中近 30 个词重复。",
    "- 中文释义要简洁，英文例句要自然，中文例句要准确对应英文例句。",
    "",
    "学习者信息：",
    `- 学习目标：${getLearningGoalLabel(context.learningGoal)}`,
    `- 估算等级：${context.estimatedLevel ?? "未完成初测"}`,
    `- 目标难度：${context.targetDifficulty}`,
    `- 已学会词：${formatWords(context.learnedWords)}`,
    `- 太简单词：${formatWords(context.tooEasyWords)}`,
    `- 继续学习词：${formatWords(context.learningWords)}`,
    `- 最近出现词：${formatWords(context.recentWords)}`,
    "",
    "单个 JSON object 示例：",
    "{",
    '  "word": "coherent",',
    '  "partOfSpeech": "adjective",',
    '  "definitionZh": "连贯的",',
    '  "exampleEn": "A coherent answer connects each idea logically.",',
    '  "exampleZh": "连贯的回答会把每个观点有逻辑地连接起来。",',
    '  "difficultyReason": "适合当前学习者练习抽象表达。",',
    '  "difficulty": 7',
    "}",
    WORD_DELIMITER
  ].join("\n");
}

function formatWords(words: string[]): string {
  return words.length > 0 ? words.join(", ") : "无";
}
