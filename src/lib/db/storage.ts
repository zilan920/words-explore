import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { z } from "zod";
import type { AssessmentScore } from "@/lib/assessment";
import type {
  AssessmentAnswerRow,
  AssessmentSessionRow,
  LearningContext,
  RecommendationBatchRow,
  RecommendationWordInput,
  UserBundle,
  UserRow,
  UserState,
  WordAction,
  WordActionRow,
  WordRecordRow
} from "@/lib/types";
import { schemaSql } from "@/lib/db/schema";
import {
  defaultLearningGoal,
  learningGoalIds,
  normalizeLearningGoal,
  type LearningGoal
} from "@/lib/learningGoals";
import { serverConfig, type ServerStorageConfig } from "@/lib/serverConfig";
import { isValidUsername } from "@/lib/username";

const nodeRequire = createRequire(import.meta.url);

export interface StorageAdapter {
  ensureSchema(): Promise<void>;
  createUser(
    username: string,
    accessTokenHash?: string | null,
    learningGoal?: LearningGoal
  ): Promise<UserRow>;
  getUser(username: string): Promise<UserRow | null>;
  verifyUserAccess(username: string, accessTokenHash: string): Promise<boolean>;
  resetUserData(username: string): Promise<UserRow>;
  renameUser(oldUsername: string, newUsername: string): Promise<UserRow>;
  updateLearningGoal(username: string, learningGoal: LearningGoal): Promise<UserRow>;
  startAssessment(username: string, sessionId: string): Promise<AssessmentSessionRow>;
  saveAssessmentResult(username: string, score: AssessmentScore): Promise<void>;
  getLearningContext(username: string): Promise<LearningContext>;
  createRecommendationBatch(
    username: string,
    words: RecommendationWordInput[],
    source: string,
    targetDifficulty: number
  ): Promise<{ batch: RecommendationBatchRow; words: WordRecordRow[] }>;
  recordWordAction(username: string, wordId: string, action: WordAction): Promise<WordRecordRow>;
  getUserState(username: string): Promise<UserState | null>;
  exportUserBundle(username: string): Promise<UserBundle>;
  importUserBundle(bundle: UserBundle, targetUsername?: string): Promise<UserRow>;
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  acquireLock(key: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

let storagePromise: Promise<StorageAdapter> | null = null;

export type StorageDriver = "file" | "libsql";

export interface StorageConfig {
  driver: StorageDriver;
  sqlitePath?: string;
  libsqlUrl?: string;
  libsqlAuthToken?: string;
}

export async function getStorage(): Promise<StorageAdapter> {
  if (!storagePromise) {
    storagePromise = createStorage();
  }

  return storagePromise;
}

export function resetStorageForTests(): void {
  storagePromise = null;
}

async function createStorage(): Promise<StorageAdapter> {
  const config = resolveStorageConfig();
  const adapter =
    config.driver === "libsql"
      ? new LibsqlStorage(config.libsqlUrl!, config.libsqlAuthToken)
      : new NodeSqliteStorage(config.sqlitePath!);

  console.info("[storage] using adapter", {
    driver: config.driver,
    sqlitePath: config.driver === "file" ? config.sqlitePath : undefined,
    libsqlUrl: config.driver === "libsql" ? sanitizeStorageUrl(config.libsqlUrl!) : undefined
  });

  await adapter.ensureSchema();
  return adapter;
}

export function resolveStorageConfig(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
  config: ServerStorageConfig = serverConfig.storage
): StorageConfig {
  if (config.driver === "file") {
    return {
      driver: "file",
      sqlitePath: normalizeSqlitePath(config.sqlitePath, cwd)
    };
  }

  if (!config.libsqlUrl) {
    throw new Error("serverConfig.storage.libsqlUrl is required when storage.driver is libsql");
  }

  return {
    driver: "libsql",
    libsqlUrl: config.libsqlUrl,
    libsqlAuthToken: env.LIBSQL_AUTH_TOKEN
  };
}

export class NodeSqliteStorage implements StorageAdapter {
  private db: import("node:sqlite").DatabaseSync | null = null;

  constructor(private readonly filePath: string) {}

  async ensureSchema(): Promise<void> {
    const db = await this.open();
    db.exec(schemaSql);
    migrateNodeSchema(db);
  }

  async createUser(
    username: string,
    accessTokenHash: string | null = null,
    learningGoal: LearningGoal = defaultLearningGoal
  ): Promise<UserRow> {
    const db = await this.open();
    const createdAt = nowIso();

    db.prepare(
      `INSERT INTO users
       (username, access_token_hash, created_at, learning_goal, target_difficulty, estimated_level, assessment_completed_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL)`
    ).run(username, accessTokenHash, createdAt, learningGoal);

    return {
      username,
      createdAt,
      learningGoal,
      targetDifficulty: null,
      estimatedLevel: null,
      assessmentCompletedAt: null
    };
  }

  async getUser(username: string): Promise<UserRow | null> {
    const row = await this.getOne<UserTableRow>("SELECT * FROM users WHERE username = ?", [username]);
    return row ? mapUser(row) : null;
  }

  async verifyUserAccess(username: string, accessTokenHash: string): Promise<boolean> {
    const row = await this.getOne<{ access_token_hash: string | null }>(
      "SELECT access_token_hash FROM users WHERE username = ?",
      [username]
    );
    return Boolean(row?.access_token_hash && row.access_token_hash === accessTokenHash);
  }

  async resetUserData(username: string): Promise<UserRow> {
    await this.assertUser(username);
    const db = await this.open();

    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM word_actions WHERE username = ?").run(username);
      db.prepare("DELETE FROM word_records WHERE username = ?").run(username);
      db.prepare("DELETE FROM recommendation_batches WHERE username = ?").run(username);
      db.prepare("DELETE FROM assessment_answers WHERE username = ?").run(username);
      db.prepare("DELETE FROM assessment_sessions WHERE username = ?").run(username);
      db.prepare(
        `UPDATE users
         SET target_difficulty = NULL, estimated_level = NULL, assessment_completed_at = NULL
         WHERE username = ?`
      ).run(username);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const user = await this.getUser(username);
    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  async renameUser(oldUsername: string, newUsername: string): Promise<UserRow> {
    if (oldUsername === newUsername) {
      return this.assertUser(oldUsername);
    }

    const current = await this.assertUser(oldUsername);
    const accessTokenHash = await this.getUserAccessTokenHash(oldUsername);
    const existing = await this.getUser(newUsername);
    if (existing) {
      throw new Error("User ID already exists");
    }

    const db = await this.open();
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO users
         (username, access_token_hash, created_at, learning_goal, target_difficulty, estimated_level, assessment_completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newUsername,
        accessTokenHash,
        current.createdAt,
        current.learningGoal,
        current.targetDifficulty,
        current.estimatedLevel,
        current.assessmentCompletedAt
      );
      for (const table of [
        "assessment_sessions",
        "assessment_answers",
        "recommendation_batches",
        "word_records",
        "word_actions"
      ]) {
        db.prepare(`UPDATE ${table} SET username = ? WHERE username = ?`).run(
          newUsername,
          oldUsername
        );
      }
      db.prepare("DELETE FROM users WHERE username = ?").run(oldUsername);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const renamed = await this.getUser(newUsername);
    if (!renamed) {
      throw new Error("User rename failed");
    }

    return renamed;
  }

  async updateLearningGoal(username: string, learningGoal: LearningGoal): Promise<UserRow> {
    await this.assertUser(username);
    const db = await this.open();
    db.prepare("UPDATE users SET learning_goal = ? WHERE username = ?").run(learningGoal, username);

    return this.assertUser(username);
  }

  async startAssessment(username: string, sessionId: string): Promise<AssessmentSessionRow> {
    await this.assertUser(username);
    const startedAt = nowIso();
    const db = await this.open();

    db.prepare(
      `INSERT INTO assessment_sessions
       (id, username, started_at, submitted_at, score, estimated_level, target_difficulty)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL)`
    ).run(sessionId, username, startedAt);

    return {
      id: sessionId,
      username,
      startedAt,
      submittedAt: null,
      score: null,
      estimatedLevel: null,
      targetDifficulty: null
    };
  }

  async saveAssessmentResult(username: string, score: AssessmentScore): Promise<void> {
    await this.assertUser(username);
    const db = await this.open();
    const submittedAt = nowIso();

    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE assessment_sessions
         SET submitted_at = ?, score = ?, estimated_level = ?, target_difficulty = ?
         WHERE id = ? AND username = ?`
      ).run(
        submittedAt,
        score.score,
        score.estimatedLevel,
        score.targetDifficulty,
        score.sessionId,
        username
      );

      for (const answer of score.answers) {
        db.prepare(
          `INSERT INTO assessment_answers
           (id, session_id, username, question_id, word, correct_answer, selected_answer, is_correct, difficulty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          score.sessionId,
          username,
          answer.question.id,
          answer.question.word,
          answer.question.correctAnswer,
          answer.selectedAnswer,
          answer.isCorrect ? 1 : 0,
          answer.question.difficulty
        );
      }

      db.prepare(
        `UPDATE users
         SET target_difficulty = ?, estimated_level = ?, assessment_completed_at = ?
         WHERE username = ?`
      ).run(score.targetDifficulty, score.estimatedLevel, submittedAt, username);

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async getLearningContext(username: string): Promise<LearningContext> {
    const user = await this.assertUser(username);
    const rows = await this.getAll<WordRecordTableRow>(
      `SELECT * FROM word_records WHERE username = ? ORDER BY created_at DESC`,
      [username]
    );
    const words = rows.map(mapWordRecord);

    return {
      learningGoal: user.learningGoal,
      targetDifficulty: user.targetDifficulty ?? 4,
      estimatedLevel: user.estimatedLevel,
      learnedWords: words.filter((word) => word.status === "learned").map((word) => word.word),
      tooEasyWords: words.filter((word) => word.status === "too_easy").map((word) => word.word),
      learningWords: words.filter((word) => word.status === "learning").map((word) => word.word),
      recentWords: words.slice(0, 30).map((word) => word.word)
    };
  }

  async createRecommendationBatch(
    username: string,
    words: RecommendationWordInput[],
    source: string,
    targetDifficulty: number
  ): Promise<{ batch: RecommendationBatchRow; words: WordRecordRow[] }> {
    await this.assertUser(username);
    const db = await this.open();
    const createdAt = nowIso();
    const batch: RecommendationBatchRow = {
      id: randomUUID(),
      username,
      createdAt,
      source,
      targetDifficulty
    };

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO recommendation_batches (id, username, created_at, source, target_difficulty)
         VALUES (?, ?, ?, ?, ?)`
      ).run(batch.id, username, createdAt, source, targetDifficulty);

      const inserted = words.map((word, index) => {
        const wordCreatedAt = offsetIso(createdAt, index);

        return {
          id: randomUUID(),
          batchId: batch.id,
          username,
          word: word.word,
          partOfSpeech: word.partOfSpeech,
          definitionZh: word.definitionZh,
          exampleEn: word.exampleEn,
          exampleZh: word.exampleZh,
          difficultyReason: word.difficultyReason,
          difficulty: word.difficulty,
          status: "new" as const,
          createdAt: wordCreatedAt,
          updatedAt: wordCreatedAt
        };
      });

      for (const word of inserted) {
        db.prepare(
          `INSERT INTO word_records
           (id, batch_id, username, word, part_of_speech, definition_zh, example_en, example_zh,
            difficulty_reason, difficulty, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          word.id,
          word.batchId,
          username,
          word.word,
          word.partOfSpeech,
          word.definitionZh,
          word.exampleEn,
          word.exampleZh,
          word.difficultyReason,
          word.difficulty,
          word.status,
          word.createdAt,
          word.updatedAt
        );
      }

      db.exec("COMMIT");
      return { batch, words: inserted };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async recordWordAction(
    username: string,
    wordId: string,
    action: WordAction
  ): Promise<WordRecordRow> {
    await this.assertUser(username);
    const db = await this.open();
    const createdAt = nowIso();

    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE word_records SET status = ?, updated_at = ? WHERE id = ? AND username = ?`
      ).run(action, createdAt, wordId, username);
      db.prepare(
        `INSERT INTO word_actions (id, word_id, username, action, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), wordId, username, action, createdAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const word = await this.getOne<WordRecordTableRow>(
      "SELECT * FROM word_records WHERE id = ? AND username = ?",
      [wordId, username]
    );

    if (!word) {
      throw new Error("Word record not found");
    }

    return mapWordRecord(word);
  }

  async getUserState(username: string): Promise<UserState | null> {
    const user = await this.getUser(username);
    if (!user) {
      return null;
    }

    const latestBatchRow = await this.getOne<RecommendationBatchTableRow>(
      `SELECT * FROM recommendation_batches WHERE username = ? ORDER BY created_at DESC LIMIT 1`,
      [username]
    );
    const latestBatch = latestBatchRow ? mapBatch(latestBatchRow) : null;
    const latestRows = latestBatch
      ? await this.getAll<WordRecordTableRow>(
          `SELECT * FROM word_records WHERE username = ? AND batch_id = ? ORDER BY created_at ASC`,
          [username, latestBatch.id]
        )
      : [];
    const historyRows = await this.getAll<WordRecordTableRow>(
      `SELECT * FROM word_records WHERE username = ? ORDER BY created_at DESC`,
      [username]
    );
    const history = historyRows.map(mapWordRecord);

    return {
      user,
      latestBatch,
      latestWords: latestRows.map(mapWordRecord),
      history,
      stats: {
        totalWords: history.length,
        learned: history.filter((word) => word.status === "learned").length,
        tooEasy: history.filter((word) => word.status === "too_easy").length,
        learning: history.filter((word) => word.status === "learning").length
      }
    };
  }

  async exportUserBundle(username: string): Promise<UserBundle> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error("User not found");
    }

    const assessmentSessions = (
      await this.getAll<AssessmentSessionTableRow>(
        "SELECT * FROM assessment_sessions WHERE username = ? ORDER BY started_at ASC",
        [username]
      )
    ).map(mapAssessmentSession);
    const assessmentAnswers = (
      await this.getAll<AssessmentAnswerTableRow>(
        "SELECT * FROM assessment_answers WHERE username = ? ORDER BY id ASC",
        [username]
      )
    ).map(mapAssessmentAnswer);
    const recommendationBatches = (
      await this.getAll<RecommendationBatchTableRow>(
        "SELECT * FROM recommendation_batches WHERE username = ? ORDER BY created_at ASC",
        [username]
      )
    ).map(mapBatch);
    const wordRecords = (
      await this.getAll<WordRecordTableRow>(
        "SELECT * FROM word_records WHERE username = ? ORDER BY created_at ASC",
        [username]
      )
    ).map(mapWordRecord);
    const wordActions = (
      await this.getAll<WordActionTableRow>(
        "SELECT * FROM word_actions WHERE username = ? ORDER BY created_at ASC",
        [username]
      )
    ).map(mapWordAction);

    return {
      user,
      assessmentSessions,
      assessmentAnswers,
      recommendationBatches,
      wordRecords,
      wordActions
    };
  }

  async importUserBundle(bundle: UserBundle, targetUsername?: string): Promise<UserRow> {
    const db = await this.open();
    const imported = validateUserBundle(bundle);
    const finalBundle = targetUsername ? rewriteBundleUsername(imported, targetUsername) : imported;
    const username = finalBundle.user.username;
    const accessTokenHash = targetUsername ? await this.getUserAccessTokenHash(targetUsername) : null;

    if (targetUsername && accessTokenHash === null) {
      throw new Error("User not found");
    }

    db.exec("BEGIN");
    try {
      deleteUserData(db, username);
      insertBundle(db, finalBundle, accessTokenHash);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return finalBundle.user;
  }

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const db = await this.open();
    const now = Date.now();
    db.prepare("DELETE FROM api_rate_limits WHERE window_start < ?").run(now - windowMs * 4);

    const row = db.prepare("SELECT window_start, count FROM api_rate_limits WHERE key = ?").get(key) as
      | { window_start: number; count: number }
      | undefined;

    if (!row || now - Number(row.window_start) >= windowMs) {
      db.prepare(
        `INSERT INTO api_rate_limits (key, window_start, count)
         VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`
      ).run(key, now);
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }

    if (Number(row.count) >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - Number(row.window_start))) / 1000))
      };
    }

    db.prepare("UPDATE api_rate_limits SET count = count + 1 WHERE key = ?").run(key);
    return {
      allowed: true,
      remaining: Math.max(0, limit - Number(row.count) - 1),
      retryAfterSeconds: 0
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const db = await this.open();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    db.prepare("DELETE FROM api_locks WHERE expires_at <= ?").run(now);

    try {
      db.prepare("INSERT INTO api_locks (key, expires_at) VALUES (?, ?)").run(key, expiresAt);
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }

  async releaseLock(key: string): Promise<void> {
    const db = await this.open();
    db.prepare("DELETE FROM api_locks WHERE key = ?").run(key);
  }

  async exportUserToSqlite(username: string, outputPath: string): Promise<void> {
    const bundle = await this.exportUserBundle(username);
    await writeBundleToSqlite(bundle, outputPath);
  }

  private async assertUser(username: string): Promise<UserRow> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  private async getUserAccessTokenHash(username: string): Promise<string | null> {
    const row = await this.getOne<{ access_token_hash: string | null }>(
      "SELECT access_token_hash FROM users WHERE username = ?",
      [username]
    );
    return row?.access_token_hash ?? null;
  }

  private async getAll<T>(
    sql: string,
    args: SqlValue[]
  ): Promise<T[]> {
    const db = await this.open();
    return db.prepare(sql).all(...args) as T[];
  }

  private async getOne<T>(
    sql: string,
    args: SqlValue[]
  ): Promise<T | null> {
    const db = await this.open();
    return (db.prepare(sql).get(...args) as T | undefined) ?? null;
  }

  private async open(): Promise<import("node:sqlite").DatabaseSync> {
    if (!this.db) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const { DatabaseSync } = loadSqlite();
      this.db = new DatabaseSync(this.filePath);
      this.db.exec("PRAGMA foreign_keys = ON");
    }

    return this.db;
  }
}

