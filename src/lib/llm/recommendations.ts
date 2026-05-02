import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import { z } from "zod";
import { appConfig } from "@/lib/appConfig";
import type { LearningGoal } from "@/lib/learningGoals";
import { buildRecommendationPrompt, WORD_DELIMITER } from "@/lib/llm/recommendationPrompt";
import { serverConfig, type ServerLlmConfig } from "@/lib/serverConfig";
import type { LearningContext, RecommendationWordInput } from "@/lib/types";

const { wordBatchSize } = appConfig;

const compactText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min).max(max));

const recommendationWordSchema = z.object({
  word: compactText(2, 60).refine((value) => /^[A-Za-z][A-Za-z '-]*[A-Za-z]$/.test(value), {
    message: "Word must contain only English letters, spaces, hyphens, or apostrophes"
  }),
  partOfSpeech: compactText(1, 40),
  definitionZh: compactText(1, 160),
  exampleEn: compactText(8, 320),
  exampleZh: compactText(4, 320),
  difficultyReason: compactText(4, 240),
  difficulty: z.preprocess((value) => {
    if (typeof value === "string") {
      const match = value.match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : value;
    }

    return value;
  }, z.number().int().min(1).max(10))
});

const recommendationSchema = z.object({
  words: z.array(recommendationWordSchema).length(wordBatchSize)
});

export interface RecommendationResult {
  source: string;
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
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number | null;
  temperature: number;
  wordsPerRequest: number;
  thinking: "enabled" | "disabled" | null;
}

export interface RecommendationDiagnosticsOptions {
  requestId?: string;
  wordCount?: number;
}

export async function recommendWords(
  context: LearningContext,
  options: RecommendationDiagnosticsOptions = {}
): Promise<RecommendationResult> {
  const targetWordCount = normalizeRequestedWordCount(options.wordCount);
  const config = resolveLlmConfig();
  if (!config) {
    console.info("[llm] no provider config found; using mock recommendations");
    return mockRecommendations(context, targetWordCount);
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
      requestedWords: targetWordCount,
      wordsPerRequest: config.wordsPerRequest,
      thinking: config.thinking
    });
    const words = await callOpenAiCompatibleProviderBatch(context, config, {
      startedAt,
      diagnostics: options,
      wordCount: targetWordCount
    });
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
    return mockRecommendations(context, targetWordCount);
  }
}

export async function streamRecommendationWords(
  context: LearningContext,
  onEvent: (event: RecommendationStreamEvent) => void | Promise<void>,
  diagnostics: RecommendationDiagnosticsOptions = {}
): Promise<RecommendationResult> {
  const targetWordCount = normalizeRequestedWordCount(diagnostics.wordCount);
  const config = resolveLlmConfig();
  if (!config) {
    console.info("[llm] no provider config found; streaming mock recommendations", {
      requestId: diagnostics.requestId,
      requestedWords: targetWordCount
    });
    const result = mockRecommendations(context, targetWordCount);
    await onEvent({ type: "fallback", reason: "missing_provider_config" });
    await emitRecommendationWords(result, onEvent);
    return result;
  }

  const startedAt = Date.now();
  await onEvent({
    type: "start",
    source: config.provider,
    model: config.model,
    thinking: config.thinking
  });

  try {
    console.info("[llm] streaming recommendations", {
      requestId: diagnostics.requestId,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      targetDifficulty: context.targetDifficulty,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      thinking: config.thinking,
      requestMode: "words-array-loop",
      requestedWords: targetWordCount,
      wordsPerRequest: config.wordsPerRequest
    });

    const words = await callOpenAiCompatibleProviderBatch(
      context,
      config,
      {
        startedAt,
        diagnostics,
        wordCount: targetWordCount,
        onWord: async (word, index) => {
          await onEvent({
            type: "word",
            source: config.provider,
            word,
            index
          });
        }
      }
    );
    console.info("[llm] streaming recommendations generated", {
      requestId: diagnostics.requestId,
      provider: config.provider,
      model: config.model,
      wordCount: words.length,
      durationMs: Date.now() - startedAt
    });
    return { source: config.provider, words };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[llm] streaming recommendation failed; using mock fallback", {
      requestId: diagnostics.requestId,
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - startedAt,
      error: reason
    });
    const result = mockRecommendations(context, targetWordCount);
    await onEvent({ type: "fallback", reason: sanitizeProviderError(reason) });
    await emitRecommendationWords(result, onEvent);
    return result;
  }
}

