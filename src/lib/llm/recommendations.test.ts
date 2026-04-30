import { describe, expect, it } from "vitest";
import { appConfig } from "@/lib/appConfig";
import { buildRecommendationPrompt, WORD_DELIMITER } from "@/lib/llm/recommendationPrompt";
import {
  consumeDelimitedRecommendationWords,
  parseRecommendationText,
  resolveLlmConfig,
  validateRecommendationWords
} from "@/lib/llm/recommendations";
import { serverConfig, type ServerLlmConfig } from "@/lib/serverConfig";

const baseWord = {
  word: "coherent",
  partOfSpeech: "adjective",
  definitionZh: "连贯的",
  exampleEn: "A coherent answer connects each idea logically.",
  exampleZh: "连贯的回答会把每个观点连接起来。",
  difficultyReason: "适合当前难度。",
  difficulty: 7
};

function testWord(index: number): string {
  let cursor = index;
  let suffix = "";

  do {
    suffix = String.fromCharCode(97 + (cursor % 26)) + suffix;
    cursor = Math.floor(cursor / 26) - 1;
  } while (cursor >= 0);

  return `word ${suffix}`;
}

describe("recommendation validation", () => {
  it("accepts exactly the configured number of unique words", () => {
    const payload = {
      words: Array.from({ length: appConfig.wordBatchSize }, (_, index) => ({
        ...baseWord,
        word: testWord(index)
      }))
    };

    expect(validateRecommendationWords(payload)).toHaveLength(appConfig.wordBatchSize);
  });

  it("rejects duplicate words", () => {
    const payload = {
      words: Array.from({ length: appConfig.wordBatchSize }, () => baseWord)
    };

    if (appConfig.wordBatchSize > 1) {
      expect(() => validateRecommendationWords(payload)).toThrow(/Duplicate/);
    } else {
      expect(validateRecommendationWords(payload)).toHaveLength(appConfig.wordBatchSize);
    }
  });

  it("parses complete delimited word segments and keeps the incomplete remainder", () => {
    const first = { ...baseWord, word: "coherent" };
    const second = { ...baseWord, word: "subtle" };
    const parsed = consumeDelimitedRecommendationWords(
      `${JSON.stringify(first)}\n${WORD_DELIMITER}\n${JSON.stringify(second)}`
    );

    expect(parsed.words).toEqual([first]);
    expect(parsed.remainder).toContain("subtle");
  });

  it("accepts a full delimited LLM response", () => {
    const content = Array.from({ length: appConfig.wordBatchSize }, (_, index) => ({
      ...baseWord,
      word: testWord(index)
    }))
      .map((word) => `${JSON.stringify(word)}\n${WORD_DELIMITER}`)
      .join("\n");

    expect(parseRecommendationText(content)).toHaveLength(appConfig.wordBatchSize);
  });
});

describe("recommendation prompt", () => {
  it("uses plain text instructions with the streaming delimiter", () => {
    const prompt = buildRecommendationPrompt({
      targetDifficulty: 7,
      estimatedLevel: "B2",
      learnedWords: ["coherent"],
      tooEasyWords: ["simple"],
      learningWords: ["nuance"],
      recentWords: ["subtle"]
    });

    expect(prompt.trim().startsWith("{")).toBe(false);
    expect(prompt).toContain(WORD_DELIMITER);
    expect(prompt).toContain(`推荐下一批 ${appConfig.wordBatchSize} 个`);
    expect(prompt).toContain("已学会词：coherent");
    expect(prompt).toContain("太简单词：simple");
  });
});

describe("app config", () => {
  it("keeps non-secret app behavior in TypeScript config", () => {
    expect(appConfig).toEqual({
      wordBatchSize: 10,
      autoNextSeconds: 3
    });
  });
});

describe("LLM provider config", () => {
  it("uses DeepSeek when DEEPSEEK_API_KEY is present", () => {
    expect(
      resolveLlmConfig({
        DEEPSEEK_API_KEY: "deepseek-key"
      })
    ).toEqual({
      provider: "deepseek",
      apiKey: "deepseek-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      timeoutMs: 15000,
      maxTokens: null,
      temperature: 1.3,
      thinking: "disabled"
    });
  });

  it("keeps DeepSeek non-secret settings in TypeScript config", () => {
    expect(
      resolveLlmConfig({
        LLM_API_KEY: "generic-key",
        DEEPSEEK_API_KEY: "deepseek-key"
      })
    ).toEqual({
      provider: "deepseek",
      apiKey: "deepseek-key",
      ...serverConfig.llm.deepseek
    });
  });

  it("keeps the generic OpenAI-compatible path for other providers", () => {
    const config: ServerLlmConfig = {
      ...serverConfig.llm,
      provider: "openai-compatible",
      openAiCompatible: {
        baseUrl: "https://provider.example.com/v1/",
        model: "provider-model",
        timeoutMs: 7000,
        maxTokens: 1000,
        temperature: 1.1,
        thinking: null
      }
    };

    expect(
      resolveLlmConfig({
        LLM_API_KEY: "generic-key"
      }, config)
    ).toEqual({
      provider: "openai-compatible",
      apiKey: "generic-key",
      baseUrl: "https://provider.example.com/v1",
      model: "provider-model",
      timeoutMs: 7000,
      maxTokens: 1000,
      temperature: 1.1,
      thinking: null
    });
  });

  it("returns null without a usable API key", () => {
    expect(resolveLlmConfig({})).toBeNull();
  });
});
