/**
 * Memory module tests — focused on the filter/record flow that backs the
 * MCP inbox/search filtering and action recording.
 */

import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { setMemoryDbForTest, closeMemoryDb } from "../memory/db";
import { filterUnprocessed, recordProcessed } from "../memory";

const ACCOUNT = "test@example.com";
const OTHER_ACCOUNT = "other@example.com";

beforeEach(() => {
  closeMemoryDb();
  setMemoryDbForTest(new Database(":memory:"));
});

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