export function resolveLlmConfig(
  env: Record<string, string | undefined> = process.env,
  config: ServerLlmConfig = serverConfig.llm
): LlmProviderConfig | null {
  const provider = resolveProviderName(env, config);
  if (!provider) {
    return null;
  }

  const providerConfig = config.providers[provider];
  const apiKey = resolveProviderApiKey(env, provider);
  if (!apiKey) {
    return null;
  }

  return {
    provider,
    apiKey,
    baseUrl: normalizeBaseUrl(providerConfig.baseUrl),
    model: providerConfig.model,
    timeoutMs: providerConfig.timeoutMs,
    maxTokens: providerConfig.maxTokens,
    temperature: resolveTemperature(env, providerConfig.temperature, [
      "LLM_TEMPERATURE",
      ...legacyProviderEnvVars(provider).temperature
    ]),
    wordsPerRequest: resolveWordsPerRequest(
      env,
      providerConfig.wordsPerRequest,
      ["LLM_WORDS_PER_REQUEST", ...legacyProviderEnvVars(provider).wordsPerRequest]
    ),
    thinking: providerConfig.thinking
  };
}

export function validateRecommendationWords(value: unknown): RecommendationWordInput[] {
  const parsed = parseRecommendationPayload(value);
  return validateUniqueRecommendationWords(parsed);
}

function validateRecommendationWordList(
  value: RecommendationWordInput[],
  expectedCount: number
): RecommendationWordInput[] {
  const parsed = z.array(recommendationWordSchema).length(expectedCount).parse(value);
  return validateUniqueRecommendationWords(parsed);
}

function validateUniqueRecommendationWords(
  parsed: RecommendationWordInput[]
): RecommendationWordInput[] {
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
    const parsed = consumeDelimitedRecommendationWords(stripped, wordBatchSize);
    const words = [
      ...parsed.words,
      ...parseStreamingRecommendationTail(parsed.remainder, parsed.words.length, parsed.words)
    ];

    return validateRecommendationWords(words);
  }

  return validateRecommendationWords(parseRecommendationCandidates(stripped, wordBatchSize));
}

export function parseRecommendationWordText(content: string): RecommendationWordInput {
  const [word] = parseRecommendationCandidates(stripJsonFence(content), 1);
  if (!word) {
    throw new Error("No valid recommendation JSON found");
  }

  return validateRecommendationWord(word);
}

export function parseRecommendationWordBatchText(
  content: string,
  maxWords: number
): RecommendationWordInput[] {
  const words = parseRecommendationCandidates(stripJsonFence(content), maxWords).map((word) =>
    validateRecommendationWord(word)
  );

  if (words.length === 0) {
    throw new Error("No valid recommendation JSON found");
  }

  return uniqueByWord(words).slice(0, maxWords);
}

export function consumeDelimitedRecommendationWords(
  buffer: string,
  maxWords = wordBatchSize
): DelimitedRecommendationParseResult {
  const words: RecommendationWordInput[] = [];
  const seen = new Set<string>();
  let remainder = buffer;
  let delimiterIndex = remainder.indexOf(WORD_DELIMITER);

  while (delimiterIndex >= 0) {
    const rawSegment = remainder.slice(0, delimiterIndex);
    const segment = normalizeJsonSegment(rawSegment);
    remainder = remainder.slice(delimiterIndex + WORD_DELIMITER.length);

    if (segment.length > 0) {
      const remainingSlots = Math.max(0, maxWords - words.length);
      const parsedWords =
        remainingSlots > 0 ? parseRecommendationCandidates(segment, remainingSlots) : [];

      for (const word of parsedWords) {
        const key = word.word.toLowerCase();
        if (!seen.has(key)) {
          words.push(word);
          seen.add(key);
        }
      }
    }

    delimiterIndex = remainder.indexOf(WORD_DELIMITER);
  }

  return { words, remainder };
}

