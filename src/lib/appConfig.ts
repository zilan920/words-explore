export interface AppConfig {
  wordBatchSize: number;
  autoNextSeconds: number;
}

export const appConfig: AppConfig = {
  wordBatchSize: 10,
  autoNextSeconds: 3
};
