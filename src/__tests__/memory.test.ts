/**
 * Memory module tests — focused on the filter/record flow that backs the
 * MCP inbox/search filtering and action recording.
 */

import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { setMemoryDbForTest, closeMemoryDb } from "../memory/db";
import { filterUnprocessed, recordProcessed } from "../memory";
import { fetchUnprocessedPage } from "../mcp/tools";
import type { ConnectionProvider } from "../connection-provider";

const ACCOUNT = "test@example.com";
const OTHER_ACCOUNT = "other@example.com";

beforeEach(() => {
  closeMemoryDb();
  setMemoryDbForTest(new Database(":memory:"));
});

// Minimal ConnectionProvider stub for scan-loop tests — only getCurrentEmail
// is exercised by filterThreadsByMemory. Other methods throw to catch drift.
function stubProvider(email: string): ConnectionProvider {
  const notImpl = () => {
    throw new Error("not implemented in stub");
  };
  return {
    getCurrentEmail: async () => email,
    getToken: notImpl as unknown as ConnectionProvider["getToken"],
    disconnect: async () => {},
    isConnected: () => true,
  } as unknown as ConnectionProvider;
}

// Build a synthetic paginated thread source. `total` = inbox size, pages
// are served in order of thread IDs t0..t{total-1}. Tracks call count so
// tests can assert the scan loop didn't over-fetch.
function makeFakeSource(total: number) {
  const calls: Array<{ offset: number; limit: number }> = [];
  const fetchPage = async (offset: number, limit: number) => {
    calls.push({ offset, limit });
    const slice: { id: string }[] = [];
    for (let i = offset; i < Math.min(offset + limit, total); i++) {
      slice.push({ id: `t${i}` });
    }
    return {
      threads: slice,
      hasMore: offset + slice.length < total,
      nextOffset: offset + slice.length,
    };
  };
  return { fetchPage, calls };
}

test("filterUnprocessed returns all IDs when DB is empty", () => {
  const { unprocessedIds, processedCount } = filterUnprocessed(ACCOUNT, ["a", "b", "c"]);
  expect(processedCount).toBe(0);
  expect(unprocessedIds.size).toBe(3);
  expect(unprocessedIds.has("a")).toBe(true);
});

test("filterUnprocessed hides threads that have been recorded", () => {
  recordProcessed(ACCOUNT, [
    { threadId: "a", action: "starred" },
    { threadId: "b", action: "archived" },
  ]);
  const { unprocessedIds, processedCount } = filterUnprocessed(ACCOUNT, ["a", "b", "c", "d"]);
  expect(processedCount).toBe(2);
  expect(unprocessedIds.size).toBe(2);
  expect(unprocessedIds.has("c")).toBe(true);
  expect(unprocessedIds.has("d")).toBe(true);
  expect(unprocessedIds.has("a")).toBe(false);
});

test("filterUnprocessed is scoped per account", () => {
  recordProcessed(ACCOUNT, [{ threadId: "a", action: "starred" }]);
  // Other account should not see the record.
  const { unprocessedIds, processedCount } = filterUnprocessed(OTHER_ACCOUNT, ["a", "b"]);
  expect(processedCount).toBe(0);
  expect(unprocessedIds.size).toBe(2);
});

test("filterUnprocessed handles empty input", () => {
  const { unprocessedIds, processedCount } = filterUnprocessed(ACCOUNT, []);
  expect(processedCount).toBe(0);
  expect(unprocessedIds.size).toBe(0);
});

test("recordProcessed is idempotent — same thread, same action", () => {
  const r1 = recordProcessed(ACCOUNT, [{ threadId: "a", action: "starred" }]);
  const r2 = recordProcessed(ACCOUNT, [{ threadId: "a", action: "starred" }]);
  expect(r1.alreadyExisted).toBe(0);
  expect(r2.alreadyExisted).toBe(1);
  // Filter still hides it.
  const { processedCount } = filterUnprocessed(ACCOUNT, ["a"]);
  expect(processedCount).toBe(1);
});

test("end-to-end: process a batch, next inbox page hides them", () => {
  const inboxPage1 = ["t1", "t2", "t3", "t4", "t5"];

  // First run: nothing hidden.
  const r1 = filterUnprocessed(ACCOUNT, inboxPage1);
  expect(r1.processedCount).toBe(0);

  // LLM stars two and archives one.
  recordProcessed(ACCOUNT, [
    { threadId: "t1", action: "starred" },
    { threadId: "t3", action: "starred" },
    { threadId: "t5", action: "archived" },
  ]);

  // Next hour — same inbox plus 2 new ones.
  const inboxPage2 = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
  const r2 = filterUnprocessed(ACCOUNT, inboxPage2);
  expect(r2.processedCount).toBe(3);
  expect(r2.unprocessedIds.size).toBe(4);
  expect([...r2.unprocessedIds].sort()).toEqual(["t2", "t4", "t6", "t7"]);
});

// ─── fetchUnprocessedPage — the scan loop that protects the tail ────────

