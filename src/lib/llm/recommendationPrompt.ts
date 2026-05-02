import { getLearningGoalLabel } from "@/lib/learningGoals";
import type { LearningContext } from "@/lib/types";

export const WORD_DELIMITER = "<<<WORD_DONE>>>";

export interface RecommendationPromptOptions {
  acquiredWords?: string[];
  wordCount?: number;
}

export function buildRecommendationPrompt(
  context: LearningContext,
  options: RecommendationPromptOptions = {}
): string {
  const acquiredWords = uniqueWords([...context.unreviewedWords, ...(options.acquiredWords ?? [])]);
  const wordCount = options.wordCount ?? 1;

  // Keep stable instructions first so repeated one-word requests can reuse provider prompt cache.
  return [
    `任务：使用 JSON 格式返回推荐 ${wordCount} 个基于用户目前学习进度的适合学习的英文词汇，新词的目的在于提升词汇量。`,
    "",
    "**要求：**",
    "- 只输出 1 个 JSON object，不要输出 Markdown，不要额外解释。",
    `- JSON object 必须是 {"words": [...]}，words 必须是长度为 ${wordCount} 的 JSON array。`,
    "- words 数组中的每个 object 必须包含这些字段：word, partOfSpeech, definitionZh, exampleEn, exampleZh, difficultyReason, difficulty。",
    "- difficulty 必须是 1 到 10 的整数。",
    "- word 只能是英文单词、短语、空格或连字符，避免专有名词。",
    "",
    "筛选约束：",
    "- 推荐词必须贴合学习目标对应的考试/场景词库，优先给该目标高频词。",
    "- 不要推荐“学会的单词”“太简单的单词”“已获取但还没有反馈的单词”中的词。",
    "- “生词簿”中的词可以再次出现，但优先推荐同难度的新词。",
    "- 中文释义要简洁，英文例句要自然，中文例句要准确对应英文例句。",
    "",
    "JSON object 示例：",
    "{",
    '  "words": [',
    "    {",
    '      "word": "coherent",',
    '      "partOfSpeech": "adjective",',
    '      "definitionZh": "连贯的",',
    '      "exampleEn": "A coherent answer connects each idea logically.",',
    '      "exampleZh": "连贯的回答会把每个观点有逻辑地连接起来。",',
    '      "difficultyReason": "适合当前学习者练习抽象表达。",',
    '      "difficulty": 7',
    "    }",
    "  ]",
    "}",
    "",
    "学习者信息：",
    `- 学习目标：${getLearningGoalLabel(context.learningGoal)}`,
    `- 估算等级：${context.estimatedLevel ?? "未完成初测"}`,
    `- 目标难度：${context.targetDifficulty}`,
    `- 学会的单词：${formatWords(context.learnedWords)}`,
    `- 太简单的单词：${formatWords(context.tooEasyWords)}`,
    `- 生词簿：${formatWords(context.learningWords)}`,
    `- 已获取但还没有反馈的单词：${formatWords(acquiredWords)}`
  ].join("\n");
}

function formatWords(words: string[]): string {
  return words.length > 0 ? words.join(", ") : "无";
}

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