interface BatchGenerationOptions {
  startedAt: number;
  wordCount: number;
  diagnostics?: RecommendationDiagnosticsOptions;
  onWord?: (word: RecommendationWordInput, index: number) => void | Promise<void>;
}

async function callOpenAiCompatibleProviderBatch(
  context: LearningContext,
  config: LlmProviderConfig,
  options: BatchGenerationOptions
): Promise<RecommendationWordInput[]> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: 0
  });
  const words: RecommendationWordInput[] = [];
  const diagnostics = options.diagnostics ?? {};
  const targetWordCount = normalizeRequestedWordCount(options.wordCount);
  const maxAttempts = Math.max(
    targetWordCount * 2,
    Math.ceil(targetWordCount / Math.max(config.wordsPerRequest, 1)) * 3
  );
  let firstWordAt: number | null = null;
  let attempts = 0;
  let outputChars = 0;
  let diagnosticContent = "";

  try {
    while (words.length < targetWordCount && attempts < maxAttempts) {
      attempts += 1;
      const requestStartedAt = Date.now();
      const requestWordCount = Math.min(config.wordsPerRequest, targetWordCount - words.length);
      const requestBody = buildRequestBody(
        context,
        config,
        getUnreviewedWordsForPrompt(context, words),
        requestWordCount
      );
      const completion = await client.chat.completions.create(requestBody, {
        timeout: config.timeoutMs,
        maxRetries: 0
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        console.warn("[llm] recommendation batch rejected; retrying", {
          requestId: diagnostics.requestId,
          provider: config.provider,
          model: config.model,
          attempt: attempts,
          reason: "empty_content",
          wordsParsed: words.length,
          durationMs: Date.now() - requestStartedAt
        });
        continue;
      }

      outputChars += content.length;
      diagnosticContent = appendDiagnosticContent(diagnosticContent, content);
      let parsedWords: RecommendationWordInput[];
      try {
        parsedWords = parseRecommendationWordBatchText(content, requestWordCount);
      } catch (error) {
        console.warn("[llm] recommendation batch parse failed; retrying", {
          requestId: diagnostics.requestId,
          provider: config.provider,
          model: config.model,
          attempt: attempts,
          wordsParsed: words.length,
          requestedWords: requestWordCount,
          outputLast: diagnosticSnippet(content, "last"),
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - requestStartedAt
        });
        continue;
      }

      let acceptedCount = 0;
      for (const word of parsedWords) {
        if (words.length >= targetWordCount) {
          break;
        }

        if (isBlockedRecommendationWord(context, words, word.word)) {
          console.warn("[llm] recommendation word rejected", {
            requestId: diagnostics.requestId,
            provider: config.provider,
            model: config.model,
            attempt: attempts,
            word: word.word,
            reason: "duplicate_or_blocked",
            wordsParsed: words.length
          });
          continue;
        }

        words.push(word);
        acceptedCount += 1;
        firstWordAt ??= Date.now();
        await options.onWord?.(word, words.length);
        console.info("[llm] recommendation word generated", {
          requestId: diagnostics.requestId,
          provider: config.provider,
          model: config.model,
          attempt: attempts,
          index: words.length,
          word: word.word
        });
      }

      if (acceptedCount === 0) {
        console.warn("[llm] recommendation batch rejected; retrying", {
          requestId: diagnostics.requestId,
          provider: config.provider,
          model: config.model,
          attempt: attempts,
          reason: "no_accepted_words",
          requestedWords: requestWordCount,
          returnedWords: parsedWords.length,
          wordsParsed: words.length,
          durationMs: Date.now() - requestStartedAt
        });
        continue;
      }

      console.info("[llm] recommendation batch generated", {
        requestId: diagnostics.requestId,
        provider: config.provider,
        model: config.model,
        attempt: attempts,
        requestedWords: requestWordCount,
        returnedWords: parsedWords.length,
        acceptedWords: acceptedCount,
        wordsParsed: words.length,
        durationMs: Date.now() - requestStartedAt
      });
    }

    if (words.length < targetWordCount) {
      throw new Error(
        `LLM generated ${words.length}/${targetWordCount} valid recommendation words after ${attempts} attempts`
      );
    }

    const validatedWords = validateRecommendationWordList(words, targetWordCount);
    console.info("[llm] words-array batch telemetry", {
      requestId: diagnostics.requestId,
      provider: config.provider,
      model: config.model,
      attempts,
      wordsParsed: words.length,
      outputChars,
      outputSampleChars: diagnosticContent.length,
      outputSampleTruncated: outputChars > diagnosticContent.length,
      firstWordMs: firstWordAt ? firstWordAt - options.startedAt : null,
      durationMs: Date.now() - options.startedAt
    });

    return validatedWords;
  } catch (error) {
    console.warn("[llm] words-array batch diagnostics", {
      requestId: diagnostics.requestId,
      provider: config.provider,
      model: config.model,
      attempts,
      wordsParsed: words.length,
      outputChars,
      outputSampleChars: diagnosticContent.length,
      outputSampleTruncated: outputChars > diagnosticContent.length,
      outputFirst: diagnosticSnippet(diagnosticContent, "first"),
      outputLast: diagnosticSnippet(diagnosticContent, "last"),
      error: error instanceof Error ? error.message : String(error)
    });
    throw normalizeSdkError(error, config);
  }
}

