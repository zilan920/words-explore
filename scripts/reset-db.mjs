import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";

const dryRun = process.argv.includes("--dry-run");
const tables = [
  "word_actions",
  "word_records",
  "recommendation_batches",
  "assessment_answers",
  "assessment_sessions",
  "users",
  "api_rate_limits",
  "api_locks"
];

loadDotEnv(".env.local");

const { schemaSql } = await import("../src/lib/db/schema.ts");
const { serverConfig } = await import("../src/lib/serverConfig.ts");
const config = resolveStorageConfig(serverConfig.storage, process.env, process.cwd());

if (dryRun) {
  console.log(`[db:reset] dry run; target=${describeTarget(config)}`);
  process.exit(0);
}

if (config.driver === "file") {
  await resetFileDatabase(config.sqlitePath);
} else {
  await resetLibsqlDatabase(config.libsqlUrl, config.libsqlAuthToken);
}

console.log(`[db:reset] reset complete; target=${describeTarget(config)}`);

async function resetFileDatabase(sqlitePath) {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new DatabaseSync(sqlitePath);

  try {
    db.exec(schemaSql);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN");
    try {
      for (const table of tables) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

async function resetLibsqlDatabase(libsqlUrl, authToken) {
  const client = createClient({
    url: libsqlUrl,
    authToken
  });

  for (const statement of splitSql(schemaSql)) {
    await client.execute(statement);
  }

  await client.batch(
    tables.map((table) => ({
      sql: `DELETE FROM ${table}`,
      args: []
    })),
    "write"
  );

  client.close();
}

function describeTarget(config) {
  if (config.driver === "file") {
    return `file:${config.sqlitePath}`;
  }

  return `libsql:${sanitizeUrl(config.libsqlUrl)}`;
}

function resolveStorageConfig(storageConfig, env, cwd) {
  if (storageConfig.driver === "file") {
    const sqlitePath = storageConfig.sqlitePath?.trim() || join(cwd, "data", "words-explore.sqlite");

    return {
      driver: "file",
      sqlitePath: isAbsolute(sqlitePath) ? sqlitePath : resolve(cwd, sqlitePath)
    };
  }

  if (!storageConfig.libsqlUrl) {
    throw new Error("serverConfig.storage.libsqlUrl is required when storage.driver is libsql");
  }

  return {
    driver: "libsql",
    libsqlUrl: storageConfig.libsqlUrl,
    libsqlAuthToken: env.LIBSQL_AUTH_TOKEN
  };
}

function splitSql(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function sanitizeUrl(url) {
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
