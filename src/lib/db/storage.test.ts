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
import { scoreAssessment } from "@/lib/assessment";
import type { RecommendationWordInput } from "@/lib/types";

const username = "bright-atlas-0000001";

describe("NodeSqliteStorage", () => {
  it("initializes schema, records actions, and round trips a user sqlite export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "words-explore-"));
    const dbPath = join(dir, "app.sqlite");
    const exportPath = join(dir, "export.sqlite");
    const storage = new NodeSqliteStorage(dbPath);

    await storage.ensureSchema();
    await storage.createUser(username);
    await storage.startAssessment(username, "00000000-0000-4000-8000-000000000001");
    await storage.saveAssessmentResult(
      username,
      scoreAssessment("00000000-0000-4000-8000-000000000001", [
        { questionId: "a1", selectedAnswer: "很小的" },
        { questionId: "a2", selectedAnswer: "借入" },
        { questionId: "a3", selectedAnswer: "普通的" },
        { questionId: "a4", selectedAnswer: "错误" },
        { questionId: "a5", selectedAnswer: "错误" },
        { questionId: "a6", selectedAnswer: "错误" },
        { questionId: "a7", selectedAnswer: "错误" },
        { questionId: "a8", selectedAnswer: "错误" },
        { questionId: "a9", selectedAnswer: "错误" },
        { questionId: "a10", selectedAnswer: "错误" }
      ])
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
    expect(state?.stats.learned).toBe(1);
    expect(state?.stats.learning).toBe(1);
    expect(state?.latestWords).toHaveLength(2);
    expect(state?.latestWords.map((word) => word.word)).toEqual(["coherent", "nuance"]);

    const bundle = await storage.exportUserBundle(username);
    await writeBundleToSqlite(bundle, exportPath);
    const imported = await readBundleFromSqlite(exportPath);

    expect(imported.user.username).toBe(username);
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

    await secondStorage.resetUserData("custom-user-01");
    const resetState = await secondStorage.getUserState("custom-user-01");
    expect(resetState?.user.assessmentCompletedAt).toBeNull();
    expect(resetState?.stats.totalWords).toBe(0);
  });
});

describe("storage config", () => {
  it("keeps default storage in TypeScript config as a local sqlite file", () => {
    expect(resolveStorageConfig({}, "/repo")).toEqual({
      driver: "file",
      sqlitePath: "/repo/data/words-explore.sqlite"
    });
  });

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
