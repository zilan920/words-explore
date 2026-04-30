import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import { z } from "zod";
import { appConfig } from "@/lib/appConfig";
import { buildRecommendationPrompt, WORD_DELIMITER } from "@/lib/llm/recommendationPrompt";
import { serverConfig, type ServerLlmConfig } from "@/lib/serverConfig";
import type { LearningContext, RecommendationWordInput } from "@/lib/types";

const { wordBatchSize } = appConfig;

const recommendationWordSchema = z.object({
  word: z.string().min(2).max(40).regex(/^[A-Za-z][A-Za-z -]*$/),
  partOfSpeech: z.string().min(1).max(30),
  definitionZh: z.string().min(1).max(80),
  exampleEn: z.string().min(8).max(180),
  exampleZh: z.string().min(4).max(180),
  difficultyReason: z.string().min(4).max(140),
  difficulty: z.number().int().min(1).max(10)
});

const recommendationSchema = z.object({
  words: z.array(recommendationWordSchema).length(wordBatchSize)
});

export interface RecommendationResult {
  source: "deepseek" | "openai-compatible" | "mock";
  words: RecommendationWordInput[];
}

export type RecommendationStreamEvent =
  | {
      type: "start";
      source: LlmProviderConfig["provider"];
      model: string;
      thinking: LlmProviderConfig["thinking"];
    }
  | {
      type: "thinking";
    }
  | {
      type: "word";
      source: RecommendationResult["source"];
      word: RecommendationWordInput;
      index: number;
    }
  | {
      type: "fallback";
      reason: string;
    };

export interface DelimitedRecommendationParseResult {
  words: RecommendationWordInput[];
  remainder: string;
}

export interface LlmProviderConfig {
  provider: "deepseek" | "openai-compatible";
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number | null;
  temperature: number;
  thinking: "enabled" | "disabled" | null;
}

export async function recommendWords(context: LearningContext): Promise<RecommendationResult> {
  const config = resolveLlmConfig();
  if (!config) {
    console.info("[llm] no provider config found; using mock recommendations");
    return mockRecommendations(context);
  }

  const startedAt = Date.now();
  try {
    console.info("[llm] requesting recommendations", {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      targetDifficulty: context.targetDifficulty,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      thinking: config.thinking
    });
    const words = await callOpenAiCompatibleProvider(context, config);
    console.info("[llm] recommendations generated", {
      provider: config.provider,
      model: config.model,
      wordCount: words.length,
      durationMs: Date.now() - startedAt
    });
    return { source: config.provider, words };
  } catch (error) {
    console.warn("[llm] recommendation failed; using mock fallback", {
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    return mockRecommendations(context);
  }
}

export async function streamRecommendationWords(
  context: LearningContext,
  onEvent: (event: RecommendationStreamEvent) => void
): Promise<RecommendationResult> {
  const config = resolveLlmConfig();
  if (!config) {
    console.info("[llm] no provider config found; streaming mock recommendations");
    const result = mockRecommendations(context);
    onEvent({ type: "fallback", reason: "missing_provider_config" });
    emitRecommendationWords(result, onEvent);
    return result;
  }

  const startedAt = Date.now();
  onEvent({
    type: "start",
    source: config.provider,
    model: config.model,
    thinking: config.thinking
  });

  try {
    console.info("[llm] streaming recommendations", {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      targetDifficulty: context.targetDifficulty,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      thinking: config.thinking,
      delimiter: WORD_DELIMITER
    });

    const words = await callOpenAiCompatibleProviderStream(context, config, onEvent, startedAt);
    console.info("[llm] streaming recommendations generated", {
      provider: config.provider,
      model: config.model,
      wordCount: words.length,
      durationMs: Date.now() - startedAt
    });
    return { source: config.provider, words };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[llm] streaming recommendation failed; using mock fallback", {
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - startedAt,
      error: reason
    });
    const result = mockRecommendations(context);
    onEvent({ type: "fallback", reason: sanitizeProviderError(reason) });
    emitRecommendationWords(result, onEvent);
    return result;
  }
}

