/**
 * Memory Database Module
 *
 * Persistent SQLite storage for tracking processed email threads across
 * scheduled task runs. Solves two problems:
 * 1. Cumulative threshold — tracks unprocessed emails across skipped runs
 * 2. Re-processing prevention — remembers which threads have been acted on
 *
 * DB location: ~/.config/superhuman-cli/memory.db (same dir as tokens.json)
 */

import { Database } from "bun:sqlite";
import { getConfigDir } from "../token-api";
import { mkdirSync } from "node:fs";

let _db: Database | null = null;

/**
 * Get (or create) the shared SQLite database connection.
 * Creates the schema on first open.
 */
export function getMemoryDb(): Database {
  if (_db) return _db;

  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });

  const dbPath = `${configDir}/memory.db`;
  _db = new Database(dbPath);

  // WAL mode for better concurrent read/write performance
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");

  initSchema(_db);
  return _db;
}

/**
 * Close the database connection. Useful for tests and graceful shutdown.
 */
export function closeMemoryDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * For testing: override the DB path by providing an open Database instance.
 */
export function setMemoryDbForTest(db: Database): void {
  _db = db;
  initSchema(db);
}

function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS processed_threads (
      thread_id TEXT NOT NULL,
      account_email TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT,
      sender TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (thread_id, account_email)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pending_threads (
      thread_id TEXT NOT NULL,
      account_email TEXT NOT NULL,
      subject TEXT,
      sender TEXT,
      snippet TEXT,
      date TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (thread_id, account_email)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_email TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      threads_processed INTEGER DEFAULT 0,
      threads_skipped INTEGER DEFAULT 0,
      was_full_run INTEGER DEFAULT 0,
      skip_reason TEXT
    )
  `);

  // Indexes for efficient queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_processed_account_date
          ON processed_threads(account_email, processed_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pending_account
          ON pending_threads(account_email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_run_account_date
          ON run_log(account_email, started_at)`);
}