class LibsqlStorage implements StorageAdapter {
  private clientPromise: Promise<LibsqlClient> | null = null;

  constructor(
    private readonly url: string,
    private readonly authToken?: string
  ) {}

  async ensureSchema(): Promise<void> {
    const client = await this.client();
    for (const statement of splitSql(schemaSql)) {
      await client.execute(statement);
    }
    await migrateLibsqlSchema(client);
  }

  async createUser(
    username: string,
    accessTokenHash: string | null = null,
    learningGoal: LearningGoal = defaultLearningGoal
  ): Promise<UserRow> {
    const client = await this.client();
    const createdAt = nowIso();
    await client.execute({
      sql: `INSERT INTO users
            (username, access_token_hash, created_at, learning_goal, target_difficulty, estimated_level, assessment_completed_at)
            VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
      args: [username, accessTokenHash, createdAt, learningGoal]
    });

    return {
      username,
      createdAt,
      learningGoal,
      targetDifficulty: null,
      estimatedLevel: null,
      assessmentCompletedAt: null
    };
  }

  async getUser(username: string): Promise<UserRow | null> {
    const row = await this.getOne<UserTableRow>("SELECT * FROM users WHERE username = ?", [username]);
    return row ? mapUser(row) : null;
  }

  async verifyUserAccess(username: string, accessTokenHash: string): Promise<boolean> {
    const row = await this.getOne<{ access_token_hash: string | null }>(
      "SELECT access_token_hash FROM users WHERE username = ?",
      [username]
    );
    return Boolean(row?.access_token_hash && row.access_token_hash === accessTokenHash);
  }

  async resetUserData(username: string): Promise<UserRow> {
    await this.assertUser(username);
    const client = await this.client();

    await client.batch(
      [
        { sql: "DELETE FROM word_actions WHERE username = ?", args: [username] },
        { sql: "DELETE FROM word_records WHERE username = ?", args: [username] },
        { sql: "DELETE FROM recommendation_batches WHERE username = ?", args: [username] },
        { sql: "DELETE FROM assessment_answers WHERE username = ?", args: [username] },
        { sql: "DELETE FROM assessment_sessions WHERE username = ?", args: [username] },
        {
          sql: `UPDATE users
                SET target_difficulty = NULL, estimated_level = NULL, assessment_completed_at = NULL
                WHERE username = ?`,
          args: [username]
        }
      ],
      "write"
    );

    return this.assertUser(username);
  }

  async renameUser(oldUsername: string, newUsername: string): Promise<UserRow> {
    if (oldUsername === newUsername) {
      return this.assertUser(oldUsername);
    }

    const current = await this.assertUser(oldUsername);
    const accessTokenHash = await this.getUserAccessTokenHash(oldUsername);
    const existing = await this.getUser(newUsername);
    if (existing) {
      throw new Error("User ID already exists");
    }

    const client = await this.client();
    await client.batch(
      [
        {
          sql: `INSERT INTO users
                (username, access_token_hash, created_at, learning_goal, target_difficulty, estimated_level, assessment_completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            newUsername,
            accessTokenHash,
            current.createdAt,
            current.learningGoal,
            current.targetDifficulty,
            current.estimatedLevel,
            current.assessmentCompletedAt
          ]
        },
        ...[
          "assessment_sessions",
          "assessment_answers",
          "recommendation_batches",
          "word_records",
          "word_actions"
        ].map((table) => ({
          sql: `UPDATE ${table} SET username = ? WHERE username = ?`,
          args: [newUsername, oldUsername]
        })),
        { sql: "DELETE FROM users WHERE username = ?", args: [oldUsername] }
      ],
      "write"
    );

