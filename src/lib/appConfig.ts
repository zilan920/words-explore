export interface AppConfig {
  wordBatchSize: number;
  studyQueueTargetSize: number;
  autoNextSeconds: number;
}

export const appConfig: AppConfig = {
  wordBatchSize: 10,
  studyQueueTargetSize: 3,
  autoNextSeconds: 3
};
