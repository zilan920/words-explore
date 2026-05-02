import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const env = { ...loadDotEnv(".env.local"), ...process.env };
const apiKey = (env.DEEPSEEK_API_KEY || env.WORDS_EXPLORE_LLM_API_KEY || "").trim();
const configuredBaseUrl = (env.DEEPSEEK_BASE_URL || env.LLM_BASE_URL || "https://api.deepseek.com").replace(
  /\/$/,
  ""
);
const model = env.DEEPSEEK_MODEL || env.LLM_MODEL || "deepseek-v4-flash";
const timeoutMs = parsePositiveInteger(env.DEEPSEEK_TIMEOUT_MS || env.LLM_TIMEOUT_MS, 10000);
const maxTokens = parseOptionalPositiveInteger(env.DEEPSEEK_MAX_TOKENS || env.LLM_MAX_TOKENS);
const temperature = parseTemperature(env.DEEPSEEK_TEMPERATURE || env.LLM_TEMPERATURE, 1.3);
const attempts = parsePositiveInteger(process.env.ATTEMPTS, 3);
const compareV1 = process.env.COMPARE_V1 !== "0";
const promptMode = process.env.PROMPT_MODE || "tiny";
const thinking = parseThinkingMode(env.DEEPSEEK_THINKING || env.LLM_THINKING, "disabled");

if (!apiKey) {
  console.error("Missing DEEPSEEK_API_KEY or WORDS_EXPLORE_LLM_API_KEY in .env.local");
  process.exit(1);
}

const baseUrls = compareV1
  ? Array.from(new Set([configuredBaseUrl, normalizeDeepSeekV1(configuredBaseUrl)]))
  : [configuredBaseUrl];

console.log("Direct DeepSeek timing test; API key redacted.");
console.log(
  JSON.stringify(
    {
      model,
      timeoutMs,
      maxTokens,
      temperature,
      attempts,
      promptMode,
      thinking,
      baseUrls
    },
    null,
    2
  )
);

for (const baseUrl of baseUrls) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await runOnce({ baseUrl, attempt });
  }
}

async function runOnce({ baseUrl, attempt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        response_format: { type: "json_object" },
        ...(thinking ? { thinking: { type: thinking } } : {}),
        messages: buildMessages()
      })
    });
    const text = await response.text();
    const parsed = parseDeepSeekText(text);

    console.log(
      JSON.stringify(
        {
          baseUrl,
          attempt,
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
          responseBytes: Buffer.byteLength(text),
          contentBytes: parsed.contentBytes,
          contentJson: parsed.contentJson,
          wordCount: parsed.wordCount,
          preview: sanitizeProviderText(text.slice(0, 160)),
          contentPreview: parsed.contentPreview
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          baseUrl,
          attempt,
          ok: false,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        },
        null,
        2
      )
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseDeepSeekText(text) {
  try {
    const payload = JSON.parse(text);
    const content = payload?.choices?.[0]?.message?.content ?? "";
    let contentJson = false;
    let wordCount = null;

    try {
      const parsedContent = JSON.parse(stripJsonFence(content));
      contentJson = true;
      wordCount = Array.isArray(parsedContent?.words) ? parsedContent.words.length : null;
    } catch {
      contentJson = false;
    }

    return {
      contentBytes: Buffer.byteLength(content),
      contentJson,
      wordCount,
      contentPreview: sanitizeProviderText(content.slice(0, 160))
    };
  } catch {
    return {
      contentBytes: 0,
      contentJson: false,
      wordCount: null,
      contentPreview: ""
    };
  }
}

function stripJsonFence(content) {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function buildMessages() {
  if (promptMode !== "app") {
    return [
      { role: "system", content: "Only output strict JSON." },
      { role: "user", content: 'Return {"ok":true,"word":"test"} and nothing else.' }
    ];
  }

  return [
    {
      role: "system",
      content:
        "你是英语词汇教练。只输出严格 JSON，不要 Markdown。输出恰好 10 个英文单词，字段必须完整。"
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "推荐下一批 10 个适合学习的英文词汇",
          outputShape: {
            words: [
              {
                word: "英文词",
                partOfSpeech: "词性",
                definitionZh: "中文释义",
                exampleEn: "英文例句",
                exampleZh: "中文例句翻译",
                difficultyReason: "为什么适合当前难度",
                difficulty: "1-10 的整数"
              }
            ]
          },
          constraints: [
            "恰好 10 个英文词",
            "不要推荐 learnedWords 和 tooEasyWords 中的词",
            "learningWords 可以再次出现，但优先推荐同难度的新词",
            "避免 recentWords 中近 30 个词的重复",
            "中文释义简洁，英文例句自然"
          ],
          learner: {
            targetDifficulty: 3,
            estimatedLevel: "入门",
            learnedWords: [],
            tooEasyWords: [],
            learningWords: [],
            recentWords: []
          }
        },
        null,
        2
      )
    }
  ];
}

function loadDotEnv(path) {
  if (!existsSync(path)) {
    return {};
  }

  const loaded = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index < 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    loaded[key] = value;
  }

  return loaded;
}

function parsePositiveInteger(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInteger(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "auto" || normalized === "default") {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTemperature(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : fallback;
}

function parseThinkingMode(value, fallback) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "enabled" || normalized === "disabled") {
    return normalized;
  }
  if (normalized === "auto" || normalized === "none") {
    return null;
  }

  return fallback;
}

function normalizeDeepSeekV1(baseUrl) {
  if (baseUrl === "https://api.deepseek.com") {
    return "https://api.deepseek.com/v1";
  }

  return baseUrl;
}

function sanitizeProviderText(text) {
  return text
    .replace(/api key:\s*[^"',}\s]+/gi, "api key: [redacted]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]");
}