export function resolveLlmConfig(
  env: Record<string, string | undefined> = process.env,
  config: ServerLlmConfig = serverConfig.llm
): LlmProviderConfig | null {
  if (config.provider === "deepseek") {
    const apiKey = env.DEEPSEEK_API_KEY ?? env.LLM_API_KEY;
    if (!apiKey) {
      return null;
    }
    const providerConfig = config.deepseek;

    return {
      provider: "deepseek",
      apiKey: normalizeEnvValue(apiKey),
      baseUrl: normalizeBaseUrl(providerConfig.baseUrl),
      model: providerConfig.model,
      timeoutMs: providerConfig.timeoutMs,
      maxTokens: providerConfig.maxTokens,
      temperature: providerConfig.temperature,
      thinking: providerConfig.thinking
    };
  }

  const apiKey = env.LLM_API_KEY;
  if (!apiKey) {
    return null;
  }
  const providerConfig = config.openAiCompatible;

  return {
    provider: "openai-compatible",
    apiKey: normalizeEnvValue(apiKey),
    baseUrl: normalizeBaseUrl(providerConfig.baseUrl),
    model: providerConfig.model,
    timeoutMs: providerConfig.timeoutMs,
    maxTokens: providerConfig.maxTokens,
    temperature: providerConfig.temperature,
    thinking: providerConfig.thinking
  };
}