test("scan loop: empty DB returns first page unchanged", async () => {
  const provider = stubProvider(ACCOUNT);
  const { fetchPage, calls } = makeFakeSource(50);

  const r = await fetchUnprocessedPage(provider, 0, 10, fetchPage, false);
  expect(r.threads.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"]);
  expect(r.hiddenCount).toBe(0);
  expect(r.rawScanned).toBe(50); // total=50, first fetch drains it
  expect(r.apiHasMore).toBe(false);
  expect(r.hitScanCap).toBe(false);
  expect(calls.length).toBe(1);
});

test("scan loop: unreachable tail — first page fully processed, reaches deeper unprocessed", async () => {
  const provider = stubProvider(ACCOUNT);
  // Inbox has 200 threads. The first 150 are already processed (e.g. heavy
  // starred history). The scheduled task asks for 10 unprocessed; the naive
  // filter-after-fetch would return 0 and skip the run forever. The scan
  // loop should keep pulling pages until it reaches t150..t159.
  recordProcessed(
    ACCOUNT,
    Array.from({ length: 150 }, (_, i) => ({ threadId: `t${i}`, action: "starred" }))
  );
  const { fetchPage, calls } = makeFakeSource(200);

  const r = await fetchUnprocessedPage(provider, 0, 10, fetchPage, false);
  expect(r.threads.map((t) => t.id)).toEqual([
    "t150", "t151", "t152", "t153", "t154", "t155", "t156", "t157", "t158", "t159",
  ]);
  expect(r.hiddenCount).toBe(150);
  expect(r.hitScanCap).toBe(false);
  // We should have done 2 calls (chunks of 100) to walk past the 150 processed.
  expect(calls.length).toBe(2);
  expect(calls[0]).toEqual({ offset: 0, limit: 100 });
  expect(calls[1]).toEqual({ offset: 100, limit: 100 });
});

test("scan loop: hits MEMORY_SCAN_MAX_RAW when everything is processed", async () => {
  const provider = stubProvider(ACCOUNT);
  // 1000-thread inbox, ALL processed. Scan should stop at 500 raw threads.
  recordProcessed(
    ACCOUNT,
    Array.from({ length: 1000 }, (_, i) => ({ threadId: `t${i}`, action: "archived" }))
  );
  const { fetchPage, calls } = makeFakeSource(1000);

  const r = await fetchUnprocessedPage(provider, 0, 10, fetchPage, false);
  expect(r.threads.length).toBe(0);
  expect(r.hiddenCount).toBe(500);
  expect(r.rawScanned).toBe(500);
  expect(r.apiHasMore).toBe(true);
  expect(r.hitScanCap).toBe(true);
  expect(r.lastOffset).toBe(500); // caller can resume from here
  // 5 pages of 100 = 5 calls, no more.
  expect(calls.length).toBe(5);
});

test("scan loop: early-exit as soon as target is met, even if first page has extras", async () => {
  const provider = stubProvider(ACCOUNT);
  // Inbox of 500, t0..t4 already processed, t5..t499 all fresh. Ask for 10.
  // First fetch of 100 should be enough — we should not request a second page.
  recordProcessed(
    ACCOUNT,
    Array.from({ length: 5 }, (_, i) => ({ threadId: `t${i}`, action: "starred" }))
  );
  const { fetchPage, calls } = makeFakeSource(500);

  const r = await fetchUnprocessedPage(provider, 0, 10, fetchPage, false);
  expect(r.threads.length).toBe(10);
  expect(r.threads.map((t) => t.id)).toEqual([
    "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12", "t13", "t14",
  ]);
  expect(r.hiddenCount).toBe(5);
  expect(calls.length).toBe(1);
});

test("scan loop: skipFilter short-circuits to a single raw fetch", async () => {
  const provider = stubProvider(ACCOUNT);
  recordProcessed(
    ACCOUNT,
    Array.from({ length: 100 }, (_, i) => ({ threadId: `t${i}`, action: "starred" }))
  );
  const { fetchPage, calls } = makeFakeSource(200);

  // skipFilter=true mirrors includeProcessed=true — return raw page of `limit`.
  const r = await fetchUnprocessedPage(provider, 0, 10, fetchPage, true);
  expect(r.threads.length).toBe(10);
  expect(r.threads[0].id).toBe("t0"); // processed threads NOT hidden
  expect(r.hiddenCount).toBe(0);
  expect(calls.length).toBe(1);
  expect(calls[0]).toEqual({ offset: 0, limit: 10 });
});

test("scan loop: respects startOffset (pagination from caller)", async () => {
  const provider = stubProvider(ACCOUNT);
  const { fetchPage, calls } = makeFakeSource(500);

  const r = await fetchUnprocessedPage(provider, 200, 10, fetchPage, false);
  expect(r.threads[0].id).toBe("t200");
  expect(r.threads.length).toBe(10);
  expect(calls[0].offset).toBe(200);
});

test("scan loop: partial fill when API exhausts before target is met", async () => {
  const provider = stubProvider(ACCOUNT);
  // Inbox of 15 total, 5 already processed. Ask for 20 — should return 10.
  recordProcessed(
    ACCOUNT,
    Array.from({ length: 5 }, (_, i) => ({ threadId: `t${i}`, action: "archived" }))
  );
  const { fetchPage } = makeFakeSource(15);

  const r = await fetchUnprocessedPage(provider, 0, 20, fetchPage, false);
  expect(r.threads.length).toBe(10);
  expect(r.apiHasMore).toBe(false);
  expect(r.hitScanCap).toBe(false);
});