type DeepSeekThinking = {
  thinking?: {
    type: "enabled" | "disabled";
  };
};

function buildRequestBody(
  context: LearningContext,
  config: LlmProviderConfig,
  acquiredWords: string[],
  wordCount: number
): ChatCompletionCreateParamsNonStreaming & DeepSeekThinking {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "你是英语词汇教练。只输出 1 个独立 JSON object，不要 Markdown，不要额外解释。"
    },
    {
      role: "user",
      content: buildRecommendationPrompt(context, { acquiredWords, wordCount })
    }
  ];

  return {
    model: config.model,
    temperature: config.temperature,
    response_format: { type: "json_object" },
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

export function parseStreamingRecommendationTail(
  buffer: string,
  existingWordCount: number,
  existingWords: RecommendationWordInput[] = []
): RecommendationWordInput[] {
  const tail = normalizeJsonSegment(buffer);
  if (tail.length === 0) {
    return [];
  }

  const tailWords = parseRecommendationCandidates(tail, wordBatchSize);
  if (existingWordCount <= 0) {
    return tailWords;
  }

  const seen = new Set(existingWords.map((word) => word.word.toLowerCase()));
  return tailWords
    .filter((word) => !seen.has(word.word.toLowerCase()))
    .slice(0, Math.max(0, wordBatchSize - existingWordCount));
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

  const wrappedLoose = z.object({
    words: z.array(recommendationWordSchema)
  }).safeParse(value);
  if (wrappedLoose.success) {
    throw new Error(
      `Expected ${wordBatchSize} recommendation words, got ${wrappedLoose.data.words.length}`
    );
  }

  const directLoose = z.array(recommendationWordSchema).safeParse(value);
  if (directLoose.success) {
    throw new Error(`Expected ${wordBatchSize} recommendation words, got ${directLoose.data.length}`);
  }

  throw new Error("Invalid recommendation payload shape");
}

function parseRecommendationCandidates(content: string, maxWords: number): RecommendationWordInput[] {
  const direct = parseRecommendationPayloadLoose(parseJsonSegment(content), maxWords);
  if (direct.length > 0) {
    return direct;
  }

  const words: RecommendationWordInput[] = [];
  const seen = new Set<string>();

  for (const candidate of extractJsonCandidates(content)) {
    for (const word of parseRecommendationPayloadLoose(candidate, maxWords)) {
      const key = word.word.toLowerCase();
      if (!seen.has(key)) {
        words.push(word);
        seen.add(key);
      }

      if (words.length >= maxWords) {
        return words;
      }
    }
  }

  if (words.length > 0) {
    return words;
  }

  throw new Error("No valid recommendation JSON found");
}

function parseRecommendationPayloadLoose(value: unknown, maxWords: number): RecommendationWordInput[] {
  const singleWord = recommendationWordSchema.safeParse(value);
  if (singleWord.success) {
    return [singleWord.data];
  }

  const wrapped = z.object({
    words: z.array(recommendationWordSchema).min(1)
  }).safeParse(value);
  const parsed = wrapped.success
    ? wrapped.data.words
    : z.array(recommendationWordSchema).min(1).safeParse(value).data;

  if (!parsed) {
    return [];
  }

  const seen = new Set<string>();
  const words: RecommendationWordInput[] = [];

  for (const word of parsed) {
    const key = word.word.toLowerCase();
    if (!seen.has(key)) {
      words.push(word);
      seen.add(key);
    }
  }

  return words.slice(0, maxWords);
}

const diagnosticContentLimit = 12_000;
const diagnosticSnippetLength = 700;

function appendDiagnosticContent(current: string, next: string): string {
  if (current.length >= diagnosticContentLimit) {
    return current;
  }

  return (current + next).slice(0, diagnosticContentLimit);
}

function diagnosticSnippet(content: string, side: "first" | "last"): string | null {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= diagnosticSnippetLength) {
    return normalized;
  }

  return side === "first"
    ? `${normalized.slice(0, diagnosticSnippetLength)}...`
    : `...${normalized.slice(-diagnosticSnippetLength)}`;
}

