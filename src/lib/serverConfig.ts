export type ServerLlmProvider = string;
export type ServerStorageDriver = "file" | "libsql";
export type ServerThinkingMode = "enabled" | "disabled" | null;

export interface ServerLlmProviderConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number | null;
  temperature: number;
  wordsPerRequest: number;
  thinking: ServerThinkingMode;
}

export interface ServerLlmConfig {
  provider: ServerLlmProvider;
  providers: Record<ServerLlmProvider, ServerLlmProviderConfig>;
}

export interface ServerStorageConfig {
  driver: ServerStorageDriver;
  sqlitePath: string;
  libsqlUrl: string;
}

export interface ServerSecurityConfig {
  userCreationRateLimit: {
    windowMs: number;
    max: number;
  };
  userCreationGlobalRateLimit: {
    windowMs: number;
    max: number;
  };
  recommendationRateLimit: {
    windowMs: number;
    max: number;
    lockTtlMs: number;
  };
  recommendationIpRateLimit: {
    windowMs: number;
    max: number;
  };
  recommendationGlobalRateLimit: {
    windowMs: number;
    max: number;
  };
  importLimits: {
    maxFileBytes: number;
    maxAssessmentSessions: number;
    maxAssessmentAnswers: number;
    maxRecommendationBatches: number;
    maxWordRecords: number;
    maxWordActions: number;
    maxTextLength: number;
  };
}

export const serverConfig: {
  llm: ServerLlmConfig;
  storage: ServerStorageConfig;
  security: ServerSecurityConfig;
} = {
  llm: {
    provider: "deepseek",
    providers: {
      deepseek: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        timeoutMs: 15000,
        maxTokens: null,
        temperature: 1.3,
        wordsPerRequest: 5,
        thinking: "disabled"
      },
      openai: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        timeoutMs: 15000,
        maxTokens: null,
        temperature: 1.3,
        wordsPerRequest: 5,
        thinking: null
      },
      volcengine: {
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-1-6-flash-250615",
        timeoutMs: 15000,
        maxTokens: null,
        temperature: 1.3,
        wordsPerRequest: 5,
        thinking: null
      },
      "openai-compatible": {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        timeoutMs: 15000,
        maxTokens: null,
        temperature: 1.3,
        wordsPerRequest: 5,
        thinking: null
      }
    }
  },
  storage: {
    // File storage config: keep driver="file" and set sqlitePath to the DB file path.
    driver: "libsql",
    sqlitePath: "data/words-explore.sqlite",
    // Used only when driver="libsql"; keep the auth token in .env.local.
    libsqlUrl: "libsql://words-explore-superfran.aws-ap-northeast-1.turso.io"
  },
  security: {
    userCreationRateLimit: {
      windowMs: 60_000,
      max: 20
    },
    userCreationGlobalRateLimit: {
      windowMs: 60_000,
      max: 100
    },
    recommendationRateLimit: {
      windowMs: 60_000,
      max: 40,
      lockTtlMs: 45_000
    },
    recommendationIpRateLimit: {
      windowMs: 60_000,
      max: 80
    },
    recommendationGlobalRateLimit: {
      windowMs: 60_000,
      max: 300
    },
    importLimits: {
      maxFileBytes: 5 * 1024 * 1024,
      maxAssessmentSessions: 20,
      maxAssessmentAnswers: 300,
      maxRecommendationBatches: 200,
      maxWordRecords: 2_000,
      maxWordActions: 5_000,
      maxTextLength: 2_000
    }
  }
};
