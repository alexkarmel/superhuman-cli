/**
 * Memory Operations
 *
 * Core functions for the memory system. Used by MCP tool handlers.
 */

import { getMemoryDb } from "./db";

// ─── Types ───────────────────────────────────────────────────────────

export interface ThreadInfo {
  threadId: string;
  subject: string;
  sender: string;
  snippet?: string;
  date?: string;
}

export interface PreRunResult {
  shouldRun: boolean;
  reason: string;
  /** Total unprocessed threads (pending from prior skips + new this run) */
  totalUnprocessed: number;
  /** Threads the task should process (only present when shouldRun is true) */
  threads: ThreadInfo[];
  /** How many threads were already processed and skipped */
  alreadyProcessedCount: number;
  /** Run ID for this execution (use with completeRun) */
  runId: number;
}

export interface RecordResult {
  recorded: number;
  alreadyExisted: number;
}

export interface RunStats {
  totalProcessedAllTime: number;
  totalProcessedLast7Days: number;
  pendingCount: number;
  lastFullRunAt: string | null;
  lastRunAt: string | null;
  recentRuns: {
    startedAt: string;
    wasFullRun: boolean;
    threadsProcessed: number;
    skipReason: string | null;
  }[];
}

// ─── Pre-Run ─────────────────────────────────────────────────────────

/**
 * Pre-run check for scheduled task. Call this at the start of each run.
 *
 * 1. Registers new inbox threads into the pending table
 * 2. Filters out already-processed threads
 * 3. Checks cumulative pending count against threshold
 * 4. Returns a compact digest for the LLM
 *
 * @param accountEmail - The email account to check
 * @param inboxThreads - Current inbox threads (from superhuman_inbox/search)
 * @param threshold - Minimum unprocessed threads to trigger a full run (default: 10)
 */
export function preRun(
  accountEmail: string,
  inboxThreads: ThreadInfo[],
  threshold: number = 10
): PreRunResult {
  const db = getMemoryDb();

  // Start a run log entry
  const insertRun = db.prepare(
    `INSERT INTO run_log (account_email) VALUES (?)`
  );
  const result = insertRun.run(accountEmail);
  const runId = Number(result.lastInsertRowid);

  // Check which inbox threads are already processed
  const checkProcessed = db.prepare(
    `SELECT thread_id FROM processed_threads WHERE thread_id = ? AND account_email = ?`
  );

  let alreadyProcessedCount = 0;
  const newThreads: ThreadInfo[] = [];

  for (const thread of inboxThreads) {
    const existing = checkProcessed.get(thread.threadId, accountEmail) as { thread_id: string } | null;
    if (existing) {
      alreadyProcessedCount++;
    } else {
      newThreads.push(thread);
    }
  }

  // Upsert new threads into pending table
  const upsertPending = db.prepare(`
    INSERT INTO pending_threads (thread_id, account_email, subject, sender, snippet, date)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, account_email) DO UPDATE SET
      subject = excluded.subject,
      sender = excluded.sender,
      snippet = excluded.snippet,
      date = excluded.date
  `);

  for (const t of newThreads) {
    upsertPending.run(t.threadId, accountEmail, t.subject, t.sender, t.snippet ?? "", t.date ?? "");
  }

  // Get total pending count (includes threads from previous skipped runs)
  const pendingCount = db.prepare(
    `SELECT COUNT(*) as count FROM pending_threads WHERE account_email = ?`
  ).get(accountEmail) as { count: number };

  const totalUnprocessed = pendingCount.count;

  if (totalUnprocessed < threshold) {
    // Update run log as skipped
    db.prepare(
      `UPDATE run_log SET was_full_run = 0, skip_reason = ?, threads_skipped = ?
       WHERE id = ?`
    ).run(
      `Only ${totalUnprocessed} unprocessed thread(s) (threshold: ${threshold})`,
      alreadyProcessedCount,
      runId
    );

    return {
      shouldRun: false,
      reason: `Only ${totalUnprocessed} unprocessed thread(s), below threshold of ${threshold}. Will accumulate until threshold is met.`,
      totalUnprocessed,
      threads: [],
      alreadyProcessedCount,
      runId,
    };
  }

  // Threshold met — return all pending threads for processing
  const allPending = db.prepare(
    `SELECT thread_id, subject, sender, snippet, date FROM pending_threads
     WHERE account_email = ?
     ORDER BY first_seen_at ASC`
  ).all(accountEmail) as { thread_id: string; subject: string; sender: string; snippet: string; date: string }[];

  const threads: ThreadInfo[] = allPending.map(row => ({
    threadId: row.thread_id,
    subject: row.subject,
    sender: row.sender,
    snippet: row.snippet,
    date: row.date,
  }));

  // Mark run as full
  db.prepare(
    `UPDATE run_log SET was_full_run = 1 WHERE id = ?`
  ).run(runId);

  return {
    shouldRun: true,
    reason: `${totalUnprocessed} unprocessed thread(s) meets threshold of ${threshold}. Processing all pending threads.`,
    totalUnprocessed,
    threads,
    alreadyProcessedCount,
    runId,
  };
}

// ─── Filter ──────────────────────────────────────────────────────────

/**
 * Filter a list of thread IDs to those NOT already processed.
 * Used by inbox/search tools to hide threads that have been acted on in
 * previous runs — prevents the scheduled task from reprocessing the same
 * emails every hour.
 */