const missingCommaBeforeRecommendationKeyPattern =
  /((?:"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|true|false|null|[}\]])\s+)(?="(?:word|partOfSpeech|definitionZh|exampleEn|exampleZh|difficultyReason|difficulty|words)"\s*:)/g;

function parseJsonSegment(segment: string): unknown {
  const normalized = normalizeJsonSegment(segment);
  return parseJsonWithRecommendationRepair(normalized);
}

function parseJsonWithRecommendationRepair(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    const repaired = repairMissingCommasBeforeRecommendationKeys(content);
    if (repaired === content) {
      return null;
    }

    try {
      return JSON.parse(repaired) as unknown;
    } catch {
      return null;
    }
  }
}

function repairMissingCommasBeforeRecommendationKeys(content: string): string {
  return content.replace(missingCommaBeforeRecommendationKeyPattern, (match) => {
    return `${match.trimEnd()}, `;
  });
}

function extractJsonCandidates(content: string): unknown[] {
  const source = stripJsonFence(content);
  const candidates: unknown[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const open = source[index];
    if (open !== "{" && open !== "[") {
      continue;
    }

    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let cursor = index; cursor < source.length; cursor += 1) {
      const char = source[cursor];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === open) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          const raw = source.slice(index, cursor + 1);
          const parsed = parseJsonWithRecommendationRepair(raw);
          if (parsed !== null) {
            candidates.push(parsed);
          }
          index = cursor;
          break;
        }
      }
    }
  }

  return candidates;
}

