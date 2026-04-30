export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  target_difficulty INTEGER,
  estimated_level TEXT,
  assessment_completed_at TEXT
);

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  score INTEGER,
  estimated_level TEXT,
  target_difficulty INTEGER,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  username TEXT NOT NULL,
  question_id TEXT NOT NULL,
  word TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  selected_answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  difficulty INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendation_batches (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  target_difficulty INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_records (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  username TEXT NOT NULL,
  word TEXT NOT NULL,
  part_of_speech TEXT NOT NULL,
  definition_zh TEXT NOT NULL,
  example_en TEXT NOT NULL,
  example_zh TEXT NOT NULL,
  difficulty_reason TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'learned', 'too_easy', 'learning')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES recommendation_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_word_records_user_status ON word_records(username, status);
CREATE INDEX IF NOT EXISTS idx_word_records_user_created ON word_records(username, created_at DESC);

CREATE TABLE IF NOT EXISTS word_actions (
  id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('learned', 'too_easy', 'learning')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (word_id) REFERENCES word_records(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
`;

export const requiredTables = [
  "users",
  "assessment_sessions",
  "assessment_answers",
  "recommendation_batches",
  "word_records",
  "word_actions"
];