    return this.assertUser(newUsername);
  }

  async updateLearningGoal(username: string, learningGoal: LearningGoal): Promise<UserRow> {
    await this.assertUser(username);
    const client = await this.client();
    await client.execute({
      sql: "UPDATE users SET learning_goal = ? WHERE username = ?",
      args: [learningGoal, username]
    });

    return this.assertUser(username);
  }

  async startAssessment(username: string, sessionId: string): Promise<AssessmentSessionRow> {
    await this.assertUser(username);
    const client = await this.client();
    const startedAt = nowIso();

    await client.execute({
      sql: `INSERT INTO assessment_sessions
            (id, username, started_at, submitted_at, score, estimated_level, target_difficulty)
            VALUES (?, ?, ?, NULL, NULL, NULL, NULL)`,
      args: [sessionId, username, startedAt]
    });

    return {
      id: sessionId,
      username,
      startedAt,
      submittedAt: null,
      score: null,
      estimatedLevel: null,
      targetDifficulty: null
    };
  }

  async saveAssessmentResult(username: string, score: AssessmentScore): Promise<void> {
    await this.assertUser(username);
    const client = await this.client();
    const submittedAt = nowIso();
    const statements: LibsqlStatement[] = [
      {
        sql: `UPDATE assessment_sessions
              SET submitted_at = ?, score = ?, estimated_level = ?, target_difficulty = ?
              WHERE id = ? AND username = ?`,
        args: [
          submittedAt,
          score.score,
          score.estimatedLevel,
          score.targetDifficulty,
          score.sessionId,
          username
        ]
      },
      ...score.answers.map((answer) => ({
        sql: `INSERT INTO assessment_answers
              (id, session_id, username, question_id, word, correct_answer, selected_answer, is_correct, difficulty)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          score.sessionId,
          username,
          answer.question.id,
          answer.question.word,
          answer.question.correctAnswer,
          answer.selectedAnswer,
          answer.isCorrect ? 1 : 0,
          answer.question.difficulty
        ]
      })),
      {
        sql: `UPDATE users
              SET target_difficulty = ?, estimated_level = ?, assessment_completed_at = ?
              WHERE username = ?`,
        args: [score.targetDifficulty, score.estimatedLevel, submittedAt, username]
      }
    ];

    await client.batch(statements, "write");
  }

  async getLearningContext(username: string): Promise<LearningContext> {
    const user = await this.assertUser(username);
    const rows = await this.getAll<WordRecordTableRow>(
      `SELECT * FROM word_records WHERE username = ? ORDER BY created_at DESC`,
      [username]
    );
    const words = rows.map(mapWordRecord);

    return {
      learningGoal: user.learningGoal,
      targetDifficulty: user.targetDifficulty ?? 4,
      estimatedLevel: user.estimatedLevel,
      learnedWords: words.filter((word) => word.status === "learned").map((word) => word.word),
      tooEasyWords: words.filter((word) => word.status === "too_easy").map((word) => word.word),
      learningWords: words.filter((word) => word.status === "learning").map((word) => word.word),
      recentWords: words.slice(0, 30).map((word) => word.word)
    };
  }

  async createRecommendationBatch(
    username: string,
    words: RecommendationWordInput[],
    source: string,
    targetDifficulty: number
  ): Promise<{ batch: RecommendationBatchRow; words: WordRecordRow[] }> {
    await this.assertUser(username);
    const client = await this.client();
    const createdAt = nowIso();
    const batch: RecommendationBatchRow = {
      id: randomUUID(),
      username,
      createdAt,
      source,
      targetDifficulty
    };
    const inserted = words.map((word, index) => {
      const wordCreatedAt = offsetIso(createdAt, index);

      return {
        id: randomUUID(),
        batchId: batch.id,
        username,
        word: word.word,
        partOfSpeech: word.partOfSpeech,
        definitionZh: word.definitionZh,
        exampleEn: word.exampleEn,
        exampleZh: word.exampleZh,
        difficultyReason: word.difficultyReason,
        difficulty: word.difficulty,
        status: "new" as const,
        createdAt: wordCreatedAt,
        updatedAt: wordCreatedAt
      };
    });

    await client.batch(
      [
        {
          sql: `INSERT INTO recommendation_batches (id, username, created_at, source, target_difficulty)
                VALUES (?, ?, ?, ?, ?)`,
          args: [batch.id, username, createdAt, source, targetDifficulty]
        },
        ...inserted.map((word) => ({
          sql: `INSERT INTO word_records
                (id, batch_id, username, word, part_of_speech, definition_zh, example_en, example_zh,
                 difficulty_reason, difficulty, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            word.id,
            word.batchId,
            username,
            word.word,
            word.partOfSpeech,
            word.definitionZh,
            word.exampleEn,
            word.exampleZh,
            word.difficultyReason,
            word.difficulty,
            word.status,
            word.createdAt,
            word.updatedAt
          ]
        }))
      ],
      "write"
    );

    return { batch, words: inserted };
  }

  async recordWordAction(
    username: string,
    wordId: string,
    action: WordAction
  ): Promise<WordRecordRow> {
    await this.assertUser(username);
    const client = await this.client();
    const createdAt = nowIso();

    await client.batch(
      [
        {
          sql: `UPDATE word_records SET status = ?, updated_at = ? WHERE id = ? AND username = ?`,
          args: [action, createdAt, wordId, username]
        },
        {
          sql: `INSERT INTO word_actions (id, word_id, username, action, created_at)
                VALUES (?, ?, ?, ?, ?)`,
          args: [randomUUID(), wordId, username, action, createdAt]
        }
      ],
      "write"
    );

    const word = await this.getOne<WordRecordTableRow>(
      "SELECT * FROM word_records WHERE id = ? AND username = ?",
      [wordId, username]
    );
    if (!word) {
      throw new Error("Word record not found");
    }

    return mapWordRecord(word);
  }

  async getUserState(username: string): Promise<UserState | null> {
    const user = await this.getUser(username);
    if (!user) {
      return null;
    }

    const latestBatchRow = await this.getOne<RecommendationBatchTableRow>(
      `SELECT * FROM recommendation_batches WHERE username = ? ORDER BY created_at DESC LIMIT 1`,
      [username]
    );
    const latestBatch = latestBatchRow ? mapBatch(latestBatchRow) : null;
    const latestRows = latestBatch
      ? await this.getAll<WordRecordTableRow>(
          `SELECT * FROM word_records WHERE username = ? AND batch_id = ? ORDER BY created_at ASC`,
          [username, latestBatch.id]
        )
      : [];
    const history = (
      await this.getAll<WordRecordTableRow>(
        `SELECT * FROM word_records WHERE username = ? ORDER BY created_at DESC`,
        [username]
      )
    ).map(mapWordRecord);

    return {
      user,
      latestBatch,
      latestWords: latestRows.map(mapWordRecord),
      history,
      stats: {
        totalWords: history.length,
        learned: history.filter((word) => word.status === "learned").length,
        tooEasy: history.filter((word) => word.status === "too_easy").length,
        learning: history.filter((word) => word.status === "learning").length
      }
    };
  }

  async exportUserBundle(username: string): Promise<UserBundle> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error("User not found");
    }

    return {
      user,
      assessmentSessions: (
        await this.getAll<AssessmentSessionTableRow>(
          "SELECT * FROM assessment_sessions WHERE username = ? ORDER BY started_at ASC",
          [username]
        )
      ).map(mapAssessmentSession),
      assessmentAnswers: (
        await this.getAll<AssessmentAnswerTableRow>(
          "SELECT * FROM assessment_answers WHERE username = ? ORDER BY id ASC",
          [username]
        )
      ).map(mapAssessmentAnswer),
      recommendationBatches: (
        await this.getAll<RecommendationBatchTableRow>(
          "SELECT * FROM recommendation_batches WHERE username = ? ORDER BY created_at ASC",
          [username]
        )
      ).map(mapBatch),
      wordRecords: (
        await this.getAll<WordRecordTableRow>(
          "SELECT * FROM word_records WHERE username = ? ORDER BY created_at ASC",
          [username]
        )
      ).map(mapWordRecord),
      wordActions: (
        await this.getAll<WordActionTableRow>(
          "SELECT * FROM word_actions WHERE username = ? ORDER BY created_at ASC",
          [username]
        )
      ).map(mapWordAction)
    };
  }

  async importUserBundle(bundle: UserBundle, targetUsername?: string): Promise<UserRow> {
    const client = await this.client();
    const imported = validateUserBundle(bundle);
    const finalBundle = targetUsername ? rewriteBundleUsername(imported, targetUsername) : imported;
    const username = finalBundle.user.username;
    const accessTokenHash = targetUsername ? await this.getUserAccessTokenHash(targetUsername) : null;

    if (targetUsername && accessTokenHash === null) {
      throw new Error("User not found");
    }

    const deleteStatements: LibsqlStatement[] = [
      { sql: "DELETE FROM users WHERE username = ?", args: [username] }
    ];
    const insertStatements = bundleToStatements(finalBundle, accessTokenHash);

    await client.batch([...deleteStatements, ...insertStatements], "write");
    return finalBundle.user;
  }

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const client = await this.client();
    const now = Date.now();
    await client.execute({
      sql: "DELETE FROM api_rate_limits WHERE window_start < ?",
      args: [now - windowMs * 4]
    });

    const row = await this.getOne<{ window_start: number; count: number }>(
      "SELECT window_start, count FROM api_rate_limits WHERE key = ?",
      [key]
    );

    if (!row || now - Number(row.window_start) >= windowMs) {
      await client.execute({
        sql: `INSERT INTO api_rate_limits (key, window_start, count)
              VALUES (?, ?, 1)
              ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
        args: [key, now]
      });
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }

    if (Number(row.count) >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - Number(row.window_start))) / 1000))
      };
    }

    await client.execute({
      sql: "UPDATE api_rate_limits SET count = count + 1 WHERE key = ?",
      args: [key]
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - Number(row.count) - 1),
      retryAfterSeconds: 0
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const client = await this.client();
    const now = Date.now();

    await client.execute({ sql: "DELETE FROM api_locks WHERE expires_at <= ?", args: [now] });

    try {
      await client.execute({
        sql: "INSERT INTO api_locks (key, expires_at) VALUES (?, ?)",
        args: [key, now + ttlMs]
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }

  async releaseLock(key: string): Promise<void> {
    const client = await this.client();
    await client.execute({ sql: "DELETE FROM api_locks WHERE key = ?", args: [key] });
  }

  private async assertUser(username: string): Promise<UserRow> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  private async getUserAccessTokenHash(username: string): Promise<string | null> {
    const row = await this.getOne<{ access_token_hash: string | null }>(
      "SELECT access_token_hash FROM users WHERE username = ?",
      [username]
    );
    return row?.access_token_hash ?? null;
  }

  private async getAll<T>(
    sql: string,
    args: SqlValue[]
  ): Promise<T[]> {
    const client = await this.client();
    const result = await client.execute({ sql, args });
    return result.rows as T[];
  }

  private async getOne<T>(
    sql: string,
    args: SqlValue[]
  ): Promise<T | null> {
    const rows = await this.getAll<T>(sql, args);
    return rows[0] ?? null;
  }

  private async client(): Promise<LibsqlClient> {
    if (!this.clientPromise) {
      this.clientPromise = import("@libsql/client").then(({ createClient }) =>
        createClient({
          url: this.url,
          authToken: this.authToken
        }) as LibsqlClient
      );
    }

    return this.clientPromise;
  }
}

export async function writeBundleToSqlite(bundle: UserBundle, outputPath: string): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(outputPath);

  db.exec(schemaSql);
  migrateNodeSchema(db);
  db.exec("BEGIN");
  try {
    insertBundle(db, validateUserBundle(bundle));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export async function readBundleFromSqlite(filePath: string): Promise<UserBundle> {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(filePath);

  try {
    validateSchema(db);
    assertImportTableCounts(db);
    const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as UserTableRow[];
    if (users.length !== 1) {
      throw new Error("Imported database must contain exactly one user");
    }

    const username = users[0].username;
    return validateUserBundle({
      user: mapUser(users[0]),
      assessmentSessions: (
        db.prepare("SELECT * FROM assessment_sessions WHERE username = ?").all(username) as AssessmentSessionTableRow[]
      ).map(mapAssessmentSession),
      assessmentAnswers: (
        db.prepare("SELECT * FROM assessment_answers WHERE username = ?").all(username) as AssessmentAnswerTableRow[]
      ).map(mapAssessmentAnswer),
      recommendationBatches: (
        db.prepare("SELECT * FROM recommendation_batches WHERE username = ?").all(username) as RecommendationBatchTableRow[]
      ).map(mapBatch),
      wordRecords: (
        db.prepare("SELECT * FROM word_records WHERE username = ?").all(username) as WordRecordTableRow[]
      ).map(mapWordRecord),
      wordActions: (
        db.prepare("SELECT * FROM word_actions WHERE username = ?").all(username) as WordActionTableRow[]
      ).map(mapWordAction)
    });
  } finally {
    db.close();
  }
}

function insertBundle(
  db: import("node:sqlite").DatabaseSync,
  bundle: UserBundle,
  accessTokenHash: string | null = null
): void {
  db.prepare(
    `INSERT INTO users
     (username, access_token_hash, created_at, learning_goal, target_difficulty, estimated_level, assessment_completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bundle.user.username,
    accessTokenHash,
    bundle.user.createdAt,
    bundle.user.learningGoal,
    bundle.user.targetDifficulty,
    bundle.user.estimatedLevel,
    bundle.user.assessmentCompletedAt
  );

  for (const session of bundle.assessmentSessions) {
    db.prepare(
      `INSERT INTO assessment_sessions
       (id, username, started_at, submitted_at, score, estimated_level, target_difficulty)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      session.username,
      session.startedAt,
      session.submittedAt,
      session.score,
      session.estimatedLevel,
      session.targetDifficulty
    );
  }

  for (const answer of bundle.assessmentAnswers) {
    db.prepare(
      `INSERT INTO assessment_answers
       (id, session_id, username, question_id, word, correct_answer, selected_answer, is_correct, difficulty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      answer.id,
      answer.sessionId,
      answer.username,
      answer.questionId,
      answer.word,
      answer.correctAnswer,
      answer.selectedAnswer,
      answer.isCorrect,
      answer.difficulty
    );
  }

  for (const batch of bundle.recommendationBatches) {
    db.prepare(
      `INSERT INTO recommendation_batches (id, username, created_at, source, target_difficulty)
       VALUES (?, ?, ?, ?, ?)`
    ).run(batch.id, batch.username, batch.createdAt, batch.source, batch.targetDifficulty);
  }

  for (const word of bundle.wordRecords) {
    db.prepare(
      `INSERT INTO word_records
       (id, batch_id, username, word, part_of_speech, definition_zh, example_en, example_zh,
        difficulty_reason, difficulty, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      word.id,
      word.batchId,
      word.username,
      word.word,
      word.partOfSpeech,
      word.definitionZh,
      word.exampleEn,
      word.exampleZh,
      word.difficultyReason,
      word.difficulty,
      word.status,
      word.createdAt,
      word.updatedAt
    );
  }

  for (const action of bundle.wordActions) {
    db.prepare(
      `INSERT INTO word_actions (id, word_id, username, action, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(action.id, action.wordId, action.username, action.action, action.createdAt);
  }
}

function deleteUserData(db: import("node:sqlite").DatabaseSync, username: string): void {
  db.prepare("DELETE FROM users WHERE username = ?").run(username);
}

function validateSchema(db: import("node:sqlite").DatabaseSync): void {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>;
  const names = new Set(rows.map((row) => row.name));
  const missing = [
    "users",
    "assessment_sessions",
    "assessment_answers",
    "recommendation_batches",
    "word_records",
    "word_actions"
  ].filter((name) => !names.has(name));

  if (missing.length > 0) {
    throw new Error(`Imported database is missing tables: ${missing.join(", ")}`);
  }
}

function assertImportTableCounts(db: import("node:sqlite").DatabaseSync): void {
  const limits = serverConfig.security.importLimits;
  const tableLimits: Record<string, number> = {
    users: 1,
    assessment_sessions: limits.maxAssessmentSessions,
    assessment_answers: limits.maxAssessmentAnswers,
    recommendation_batches: limits.maxRecommendationBatches,
    word_records: limits.maxWordRecords,
    word_actions: limits.maxWordActions
  };

  for (const [table, maxRows] of Object.entries(tableLimits)) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    if (Number(row.count) > maxRows) {
      throw new Error(`Imported database has too many rows in ${table}`);
    }
  }
}

function validateUserBundle(bundle: UserBundle): UserBundle {
  const limits = serverConfig.security.importLimits;
  const text = z.string().min(1).max(limits.maxTextLength);
  const shortText = z.string().min(1).max(120);
  const nullableText = z.string().max(limits.maxTextLength).nullable();
  const username = z.string().refine(isValidUsername, "Invalid username");
  const id = z.string().min(1).max(120);
  const difficulty = z.number().int().min(1).max(10);
  const timestamp = z.string().min(1).max(80);

  const parsed = z
    .object({
      user: z.object({
        username,
        createdAt: timestamp,
        learningGoal: z.enum(learningGoalIds).default(defaultLearningGoal),
        targetDifficulty: difficulty.nullable(),
        estimatedLevel: nullableText,
        assessmentCompletedAt: timestamp.nullable()
      }),
      assessmentSessions: z
        .array(
          z.object({
            id,
            username,
            startedAt: timestamp,
            submittedAt: timestamp.nullable(),
            score: z.number().int().min(0).max(10).nullable(),
            estimatedLevel: nullableText,
            targetDifficulty: difficulty.nullable()
          })
        )
        .max(limits.maxAssessmentSessions),
      assessmentAnswers: z
        .array(
          z.object({
            id,
            sessionId: id,
            username,
            questionId: id,
            word: shortText,
            correctAnswer: text,
            selectedAnswer: text,
            isCorrect: z.union([z.literal(0), z.literal(1)]),
            difficulty
          })
        )
        .max(limits.maxAssessmentAnswers),
      recommendationBatches: z
        .array(
          z.object({
            id,
            username,
            createdAt: timestamp,
            source: shortText,
            targetDifficulty: difficulty
          })
        )
        .max(limits.maxRecommendationBatches),
      wordRecords: z
        .array(
          z.object({
            id,
            batchId: id,
            username,
            word: shortText,
            partOfSpeech: shortText,
            definitionZh: text,
            exampleEn: text,
            exampleZh: text,
            difficultyReason: text,
            difficulty,
            status: z.enum(["new", "learned", "too_easy", "learning"]),
            createdAt: timestamp,
            updatedAt: timestamp
          })
        )
        .max(limits.maxWordRecords),
      wordActions: z
        .array(
          z.object({
            id,
            wordId: id,
            username,
            action: z.enum(["learned", "too_easy", "learning"]),
            createdAt: timestamp
          })
        )
        .max(limits.maxWordActions)
    })
    .parse(bundle);

  assertBundleConsistency(parsed);
  return parsed;
}

function assertBundleConsistency(bundle: UserBundle): void {
  const username = bundle.user.username;
  const sessionIds = new Set(bundle.assessmentSessions.map((session) => session.id));
  const batchIds = new Set(bundle.recommendationBatches.map((batch) => batch.id));
  const wordIds = new Set(bundle.wordRecords.map((word) => word.id));

  for (const row of [
    ...bundle.assessmentSessions,
    ...bundle.assessmentAnswers,
    ...bundle.recommendationBatches,
    ...bundle.wordRecords,
    ...bundle.wordActions
  ]) {
    if (row.username !== username) {
      throw new Error("Imported database contains rows for multiple users");
    }
  }

  for (const answer of bundle.assessmentAnswers) {
    if (!sessionIds.has(answer.sessionId)) {
      throw new Error("Imported database contains orphan assessment answers");
    }
  }

  for (const word of bundle.wordRecords) {
    if (!batchIds.has(word.batchId)) {
      throw new Error("Imported database contains orphan word records");
    }
  }

  for (const action of bundle.wordActions) {
    if (!wordIds.has(action.wordId)) {
      throw new Error("Imported database contains orphan word actions");
    }
  }
}

function rewriteBundleUsername(bundle: UserBundle, username: string): UserBundle {
  if (!isValidUsername(username)) {
    throw new Error("Invalid username");
  }

  return {
    user: {
      ...bundle.user,
      username
    },
    assessmentSessions: bundle.assessmentSessions.map((session) => ({ ...session, username })),
    assessmentAnswers: bundle.assessmentAnswers.map((answer) => ({ ...answer, username })),
    recommendationBatches: bundle.recommendationBatches.map((batch) => ({ ...batch, username })),
    wordRecords: bundle.wordRecords.map((word) => ({ ...word, username })),
    wordActions: bundle.wordActions.map((action) => ({ ...action, username }))
  };
}

function migrateNodeSchema(db: import("node:sqlite").DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "access_token_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN access_token_hash TEXT");
  }
  if (!columns.some((column) => column.name === "learning_goal")) {
    db.exec(`ALTER TABLE users ADD COLUMN learning_goal TEXT NOT NULL DEFAULT '${defaultLearningGoal}'`);
  }
}

async function migrateLibsqlSchema(client: LibsqlClient): Promise<void> {
  const result = await client.execute("PRAGMA table_info(users)");
  const hasAccessTokenHash = result.rows.some((row) => row.name === "access_token_hash");
  if (!hasAccessTokenHash) {
    await client.execute("ALTER TABLE users ADD COLUMN access_token_hash TEXT");
  }
  const hasLearningGoal = result.rows.some((row) => row.name === "learning_goal");
  if (!hasLearningGoal) {
    await client.execute(
      `ALTER TABLE users ADD COLUMN learning_goal TEXT NOT NULL DEFAULT '${defaultLearningGoal}'`
    );
  }
}

function bundleToStatements(
  bundle: UserBundle,
  accessTokenHash: string | null = null
): LibsqlStatement[] {
  return [
    {
      sql: `INSERT INTO users
            (username, access_token_hash, created_at, learning_goal, target_difficulty, estimated_level, assessment_completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        bundle.user.username,
        accessTokenHash,
        bundle.user.createdAt,
        bundle.user.learningGoal,
        bundle.user.targetDifficulty,
        bundle.user.estimatedLevel,
        bundle.user.assessmentCompletedAt
      ]
    },
    ...bundle.assessmentSessions.map((session) => ({
      sql: `INSERT INTO assessment_sessions
            (id, username, started_at, submitted_at, score, estimated_level, target_difficulty)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        session.id,
        session.username,
        session.startedAt,
        session.submittedAt,
        session.score,
        session.estimatedLevel,
        session.targetDifficulty
      ]
    })),
    ...bundle.assessmentAnswers.map((answer) => ({
      sql: `INSERT INTO assessment_answers
            (id, session_id, username, question_id, word, correct_answer, selected_answer, is_correct, difficulty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        answer.id,
        answer.sessionId,
        answer.username,
        answer.questionId,
        answer.word,
        answer.correctAnswer,
        answer.selectedAnswer,
        answer.isCorrect,
        answer.difficulty
      ]
    })),
    ...bundle.recommendationBatches.map((batch) => ({
      sql: `INSERT INTO recommendation_batches (id, username, created_at, source, target_difficulty)
            VALUES (?, ?, ?, ?, ?)`,
      args: [batch.id, batch.username, batch.createdAt, batch.source, batch.targetDifficulty]
    })),
    ...bundle.wordRecords.map((word) => ({
      sql: `INSERT INTO word_records
            (id, batch_id, username, word, part_of_speech, definition_zh, example_en, example_zh,
             difficulty_reason, difficulty, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        word.id,
        word.batchId,
        word.username,
        word.word,
        word.partOfSpeech,
        word.definitionZh,
        word.exampleEn,
        word.exampleZh,
        word.difficultyReason,
        word.difficulty,
        word.status,
        word.createdAt,
        word.updatedAt
      ]
    })),
    ...bundle.wordActions.map((action) => ({
      sql: `INSERT INTO word_actions (id, word_id, username, action, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [action.id, action.wordId, action.username, action.action, action.createdAt]
    }))
  ];
}

function splitSql(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function nowIso(): string {
  return new Date().toISOString();
}

function offsetIso(baseIso: string, offsetMs: number): string {
  return new Date(new Date(baseIso).getTime() + offsetMs).toISOString();
}

function normalizeSqlitePath(value: string | undefined, cwd: string): string {
  const filePath = value?.trim() || join(cwd, "data", "words-explore.sqlite");
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function sanitizeStorageUrl(url: string): string {
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, "//[redacted]:[redacted]@");
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("unique") || message.includes("constraint");
}

interface LibsqlClient {
  execute(statement: string | LibsqlStatement): Promise<{ rows: Array<Record<string, unknown>> }>;
  batch(statements: LibsqlStatement[], mode?: "read" | "write"): Promise<unknown>;
}

interface LibsqlStatement {
  sql: string;
  args?: SqlValue[];
}

type SqlValue = string | number | null;

function loadSqlite(): typeof import("node:sqlite") {
  return nodeRequire("node:sqlite") as typeof import("node:sqlite");
}

interface UserTableRow extends Record<string, unknown> {
  username: string;
  access_token_hash: string | null;
  created_at: string;
  learning_goal?: string | null;
  target_difficulty: number | null;
  estimated_level: string | null;
  assessment_completed_at: string | null;
}

interface AssessmentSessionTableRow extends Record<string, unknown> {
  id: string;
  username: string;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  estimated_level: string | null;
  target_difficulty: number | null;
}

interface AssessmentAnswerTableRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  username: string;
  question_id: string;
  word: string;
  correct_answer: string;
  selected_answer: string;
  is_correct: number;
  difficulty: number;
}

interface RecommendationBatchTableRow extends Record<string, unknown> {
  id: string;
  username: string;
  created_at: string;
  source: string;
  target_difficulty: number;
}

interface WordRecordTableRow extends Record<string, unknown> {
  id: string;
  batch_id: string;
  username: string;
  word: string;
  part_of_speech: string;
  definition_zh: string;
  example_en: string;
  example_zh: string;
  difficulty_reason: string;
  difficulty: number;
  status: "new" | "learned" | "too_easy" | "learning";
  created_at: string;
  updated_at: string;
}

interface WordActionTableRow extends Record<string, unknown> {
  id: string;
  word_id: string;
  username: string;
  action: WordAction;
  created_at: string;
}

function mapUser(row: UserTableRow): UserRow {
  return {
    username: row.username,
    createdAt: row.created_at,
    learningGoal: normalizeLearningGoal(row.learning_goal),
    targetDifficulty: row.target_difficulty,
    estimatedLevel: row.estimated_level,
    assessmentCompletedAt: row.assessment_completed_at
  };
}

function mapAssessmentSession(row: AssessmentSessionTableRow): AssessmentSessionRow {
  return {
    id: row.id,
    username: row.username,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    score: row.score,
    estimatedLevel: row.estimated_level,
    targetDifficulty: row.target_difficulty
  };
}

function mapAssessmentAnswer(row: AssessmentAnswerTableRow): AssessmentAnswerRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    username: row.username,
    questionId: row.question_id,
    word: row.word,
    correctAnswer: row.correct_answer,
    selectedAnswer: row.selected_answer,
    isCorrect: row.is_correct,
    difficulty: row.difficulty
  };
}

function mapBatch(row: RecommendationBatchTableRow): RecommendationBatchRow {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    source: row.source,
    targetDifficulty: row.target_difficulty
  };
}

function mapWordRecord(row: WordRecordTableRow): WordRecordRow {
  return {
    id: row.id,
    batchId: row.batch_id,
    username: row.username,
    word: row.word,
    partOfSpeech: row.part_of_speech,
    definitionZh: row.definition_zh,
    exampleEn: row.example_en,
    exampleZh: row.example_zh,
    difficultyReason: row.difficulty_reason,
    difficulty: row.difficulty,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWordAction(row: WordActionTableRow): WordActionRow {
  return {
    id: row.id,
    wordId: row.word_id,
    username: row.username,
    action: row.action,
    createdAt: row.created_at
  };
}
