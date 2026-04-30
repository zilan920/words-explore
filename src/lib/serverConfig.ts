export type ServerLlmProvider = "deepseek" | "openai-compatible";
export type ServerStorageDriver = "file" | "libsql";
export type ServerThinkingMode = "enabled" | "disabled" | null;

export interface ServerLlmProviderConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number | null;
  temperature: number;
  thinking: ServerThinkingMode;
}

export interface ServerLlmConfig {
  provider: ServerLlmProvider;
  deepseek: ServerLlmProviderConfig;
  openAiCompatible: ServerLlmProviderConfig;
}

export interface ServerStorageConfig {
  driver: ServerStorageDriver;
  sqlitePath: string;
  libsqlUrl: string;
}

export const serverConfig: {
  llm: ServerLlmConfig;
  storage: ServerStorageConfig;
} = {
  llm: {
    provider: "deepseek",
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      timeoutMs: 15000,
      maxTokens: null,
      temperature: 1.3,
      thinking: "disabled"
    },
    openAiCompatible: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      timeoutMs: 15000,
      maxTokens: null,
      temperature: 1.3,
      thinking: null
    }
  },
  storage: {
    // File storage config: keep driver="file" and set sqlitePath to the DB file path.
    driver: "libsql",
    sqlitePath: "data/words-explore.sqlite",
    // Used only when driver="libsql"; keep the auth token in .env.local.
    libsqlUrl: "libsql://words-explore-superfran.aws-ap-northeast-1.turso.io"
  }
};
