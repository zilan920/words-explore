import { describe, expect, it, vi } from "vitest";
import { appConfig } from "@/lib/appConfig";
import { buildRecommendationPrompt, WORD_DELIMITER } from "@/lib/llm/recommendationPrompt";
import {
  consumeDelimitedRecommendationWords,
  parseRecommendationText,
  parseRecommendationWordBatchText,
  parseStreamingRecommendationTail,
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

const compactBaseWord = {
  w: "coherent",
  r: "抽象表达",
  l: 7
};

const baseCandidate = {
  word: "coherent",
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

function wordList(count = appConfig.wordBatchSize) {
  return Array.from({ length: count }, (_, index) => ({
    ...baseWord,
    word: testWord(index)
  }));
}

function providerRuntimeDefaults(provider: string) {
  return serverConfig.llm.providers[provider];
}

describe("recommendation validation", () => {
  it("accepts exactly the configured number of unique words", () => {
    const payload = {
      words: wordList()
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

    expect(parsed.words).toEqual([{ ...baseCandidate, word: first.word }]);
    expect(parsed.remainder).toContain("subtle");
  });

  it("accepts a full delimited LLM response", () => {
    const content = wordList()
      .map((word) => `${JSON.stringify(word)}\n${WORD_DELIMITER}`)
      .join("\n");

    expect(parseRecommendationText(content)).toHaveLength(appConfig.wordBatchSize);
  });

  it("accepts a delimited JSON array segment", () => {
    const content = `${JSON.stringify(wordList())}\n${WORD_DELIMITER}`;
    const parsed = consumeDelimitedRecommendationWords(content);

    expect(parsed.words).toHaveLength(appConfig.wordBatchSize);
    expect(parseRecommendationText(content).map((word) => word.word)).toEqual(
      wordList().map((word) => word.word)
    );
  });

  it("accepts a delimited wrapped recommendation object segment", () => {
    const content = `${JSON.stringify({ words: wordList() })}\n${WORD_DELIMITER}`;

    expect(parseRecommendationText(content)).toHaveLength(appConfig.wordBatchSize);
  });

  it("uses the first configured batch when a delimited response has extra segments", () => {
    const content = wordList(appConfig.wordBatchSize + 2)
      .map((word) => `${JSON.stringify(word)}\n${WORD_DELIMITER}`)
      .join("\n");

    expect(parseRecommendationText(content).map((word) => word.word)).toEqual(
      wordList().map((word) => word.word)
    );
  });

  it("normalizes common LLM scalar variants", () => {
    const payload = {
      words: wordList().map((word, index) =>
        index === 0
          ? {
              ...word,
              word: "don't panic",
              difficulty: "7/10"
            }
          : word
      )
    };

    const parsed = parseRecommendationText(JSON.stringify(payload));

    expect(parsed[0].word).toBe("don't panic");
    expect(parsed[0].difficulty).toBe(7);
  });

  it("parses a configured words array response", () => {
    const words = wordList(3);

    expect(parseRecommendationWordBatchText(JSON.stringify({ words }), 3).map((word) => word.word)).toEqual(
      words.map((word) => word.word)
    );
  });

  it("accepts compact provider output fields", () => {
    const words = [
      compactBaseWord,
      { ...compactBaseWord, w: "subtle" },
      { ...compactBaseWord, w: "compose" }
    ];

    expect(parseRecommendationWordBatchText(JSON.stringify({ words }), 3)).toEqual([
      {
        word: "coherent",
        difficultyReason: "抽象表达",
        difficulty: 7
      },
      {
        word: "subtle",
        difficultyReason: "抽象表达",
        difficulty: 7
      },
      {
        word: "compose",
        difficultyReason: "抽象表达",
        difficulty: 7
      }
    ]);
  });

  it("repairs a missing comma before a known recommendation field", () => {
    const words = wordList();
    const malformedFirstWord = JSON.stringify(words[0]).replace(
      ',"exampleEn"',
      ' "exampleEn"'
    );
    const content = [malformedFirstWord, ...words.slice(1).map((word) => JSON.stringify(word))]
      .map((wordJson) => `${wordJson}\n${WORD_DELIMITER}`)
      .join("\n");

    expect(parseRecommendationText(content).map((word) => word.word)).toEqual(
      words.map((word) => word.word)
    );
  });

  it("accepts noisy markdown around a wrapped recommendation object", () => {
    const content = [
      "好的，下面是推荐：",
      "```json",
      JSON.stringify({ words: wordList() }, null, 2),
      "```",
      "以上。"
    ].join("\n");

    expect(parseRecommendationText(content).map((word) => word.word)).toEqual(
      wordList().map((word) => word.word)
    );
  });

  it("accepts standalone JSON objects without delimiters", () => {
    const content = wordList()
      .map((word, index) => `第 ${index + 1} 个：\n${JSON.stringify(word)}`)
      .join("\n\n");

    expect(parseRecommendationText(content)).toHaveLength(appConfig.wordBatchSize);
  });

  it("uses the first configured batch when the provider returns too many array items", () => {
    expect(parseRecommendationText(JSON.stringify(wordList(appConfig.wordBatchSize + 2)))).toHaveLength(
      appConfig.wordBatchSize
    );
  });

  it("accepts prose around delimited JSON objects", () => {
    const content = wordList()
      .map((word) => `推荐如下：${JSON.stringify(word)}\n${WORD_DELIMITER}`)
      .join("\n");

    expect(parseRecommendationText(content)).toHaveLength(appConfig.wordBatchSize);
  });

  it("accepts a complete JSON array as a streaming tail before any word was emitted", () => {
    const payload = wordList();

    expect(parseStreamingRecommendationTail(JSON.stringify(payload), 0)).toHaveLength(
      appConfig.wordBatchSize
    );
  });

  it("accepts a JSON array tail after some delimited words were emitted", () => {
    const emitted = [{ ...baseWord, word: "word emitted" }];
    const payload = [
      ...emitted,
      ...Array.from({ length: appConfig.wordBatchSize - 1 }, (_, index) => ({
        ...baseWord,
        word: testWord(index)
      }))
    ];

    const parsed = parseStreamingRecommendationTail(
      JSON.stringify(payload),
      emitted.length,
      emitted
    );

    expect(parsed).toHaveLength(appConfig.wordBatchSize - emitted.length);
    expect(parsed.some((word) => word.word === emitted[0].word)).toBe(false);
  });

  it("accepts a wrapped recommendation object as a streaming tail before any word was emitted", () => {
    const payload = {
      words: wordList()
    };

    expect(parseStreamingRecommendationTail(JSON.stringify(payload), 0)).toHaveLength(
      appConfig.wordBatchSize
    );
  });
});

describe("recommendation prompt", () => {
  it("asks for a configured words array and keeps changing learner data at the end", () => {
    const prompt = buildRecommendationPrompt(
      {
        learningGoal: "ielts",
        targetDifficulty: 7,
        estimatedLevel: "B2",
        learnedWords: ["coherent"],
        tooEasyWords: ["simple"],
        learningWords: ["nuance"],
        unreviewedWords: ["pending"],
        recentWords: ["subtle"]
      },
      {
        acquiredWords: ["subtle", "pending"],
        wordCount: 3
      }
    );

    expect(prompt.trim().startsWith("{")).toBe(false);
    expect(prompt).not.toContain(WORD_DELIMITER);
    expect(prompt).toContain("推荐 3 个");
    expect(prompt).toContain('{"words": [...]}');
    expect(prompt).toContain("长度为 3 的 JSON array");
    expect(prompt).toContain("短字段：w, r, l");
    expect(prompt).toContain("词典工具补齐");
    expect(prompt).toContain('"w": "coherent"');
    expect(prompt).toContain("学习目标：雅思");
    expect(prompt).toContain("学会的单词：coherent");
    expect(prompt).toContain("太简单的单词：simple");
    expect(prompt).toContain("生词簿：nuance");
    expect(prompt).toContain("已获取但还没有反馈的单词：pending, subtle");
    expect(prompt.lastIndexOf("学习者信息")).toBeGreaterThan(prompt.indexOf("单个 JSON object 示例"));
  });
});

describe("app config", () => {
  it("keeps non-secret app behavior in TypeScript config", () => {
    expect(appConfig).toEqual({
      wordBatchSize: 10,
      studyQueueTargetSize: 3,
      autoNextSeconds: 3
    });
  });
});

describe("LLM provider config", () => {
  it("uses the configured default provider with app-scoped API key", () => {
    expect(
      resolveLlmConfig({
        WORDS_EXPLORE_LLM_API_KEY: "generic-key"
      })
    ).toEqual({
      provider: "deepseek",
      apiKey: "generic-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      timeoutMs: 15000,
      maxTokens: null,
      temperature: 1.3,
      wordsPerRequest: 3,
      thinking: "disabled"
    });
  });

  it("keeps provider non-secret settings in TypeScript config", () => {
    expect(
      resolveLlmConfig({
        WORDS_EXPLORE_LLM_API_KEY: "generic-key"
      })
    ).toEqual({
      provider: "deepseek",
      apiKey: "generic-key",
      ...providerRuntimeDefaults("deepseek")
    });
  });

  it("allows LLM_PROVIDER to select OpenAI", () => {
    expect(
      resolveLlmConfig({
        LLM_PROVIDER: "openai",
        WORDS_EXPLORE_LLM_API_KEY: "generic-key"
      })
    ).toEqual({
      provider: "openai",
      apiKey: "generic-key",
      ...providerRuntimeDefaults("openai")
    });
  });

  it("allows LLM_PROVIDER to select Volcengine", () => {
    expect(
      resolveLlmConfig({
        LLM_PROVIDER: "volcengine",
        WORDS_EXPLORE_LLM_API_KEY: "generic-key"
      })
    ).toEqual({
      provider: "volcengine",
      apiKey: "generic-key",
      ...providerRuntimeDefaults("volcengine")
    });
  });

  it("keeps the generic OpenAI-compatible path for custom-compatible providers", () => {
    const config: ServerLlmConfig = {
      provider: "openai-compatible",
      providers: {
        ...serverConfig.llm.providers,
        "openai-compatible": {
          baseUrl: "https://provider.example.com/v1/",
          model: "provider-model",
          timeoutMs: 7000,
          maxTokens: 1000,
          temperature: 1.1,
          wordsPerRequest: 4,
          thinking: null
        }
      }
    };

    expect(
      resolveLlmConfig({
        WORDS_EXPLORE_LLM_API_KEY: "generic-key"
      }, config)
    ).toEqual({
      provider: "openai-compatible",
      apiKey: "generic-key",
      baseUrl: "https://provider.example.com/v1",
      model: "provider-model",
      timeoutMs: 7000,
      maxTokens: 1000,
      temperature: 1.1,
      wordsPerRequest: 4,
      thinking: null
    });
  });

  it("allows generic LLM_TEMPERATURE to override the active provider temperature", () => {
    expect(
      resolveLlmConfig({
        WORDS_EXPLORE_LLM_API_KEY: "generic-key",
        LLM_TEMPERATURE: "0.6"
      })?.temperature
    ).toBe(0.6);
  });

  it("keeps the TypeScript default when generic temperature env is invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(
        resolveLlmConfig({
          WORDS_EXPLORE_LLM_API_KEY: "generic-key",
          LLM_TEMPERATURE: "hot"
        })?.temperature
      ).toBe(serverConfig.llm.providers.deepseek.temperature);
    } finally {
      warn.mockRestore();
    }
  });

  it("allows generic LLM_WORDS_PER_REQUEST to override words per request", () => {
    const config: ServerLlmConfig = {
      provider: "openai-compatible",
      providers: {
        ...serverConfig.llm.providers,
        "openai-compatible": {
          baseUrl: "https://provider.example.com/v1/",
          model: "provider-model",
          timeoutMs: 7000,
          maxTokens: 1000,
          temperature: 1.1,
          wordsPerRequest: 4,
          thinking: null
        }
      }
    };

    expect(
      resolveLlmConfig({
        WORDS_EXPLORE_LLM_API_KEY: "generic-key",
        LLM_WORDS_PER_REQUEST: "6"
      }, config)?.wordsPerRequest
    ).toBe(6);
  });

  it("keeps legacy provider-specific env names as fallback", () => {
    expect(
      resolveLlmConfig({
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_TEMPERATURE: "0.4",
        DEEPSEEK_WORDS_PER_REQUEST: "2"
      })
    ).toMatchObject({
      provider: "deepseek",
      apiKey: "deepseek-key",
      temperature: 0.4,
      wordsPerRequest: 2
    });
  });

  it("returns null without a usable API key", () => {
    expect(resolveLlmConfig({})).toBeNull();
  });

  it("ignores unrelated system-level LLM_API_KEY", () => {
    expect(resolveLlmConfig({ LLM_API_KEY: "system-key" })).toBeNull();
  });
});