function emitRecommendationWords(
  result: RecommendationResult,
  onEvent: (event: RecommendationStreamEvent) => void | Promise<void>
): Promise<void> {
  return result.words.reduce<Promise<void>>(async (previous, word, index) => {
    await previous;
    await onEvent({
      type: "word",
      source: result.source,
      word,
      index: index + 1
    });
  }, Promise.resolve());
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

function normalizeEnvValue(value: string): string {
  return value.trim();
}

function resolveProviderName(
  env: Record<string, string | undefined>,
  config: ServerLlmConfig
): string | null {
  const requestedProvider = env.LLM_PROVIDER?.trim() || config.provider;
  const matchedProvider = findConfiguredProvider(config, requestedProvider);
  if (matchedProvider) {
    return matchedProvider;
  }

  const fallbackProvider = findConfiguredProvider(config, config.provider);
  console.warn("[llm] invalid provider config; using fallback when available", {
    requestedProvider,
    fallbackProvider,
    availableProviders: Object.keys(config.providers)
  });

  return fallbackProvider;
}

function findConfiguredProvider(config: ServerLlmConfig, provider: string): string | null {
  if (config.providers[provider]) {
    return provider;
  }

  const normalizedProvider = provider.toLowerCase();
  return Object.keys(config.providers).find((key) => key.toLowerCase() === normalizedProvider) ?? null;
}

function resolveProviderApiKey(
  env: Record<string, string | undefined>,
  provider: string
): string | null {
  const keys = ["LLM_API_KEY", ...legacyProviderEnvVars(provider).apiKey];
  const raw = keys.map((key) => env[key]?.trim()).find((value) => value);
  return raw ? normalizeEnvValue(raw) : null;
}

function legacyProviderEnvVars(provider: string): {
  apiKey: string[];
  temperature: string[];
  wordsPerRequest: string[];
} {
  switch (provider.toLowerCase()) {
    case "deepseek":
      return {
        apiKey: ["DEEPSEEK_API_KEY"],
        temperature: ["DEEPSEEK_TEMPERATURE"],
        wordsPerRequest: ["DEEPSEEK_WORDS_PER_REQUEST"]
      };
    case "openai":
      return {
        apiKey: ["OPENAI_API_KEY"],
        temperature: ["OPENAI_TEMPERATURE"],
        wordsPerRequest: ["OPENAI_WORDS_PER_REQUEST"]
      };
    case "volcengine":
      return {
        apiKey: ["VOLCENGINE_API_KEY", "ARK_API_KEY"],
        temperature: ["VOLCENGINE_TEMPERATURE", "ARK_TEMPERATURE"],
        wordsPerRequest: ["VOLCENGINE_WORDS_PER_REQUEST", "ARK_WORDS_PER_REQUEST"]
      };
    default:
      return {
        apiKey: [],
        temperature: [],
        wordsPerRequest: []
      };
  }
}

function resolveTemperature(
  env: Record<string, string | undefined>,
  defaultTemperature: number,
  keys: string[]
): number {
  const raw = keys.map((key) => env[key]?.trim()).find((value) => value);
  if (!raw) {
    return defaultTemperature;
  }

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) {
    return parsed;
  }

  console.warn("[llm] invalid temperature env; using TypeScript config default", {
    keys,
    value: raw,
    defaultTemperature
  });
  return defaultTemperature;
}

function resolveWordsPerRequest(
  env: Record<string, string | undefined>,
  defaultWordsPerRequest: number,
  keys: string[]
): number {
  const raw = keys.map((key) => env[key]?.trim()).find((value) => value);
  if (!raw) {
    return clampWordsPerRequest(defaultWordsPerRequest);
  }

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= wordBatchSize) {
    return parsed;
  }

  console.warn("[llm] invalid words-per-request env; using TypeScript config default", {
    keys,
    value: raw,
    defaultWordsPerRequest
  });
  return clampWordsPerRequest(defaultWordsPerRequest);
}

function clampWordsPerRequest(value: number): number {
  if (!Number.isInteger(value)) {
    return 1;
  }

  return Math.min(wordBatchSize, Math.max(1, value));
}

function normalizeRequestedWordCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return wordBatchSize;
  }

  return Math.min(wordBatchSize, Math.max(1, value));
}

