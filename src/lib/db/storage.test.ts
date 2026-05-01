import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  NodeSqliteStorage,
  readBundleFromSqlite,
  resolveStorageConfig,
  writeBundleToSqlite
} from "@/lib/db/storage";
import { assessmentBank, scoreAssessment } from "@/lib/assessment";
import type { RecommendationWordInput } from "@/lib/types";
import { generateAccessToken, hashAccessToken } from "@/lib/security";

const username = "bright-atlas-0000001";

describe("NodeSqliteStorage", () => {
  it("initializes schema, records actions, and round trips a user sqlite export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "words-explore-"));
    const dbPath = join(dir, "app.sqlite");
    const exportPath = join(dir, "export.sqlite");
    const storage = new NodeSqliteStorage(dbPath);
    const accessToken = generateAccessToken();
    const accessTokenHash = hashAccessToken(accessToken);

    await storage.ensureSchema();
    await storage.createUser(username, accessTokenHash, "cet6");
    expect(await storage.verifyUserAccess(username, accessTokenHash)).toBe(true);
    expect(await storage.verifyUserAccess(username, hashAccessToken("wrong-token-value-that-is-long-enough"))).toBe(false);
    const assessmentQuestions = assessmentBank.slice(0, 10);
    await storage.startAssessment(username, "00000000-0000-4000-8000-000000000001");
    await storage.saveAssessmentResult(
      username,
      scoreAssessment(
        "00000000-0000-4000-8000-000000000001",
        assessmentQuestions.map((question, index) => ({
          questionId: question.id,
          selectedAnswer: index < 3 ? question.correctAnswer : "错误"
        })),
        assessmentQuestions
      )
    );

    const batch = await storage.createRecommendationBatch(
      username,
      [sampleWord("coherent"), sampleWord("nuance")],
      "mock",
      6
    );
    await storage.recordWordAction(username, batch.words[0].id, "learned");
    await storage.recordWordAction(username, batch.words[1].id, "learning");

    const state = await storage.getUserState(username);
    expect(state?.user.learningGoal).toBe("cet6");
    expect(state?.stats.learned).toBe(1);
    expect(state?.stats.learning).toBe(1);
    expect(state?.latestWords).toHaveLength(2);
    expect(state?.latestWords.map((word) => word.word)).toEqual(["coherent", "nuance"]);

    const bundle = await storage.exportUserBundle(username);
    await writeBundleToSqlite(bundle, exportPath);
    const imported = await readBundleFromSqlite(exportPath);

    expect(imported.user.username).toBe(username);
    expect(imported.user.learningGoal).toBe("cet6");
    expect(imported.wordRecords).toHaveLength(2);
    expect(imported.wordActions).toHaveLength(2);

    const secondStorage = new NodeSqliteStorage(join(dir, "import.sqlite"));
    await secondStorage.ensureSchema();
    await secondStorage.importUserBundle(imported);
    const importedState = await secondStorage.getUserState(username);

    expect(importedState?.stats.totalWords).toBe(2);

    await secondStorage.renameUser(username, "custom-user-01");
    expect(await secondStorage.getUserState(username)).toBeNull();
    expect((await secondStorage.getUserState("custom-user-01"))?.stats.totalWords).toBe(2);

    await secondStorage.updateLearningGoal("custom-user-01", "toefl");
    expect((await secondStorage.getUserState("custom-user-01"))?.user.learningGoal).toBe("toefl");

    expect(await secondStorage.checkRateLimit("test-key", 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 1
    });
    expect(await secondStorage.checkRateLimit("test-key", 2, 60_000)).toMatchObject({
      allowed: true,
      remaining: 0
    });
    expect(await secondStorage.checkRateLimit("test-key", 2, 60_000)).toMatchObject({
      allowed: false,
      remaining: 0
    });
    expect(await secondStorage.acquireLock("test-lock", 60_000)).toBe(true);
    expect(await secondStorage.acquireLock("test-lock", 60_000)).toBe(false);
    await secondStorage.releaseLock("test-lock");
    expect(await secondStorage.acquireLock("test-lock", 60_000)).toBe(true);

    await secondStorage.resetUserData("custom-user-01");
    const resetState = await secondStorage.getUserState("custom-user-01");
    expect(resetState?.user.learningGoal).toBe("toefl");
    expect(resetState?.user.assessmentCompletedAt).toBeNull();
    expect(resetState?.stats.totalWords).toBe(0);
  });
});

describe("storage config", () => {
  it("supports configured file storage paths", () => {
    expect(
      resolveStorageConfig(
        {},
        "/repo",
        {
          driver: "file",
          sqlitePath: "storage/app.sqlite",
          libsqlUrl: "libsql://example.turso.io"
        }
      )
    ).toEqual({
      driver: "file",
      sqlitePath: "/repo/storage/app.sqlite"
    });
  });

  it("supports explicit libsql storage", () => {
    expect(
      resolveStorageConfig(
        {
          LIBSQL_AUTH_TOKEN: "token"
        },
        "/repo",
        {
          driver: "libsql",
          sqlitePath: "data/words-explore.sqlite",
          libsqlUrl: "libsql://example.turso.io"
        }
      )
    ).toEqual({
      driver: "libsql",
      libsqlUrl: "libsql://example.turso.io",
      libsqlAuthToken: "token"
    });
  });
});

function sampleWord(word: string): RecommendationWordInput {
  return {
    word,
    partOfSpeech: "noun",
    definitionZh: "示例释义",
    exampleEn: `The word ${word} appears in a useful sentence.`,
    exampleZh: `单词 ${word} 出现在一个有用的句子里。`,
    difficultyReason: "适合当前学习难度。",
    difficulty: 6
  };
}