export function validateRecommendationWords(value: unknown): RecommendationWordInput[] {
  const parsed = parseRecommendationPayload(value);
  const seen = new Set<string>();

  for (const word of parsed) {
    const key = word.word.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate recommendation word: ${word.word}`);
    }
    seen.add(key);
  }

  return parsed;
}

export function validateRecommendationWord(value: unknown): RecommendationWordInput {
  return recommendationWordSchema.parse(value);
}

export function parseRecommendationText(content: string): RecommendationWordInput[] {
  const stripped = stripJsonFence(content);

  if (stripped.includes(WORD_DELIMITER)) {
    const parsed = consumeDelimitedRecommendationWords(stripped);
    const tail = normalizeJsonSegment(parsed.remainder);
    const words =
      tail.length > 0
        ? [...parsed.words, validateRecommendationWord(JSON.parse(tail))]
        : parsed.words;

    return validateRecommendationWords(words);
  }

  return validateRecommendationWords(JSON.parse(stripped));
}

export function consumeDelimitedRecommendationWords(buffer: string): DelimitedRecommendationParseResult {
  const words: RecommendationWordInput[] = [];
  let remainder = buffer;
  let delimiterIndex = remainder.indexOf(WORD_DELIMITER);

  while (delimiterIndex >= 0) {
    const rawSegment = remainder.slice(0, delimiterIndex);
    const segment = normalizeJsonSegment(rawSegment);
    remainder = remainder.slice(delimiterIndex + WORD_DELIMITER.length);

    if (segment.length > 0) {
      words.push(validateRecommendationWord(JSON.parse(segment)));
    }

    delimiterIndex = remainder.indexOf(WORD_DELIMITER);
  }

  return { words, remainder };
}

async function callOpenAiCompatibleProvider(
  context: LearningContext,
  config: LlmProviderConfig
): Promise<RecommendationWordInput[]> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: 0
  });
  const requestBody = buildRequestBody(context, config);

  try {
    const completion = await client.chat.completions.create(requestBody, {
      timeout: config.timeoutMs,
      maxRetries: 0
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("LLM returned empty content");
    }

    return parseRecommendationText(content);
  } catch (error) {
    throw normalizeSdkError(error, config);
  }
}

async function callOpenAiCompatibleProviderStream(
  context: LearningContext,
  config: LlmProviderConfig,
  onEvent: (event: RecommendationStreamEvent) => void,
  startedAt: number
): Promise<RecommendationWordInput[]> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: 0
  });
  const requestBody = buildStreamingRequestBody(context, config);
  const words: RecommendationWordInput[] = [];
  let buffer = "";
  let sawThinking = false;
  let firstContentAt: number | null = null;
  let firstWordAt: number | null = null;
  let contentChunks = 0;
  let reasoningChunks = 0;

  try {
    const stream = await client.chat.completions.create(requestBody, {
      timeout: config.timeoutMs,
      maxRetries: 0
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as ChatDeltaWithReasoning | undefined;
      const reasoningContent = delta?.reasoning_content;
      const content = delta?.content;

      if (reasoningContent) {
        reasoningChunks += 1;
        if (!sawThinking) {
          sawThinking = true;
          console.info("[llm] streaming reasoning detected", {
            provider: config.provider,
            model: config.model,
            firstReasoningMs: Date.now() - startedAt
          });
          onEvent({ type: "thinking" });
        }
      }

      if (!content) {
        continue;
      }

      contentChunks += 1;
      firstContentAt ??= Date.now();
      buffer += content;

      const parsed = consumeDelimitedRecommendationWords(buffer);
      buffer = parsed.remainder;

      for (const word of parsed.words) {
        words.push(word);
        firstWordAt ??= Date.now();
        onEvent({
          type: "word",
          source: config.provider,
          word,
          index: words.length
        });
      }
    }

    const tail = normalizeJsonSegment(buffer);
    if (tail.length > 0) {
      const word = validateRecommendationWord(JSON.parse(tail));
      words.push(word);
      firstWordAt ??= Date.now();
      onEvent({
        type: "word",
        source: config.provider,
        word,
        index: words.length
      });
    }

    const validatedWords = validateRecommendationWords(words);
    console.info("[llm] streaming telemetry", {
      provider: config.provider,
      model: config.model,
      contentChunks,
      reasoningChunks,
      firstContentMs: firstContentAt ? firstContentAt - startedAt : null,
      firstWordMs: firstWordAt ? firstWordAt - startedAt : null,
      durationMs: Date.now() - startedAt
    });

    return validatedWords;
  } catch (error) {
    throw normalizeSdkError(error, config);
  }
}

type DeepSeekThinking = {
  thinking?: {
    type: "enabled" | "disabled";
  };
};

type ChatDeltaWithReasoning = {
  content?: string | null;
  reasoning_content?: string | null;
};

function buildRequestBody(
  context: LearningContext,
  config: LlmProviderConfig
): ChatCompletionCreateParamsNonStreaming & DeepSeekThinking {
  return buildRequestBodyBase(context, config);
}

function buildStreamingRequestBody(
  context: LearningContext,
  config: LlmProviderConfig
): ChatCompletionCreateParamsStreaming & DeepSeekThinking {
  return {
    ...buildRequestBodyBase(context, config),
    stream: true
  };
}

function buildRequestBodyBase(
  context: LearningContext,
  config: LlmProviderConfig
): Omit<ChatCompletionCreateParamsNonStreaming, "stream"> & DeepSeekThinking {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "你是英语词汇教练。只输出独立 JSON object 和指定分隔符，不要 Markdown，不要额外解释。"
    },
    {
      role: "user",
      content: buildRecommendationPrompt(context)
    }
  ];

  return {
    model: config.model,
    temperature: config.temperature,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.thinking ? { thinking: { type: config.thinking } } : {}),
    messages
  };
}

function normalizeSdkError(error: unknown, config: LlmProviderConfig): Error {
  if (error instanceof Error) {
    return new Error(
      `LLM SDK request failed: ${config.provider} ${config.model} ${sanitizeProviderError(error.message)}`
    );
  }

  return new Error(`LLM SDK request failed: ${config.provider} ${config.model} ${String(error)}`);
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function normalizeJsonSegment(segment: string): string {
  return stripJsonFence(segment).trim().replace(/^,\s*/, "").replace(/,\s*$/, "").trim();
}

function parseRecommendationPayload(value: unknown): RecommendationWordInput[] {
  const wrapped = recommendationSchema.safeParse(value);
  if (wrapped.success) {
    return wrapped.data.words;
  }

  const direct = z.array(recommendationWordSchema).length(wordBatchSize).safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  return recommendationSchema.parse(value).words;
}

function emitRecommendationWords(
  result: RecommendationResult,
  onEvent: (event: RecommendationStreamEvent) => void
): void {
  result.words.forEach((word, index) => {
    onEvent({
      type: "word",
      source: result.source,
      word,
      index: index + 1
    });
  });
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

function normalizeEnvValue(value: string): string {
  return value.trim();
}

function sanitizeProviderError(detail: string): string {
  return detail
    .slice(0, 220)
    .replace(/api key:\s*[^"',}\s]+/gi, "api key: [redacted]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]");
}

function mockRecommendations(context: LearningContext): RecommendationResult {
  const blocked = new Set(
    [...context.learnedWords, ...context.tooEasyWords, ...context.recentWords].map((word) =>
      word.toLowerCase()
    )
  );
  const preferred = mockPool
    .filter((word) => Math.abs(word.difficulty - context.targetDifficulty) <= 2)
    .filter((word) => !blocked.has(word.word.toLowerCase()));
  const fallback = mockPool.filter((word) => !blocked.has(word.word.toLowerCase()));
  const selected = uniqueByWord([...preferred, ...fallback]).slice(0, wordBatchSize);

  return {
    source: "mock",
    words: selected.length === wordBatchSize ? selected : mockPool.slice(0, wordBatchSize)
  };
}

function uniqueByWord(words: RecommendationWordInput[]): RecommendationWordInput[] {
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.word.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const mockPool: RecommendationWordInput[] = [
  {
    word: "adaptable",
    partOfSpeech: "adjective",
    definitionZh: "适应性强的",
    exampleEn: "An adaptable learner can use new words in different settings.",
    exampleZh: "适应性强的学习者能在不同场景使用新词。",
    difficultyReason: "常见但抽象，适合基础进阶。",
    difficulty: 4
  },
  {
    word: "clarify",
    partOfSpeech: "verb",
    definitionZh: "阐明，澄清",
    exampleEn: "The teacher clarified the difference between the two phrases.",
    exampleZh: "老师澄清了这两个短语之间的区别。",
    difficultyReason: "学习和工作场景高频。",
    difficulty: 4
  },
  {
    word: "criteria",
    partOfSpeech: "noun",
    definitionZh: "标准，准则",
    exampleEn: "The team agreed on clear criteria before choosing a solution.",
    exampleZh: "团队在选择方案前约定了清晰的标准。",
    difficultyReason: "复数形式和正式语境需要注意。",
    difficulty: 5
  },
  {
    word: "dedicate",
    partOfSpeech: "verb",
    definitionZh: "投入，奉献",
    exampleEn: "She dedicated thirty minutes a day to vocabulary practice.",
    exampleZh: "她每天投入三十分钟练习词汇。",
    difficultyReason: "搭配稳定，适合扩展表达。",
    difficulty: 5
  },
  {
    word: "evaluate",
    partOfSpeech: "verb",
    definitionZh: "评估",
    exampleEn: "We need to evaluate whether the method actually improves recall.",
    exampleZh: "我们需要评估这个方法是否真的提升记忆。",
    difficultyReason: "学术和职场语境常用。",
    difficulty: 5
  },
  {
    word: "friction",
    partOfSpeech: "noun",
    definitionZh: "摩擦，阻力",
    exampleEn: "A simple interface reduces friction for new users.",
    exampleZh: "简单的界面降低了新用户的使用阻力。",
    difficultyReason: "有物理和抽象双重含义。",
    difficulty: 6
  },
  {
    word: "inference",
    partOfSpeech: "noun",
    definitionZh: "推断",
    exampleEn: "Her inference was based on the examples in the passage.",
    exampleZh: "她的推断基于文章中的例子。",
    difficultyReason: "阅读理解和推理表达常见。",
    difficulty: 6
  },
  {
    word: "nuance",
    partOfSpeech: "noun",
    definitionZh: "细微差别",
    exampleEn: "The nuance of the word changes with context.",
    exampleZh: "这个词的细微差别会随语境变化。",
    difficultyReason: "意义抽象，适合熟练阶段。",
    difficulty: 7
  },
  {
    word: "coherent",
    partOfSpeech: "adjective",
    definitionZh: "连贯的",
    exampleEn: "A coherent answer connects each idea logically.",
    exampleZh: "连贯的回答会把每个观点有逻辑地连接起来。",
    difficultyReason: "写作评价中非常实用。",
    difficulty: 7
  },
  {
    word: "subtle",
    partOfSpeech: "adjective",
    definitionZh: "微妙的，不易察觉的",
    exampleEn: "There is a subtle difference between confidence and arrogance.",
    exampleZh: "自信和傲慢之间有微妙差别。",
    difficultyReason: "释义不直观，例句能帮助掌握。",
    difficulty: 7
  },
  {
    word: "mitigate",
    partOfSpeech: "verb",
    definitionZh: "缓解，减轻",
    exampleEn: "The new policy aims to mitigate the impact of sudden changes.",
    exampleZh: "新政策旨在减轻突发变化的影响。",
    difficultyReason: "正式表达，常用于问题解决。",
    difficulty: 8
  },
  {
    word: "discern",
    partOfSpeech: "verb",
    definitionZh: "辨别，察觉",
    exampleEn: "Experienced readers can discern the author's attitude quickly.",
    exampleZh: "有经验的读者能快速辨别作者态度。",
    difficultyReason: "比 see 更正式，适合高阶替换。",
    difficulty: 8
  },
  {
    word: "tenuous",
    partOfSpeech: "adjective",
    definitionZh: "脆弱的，牵强的",
    exampleEn: "The connection between the two events is tenuous.",
    exampleZh: "这两个事件之间的联系很牵强。",
    difficultyReason: "低频且语义精细。",
    difficulty: 9
  },
  {
    word: "ameliorate",
    partOfSpeech: "verb",
    definitionZh: "改善，减轻",
    exampleEn: "The program was designed to ameliorate long-term learning gaps.",
    exampleZh: "这个项目旨在改善长期学习差距。",
    difficultyReason: "正式低频词，适合高阶积累。",
    difficulty: 9
  },
  {
    word: "laconic",
    partOfSpeech: "adjective",
    definitionZh: "言简意赅的",
    exampleEn: "His laconic reply made the meeting end sooner than expected.",
    exampleZh: "他言简意赅的回复让会议比预期更早结束。",
    difficultyReason: "精确描述表达风格。",
    difficulty: 9
  }
];