function sanitizeProviderError(detail: string): string {
  return detail
    .slice(0, 220)
    .replace(/api key:\s*[^"',}\s]+/gi, "api key: [redacted]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]");
}

function mockRecommendations(
  context: LearningContext,
  requestedCount = wordBatchSize
): RecommendationResult {
  const targetWordCount = normalizeRequestedWordCount(requestedCount);
  const pool = goalMockPools[context.learningGoal] ?? mockPool;
  const blocked = new Set(
    [
      ...context.learnedWords,
      ...context.tooEasyWords,
      ...context.unreviewedWords,
      ...context.recentWords
    ].map((word) => word.toLowerCase())
  );
  const preferred = pool
    .filter((word) => Math.abs(word.difficulty - context.targetDifficulty) <= 2)
    .filter((word) => !blocked.has(word.word.toLowerCase()));
  const fallback = pool.filter((word) => !blocked.has(word.word.toLowerCase()));
  const selected = uniqueByWord([...preferred, ...fallback]).slice(0, targetWordCount);

  return {
    source: "mock",
    words: selected.length === targetWordCount ? selected : pool.slice(0, targetWordCount)
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

function getUnreviewedWordsForPrompt(
  context: LearningContext,
  generatedWords: RecommendationWordInput[]
): string[] {
  return uniqueStrings([
    ...context.unreviewedWords,
    ...generatedWords.map((word) => word.word)
  ]);
}

function isBlockedRecommendationWord(
  context: LearningContext,
  generatedWords: RecommendationWordInput[],
  nextWord: string
): boolean {
  const key = nextWord.toLowerCase();
  const blocked = new Set(
    [
      ...context.learnedWords,
      ...context.tooEasyWords,
      ...context.unreviewedWords,
      ...generatedWords.map((word) => word.word)
    ].map((word) => word.toLowerCase())
  );

  return blocked.has(key);
}

function uniqueStrings(words: string[]): string[] {
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

const goalMockPools: Record<LearningGoal, RecommendationWordInput[]> = {
  general: mockPool,
  cet4: [
    goalWord("campus", "noun", "校园", "Campus life helps students build social skills.", "校园生活帮助学生建立社交能力。", "四级高频校园场景词。", 2),
    goalWord("average", "adjective", "平均的", "The average temperature is higher this year.", "今年的平均气温更高。", "四级阅读常见基础形容词。", 3),
    goalWord("available", "adjective", "可获得的", "Free seats are available in the front row.", "前排还有空座位。", "四级听力和阅读常见词。", 4),
    goalWord("efficient", "adjective", "高效的", "An efficient plan saves time and energy.", "高效的计划节省时间和精力。", "四级写作可用表达。", 4),
    goalWord("consume", "verb", "消耗", "Large screens consume more battery power.", "大屏幕会消耗更多电量。", "四级科技和生活话题常见。", 5),
    goalWord("indicate", "verb", "表明", "The survey results indicate a clear change.", "调查结果表明出现了明显变化。", "四级阅读题干和文章高频。", 5),
    goalWord("priority", "noun", "优先事项", "Safety should be our first priority.", "安全应该是我们的首要事项。", "四级观点表达常用。", 6),
    goalWord("sufficient", "adjective", "足够的", "Students need sufficient sleep before exams.", "学生考试前需要足够睡眠。", "四级议论文常见词。", 6),
    goalWord("perspective", "noun", "观点", "Try to see the issue from another perspective.", "试着从另一个角度看这个问题。", "四级阅读和写作常用抽象词。", 7),
    goalWord("contribute", "verb", "贡献，促成", "Regular practice contributes to better fluency.", "规律练习有助于提升流利度。", "四级因果表达常用。", 5)
  ],
  cet6: [
    goalWord("notion", "noun", "概念", "The notion of fairness changes across cultures.", "公平的概念会随文化而变化。", "六级阅读常见抽象名词。", 4),
    goalWord("derive", "verb", "获得，源自", "Many English words derive from Latin.", "许多英语单词源自拉丁语。", "六级词源和学术语境常见。", 4),
    goalWord("initiative", "noun", "主动性", "The project rewards students who show initiative.", "这个项目奖励表现出主动性的学生。", "六级职场和校园话题常见。", 5),
    goalWord("substitute", "noun", "替代品", "Online meetings are not always a perfect substitute.", "线上会议并不总是完美替代品。", "六级阅读常用名词。", 5),
    goalWord("controversial", "adjective", "有争议的", "The proposal remains controversial among experts.", "该提议在专家中仍有争议。", "六级议论文高频。", 6),
    goalWord("substantial", "adjective", "大量的", "The policy brought substantial benefits.", "这项政策带来了大量好处。", "六级正式表达常见。", 6),
    goalWord("innovation", "noun", "创新", "Innovation can improve traditional industries.", "创新可以改善传统行业。", "六级科技经济主题高频。", 7),
    goalWord("obligation", "noun", "义务", "Citizens have an obligation to protect public spaces.", "公民有义务保护公共空间。", "六级社会话题常见词。", 7),
    goalWord("paradigm", "noun", "范式", "Remote work created a new business paradigm.", "远程办公创造了新的商业范式。", "六级高阶抽象表达。", 8),
    goalWord("underscore", "verb", "强调", "The data underscore the need for reform.", "数据强调了改革的必要性。", "六级阅读和写作高级动词。", 7)
  ],
  ielts: [
    goalWord("accommodation", "noun", "住宿", "Affordable accommodation is a concern for students.", "可负担的住宿是学生关心的问题。", "雅思生活和教育场景高频。", 4),
    goalWord("commute", "verb", "通勤", "Many people commute by train every day.", "许多人每天乘火车通勤。", "雅思城市生活话题常见。", 4),
    goalWord("sustainable", "adjective", "可持续的", "Cities need sustainable transport systems.", "城市需要可持续的交通系统。", "雅思环境和城市话题核心词。", 5),
    goalWord("adequate", "adjective", "足够的", "Children need adequate space to play.", "儿童需要足够的玩耍空间。", "雅思写作常用评价词。", 5),
    goalWord("urbanization", "noun", "城市化", "Urbanization changes how communities interact.", "城市化改变社区互动方式。", "雅思社会发展话题高频。", 6),
    goalWord("emission", "noun", "排放", "Vehicle emissions affect air quality.", "车辆排放影响空气质量。", "雅思环境类核心词。", 6),
    goalWord("infrastructure", "noun", "基础设施", "Good infrastructure supports economic growth.", "良好的基础设施支持经济增长。", "雅思政府和城市话题常见。", 7),
    goalWord("proficiency", "noun", "熟练程度", "Language proficiency improves with practice.", "语言熟练程度会随练习提高。", "雅思学习和移民语境常见。", 7),
    goalWord("deteriorate", "verb", "恶化", "Public health may deteriorate without clean water.", "没有干净水源，公共健康可能恶化。", "雅思问题结果表达常用。", 8),
    goalWord("mitigate", "verb", "缓解", "Governments can mitigate the effects of pollution.", "政府可以缓解污染影响。", "雅思写作高分动词。", 8)
  ],
  toefl: [
    goalWord("lecture", "noun", "讲座", "The lecture explained how volcanoes form.", "讲座解释了火山如何形成。", "托福听力课堂场景高频。", 3),
    goalWord("hypothesis", "noun", "假设", "The scientist tested a new hypothesis.", "科学家检验了一个新假设。", "托福学术讲座核心词。", 5),
    goalWord("habitat", "noun", "栖息地", "The bird lost its natural habitat.", "这种鸟失去了自然栖息地。", "托福生物和环境话题高频。", 5),
    goalWord("archaeology", "noun", "考古学", "Archaeology helps us understand ancient societies.", "考古学帮助我们理解古代社会。", "托福人文讲座常见。", 6),
    goalWord("photosynthesis", "noun", "光合作用", "Plants use sunlight during photosynthesis.", "植物在光合作用中使用阳光。", "托福生命科学核心词。", 6),
    goalWord("empirical", "adjective", "经验主义的", "The claim requires empirical evidence.", "这个说法需要经验证据。", "托福学术论证常用。", 7),
    goalWord("phenomenon", "noun", "现象", "Migration is a common natural phenomenon.", "迁徙是一种常见自然现象。", "托福学术文章高频。", 7),
    goalWord("predominant", "adjective", "占主导的", "Wind is the predominant force in this process.", "风是这个过程中的主导力量。", "托福听力和阅读高阶词。", 8),
    goalWord("stratification", "noun", "分层", "Soil stratification reveals climate history.", "土壤分层揭示气候历史。", "托福地质和考古话题词。", 8),
    goalWord("corroborate", "verb", "证实", "The second study corroborates the first result.", "第二项研究证实了第一个结果。", "托福学术论证高阶词。", 9)
  ]
};

function goalWord(
  word: string,
  partOfSpeech: string,
  definitionZh: string,
  exampleEn: string,
  exampleZh: string,
  difficultyReason: string,
  difficulty: number
): RecommendationWordInput {
  return {
    word,
    partOfSpeech,
    definitionZh,
    exampleEn,
    exampleZh,
    difficultyReason,
    difficulty
  };
}
