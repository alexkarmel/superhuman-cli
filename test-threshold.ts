import { closeMemoryDb } from "./src/memory/db";
import { preRun, getStats } from "./src/memory/index";
import { Database } from "bun:sqlite";
import { setMemoryDbForTest } from "./src/memory/db";

// Use in-memory DB so we don't pollute the real one
const db = new Database(":memory:");
setMemoryDbForTest(db);

const ACCOUNT = "coworker@example.com";

console.log("=== Simulating the 8-7-9 problem your coworker had ===\n");

console.log("Hour 1: 8 emails arrive");
const run1 = preRun(ACCOUNT, Array.from({length: 8}, (_, i) => ({
  threadId: `h1_${i}`, subject: `Email ${i} from hour 1`, sender: `person${i}@co.com`
})), 10);
console.log(`  shouldRun: ${run1.shouldRun} | pending: ${run1.totalUnprocessed}\n`);

console.log("Hour 2: 7 emails arrive");
const run2 = preRun(ACCOUNT, Array.from({length: 7}, (_, i) => ({
  threadId: `h2_${i}`, subject: `Email ${i} from hour 2`, sender: `person${i}@co.com`
})), 10);
console.log(`  shouldRun: ${run2.shouldRun} | pending: ${run2.totalUnprocessed}\n`);

console.log("Hour 3: 9 emails arrive");
const run3 = preRun(ACCOUNT, Array.from({length: 9}, (_, i) => ({
  threadId: `h3_${i}`, subject: `Email ${i} from hour 3`, sender: `person${i}@co.com`
})), 10);
console.log(`  shouldRun: ${run3.shouldRun} | pending: ${run3.totalUnprocessed}`);
console.log(`  Threads to process: ${run3.threads.length}`);
console.log(`  (All 24 accumulated emails from 3 hours)\n`);

const stats = getStats(ACCOUNT);
console.log(`Run history:`);
stats.recentRuns.forEach(r => {
  console.log(`  ${r.wasFullRun ? "FULL RUN" : `SKIPPED: ${r.skipReason}`}`);
});

closeMemoryDb();