export function filterUnprocessed(
  accountEmail: string,
  threadIds: string[]
): { unprocessedIds: Set<string>; processedCount: number } {
  if (threadIds.length === 0) {
    return { unprocessedIds: new Set(), processedCount: 0 };
  }
  const db = getMemoryDb();
  const placeholders = threadIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT thread_id FROM processed_threads
       WHERE account_email = ? AND thread_id IN (${placeholders})`
    )
    .all(accountEmail, ...threadIds) as { thread_id: string }[];
  const processedSet = new Set(rows.map((r) => r.thread_id));
  const unprocessedIds = new Set(threadIds.filter((id) => !processedSet.has(id)));
  return { unprocessedIds, processedCount: processedSet.size };
}

// ─── Record ──────────────────────────────────────────────────────────

/**
 * Record that threads have been processed (starred, archived, etc.).
 * Moves them from pending to processed.
 */
export function recordProcessed(
  accountEmail: string,
  threads: { threadId: string; action: string; subject?: string; sender?: string }[]
): RecordResult {
  const db = getMemoryDb();

  const insertProcessed = db.prepare(`
    INSERT INTO processed_threads (thread_id, account_email, action, subject, sender)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, account_email) DO UPDATE SET
      action = excluded.action,
      processed_at = datetime('now')
  `);

  const removePending = db.prepare(
    `DELETE FROM pending_threads WHERE thread_id = ? AND account_email = ?`
  );

  let recorded = 0;
  let alreadyExisted = 0;

  for (const t of threads) {
    // Check if it was already processed
    const existing = db.prepare(
      `SELECT thread_id FROM processed_threads WHERE thread_id = ? AND account_email = ?`
    ).get(t.threadId, accountEmail);

    if (existing) alreadyExisted++;

    insertProcessed.run(t.threadId, accountEmail, t.action, t.subject ?? "", t.sender ?? "");
    removePending.run(t.threadId, accountEmail);
    recorded++;
  }

  return { recorded, alreadyExisted };
}

// ─── Complete Run ────────────────────────────────────────────────────

/**
 * Mark a run as completed and update stats.
 */
export function completeRun(
  runId: number,
  threadsProcessed: number
): void {
  const db = getMemoryDb();
  db.prepare(
    `UPDATE run_log SET completed_at = datetime('now'), threads_processed = ?
     WHERE id = ?`
  ).run(threadsProcessed, runId);
}

// ─── Check Thread ────────────────────────────────────────────────────

/**
 * Check if a specific thread has been processed before.
 */
export function isThreadProcessed(
  accountEmail: string,
  threadId: string
): { processed: boolean; action?: string; processedAt?: string } {
  const db = getMemoryDb();
  const row = db.prepare(
    `SELECT action, processed_at FROM processed_threads
     WHERE thread_id = ? AND account_email = ?`
  ).get(threadId, accountEmail) as { action: string; processed_at: string } | null;

  if (!row) return { processed: false };
  return { processed: true, action: row.action, processedAt: row.processed_at };
}

// ─── Cleanup ─────────────────────────────────────────────────────────

/**
 * Remove old processed thread entries and run logs.
 * @param maxAgeDays - Remove entries older than this many days (default: 7)
 * @returns Number of entries removed
 */
export function cleanup(maxAgeDays: number = 7): { removedThreads: number; removedRuns: number } {
  const db = getMemoryDb();

  const threadResult = db.prepare(
    `DELETE FROM processed_threads
     WHERE processed_at < datetime('now', ? || ' days')`
  ).run(`-${maxAgeDays}`);

  const runResult = db.prepare(
    `DELETE FROM run_log
     WHERE started_at < datetime('now', ? || ' days')`
  ).run(`-${maxAgeDays}`);

  return {
    removedThreads: threadResult.changes,
    removedRuns: runResult.changes,
  };
}

// ─── Stats ───────────────────────────────────────────────────────────

/**
 * Get memory statistics for an account.
 */
export function getStats(accountEmail: string): RunStats {
  const db = getMemoryDb();

  const totalAllTime = db.prepare(
    `SELECT COUNT(*) as count FROM processed_threads WHERE account_email = ?`
  ).get(accountEmail) as { count: number };

  const totalLast7 = db.prepare(
    `SELECT COUNT(*) as count FROM processed_threads
     WHERE account_email = ? AND processed_at >= datetime('now', '-7 days')`
  ).get(accountEmail) as { count: number };

  const pending = db.prepare(
    `SELECT COUNT(*) as count FROM pending_threads WHERE account_email = ?`
  ).get(accountEmail) as { count: number };

  const lastFullRun = db.prepare(
    `SELECT started_at FROM run_log
     WHERE account_email = ? AND was_full_run = 1
     ORDER BY started_at DESC LIMIT 1`
  ).get(accountEmail) as { started_at: string } | null;

  const lastRun = db.prepare(
    `SELECT started_at FROM run_log
     WHERE account_email = ?
     ORDER BY started_at DESC LIMIT 1`
  ).get(accountEmail) as { started_at: string } | null;

  const recentRuns = db.prepare(
    `SELECT started_at, was_full_run, threads_processed, skip_reason
     FROM run_log WHERE account_email = ?
     ORDER BY started_at DESC LIMIT 5`
  ).all(accountEmail) as {
    started_at: string;
    was_full_run: number;
    threads_processed: number;
    skip_reason: string | null;
  }[];

  return {
    totalProcessedAllTime: totalAllTime.count,
    totalProcessedLast7Days: totalLast7.count,
    pendingCount: pending.count,
    lastFullRunAt: lastFullRun?.started_at ?? null,
    lastRunAt: lastRun?.started_at ?? null,
    recentRuns: recentRuns.map(r => ({
      startedAt: r.started_at,
      wasFullRun: r.was_full_run === 1,
      threadsProcessed: r.threads_processed,
      skipReason: r.skip_reason,
    })),
  };
}
