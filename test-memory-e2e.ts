import { preRun, recordProcessed, completeRun, getStats, cleanup } from "./src/memory/index";

const ACCOUNT = "alex@karmelcap.com";

// These are the real inbox threads from the MCP
const inboxThreads = [
  { threadId: "19d268b51bff86c7", subject: "prompt", sender: "Scott Neuberger" },
  { threadId: "19d26856b072d5de", subject: "New messages from 2 conversations in DDVC", sender: "Slack" },
  { threadId: "19d261ed2640e389", subject: "Invitation: Investment Memo Review", sender: "Thomas Hernandez" },
  { threadId: "19d25a1827ddedd2", subject: "Order the new AirPods Max 2 today", sender: "Apple" },
  { threadId: "19d25970fc3387de", subject: "Re: Interesting assessment by KAI", sender: "Alex Banham" },
  { threadId: "19d2581bee3e65bc", subject: "Ship your first major feature with Claude Code", sender: "Claude Team" },
  { threadId: "19d2576a0ff07ee6", subject: "Your OpenAI API account has been funded", sender: "OpenAI" },
  { threadId: "19d255759be6592b", subject: "Implement Stripe faster with new developer tools", sender: "Stripe" },
  { threadId: "19d254dbc062a124", subject: "Final Day of DDVC Summit Starting In 1 Hour!", sender: "Andre from DDVC" },
  { threadId: "19d251a172293dfe", subject: "More emoji, less writing", sender: "Slack" },
  { threadId: "19d224c4388e7c91", subject: "ACTION REQUIRED: Low balance for Bright Data", sender: "Bright Data" },
  { threadId: "19d21d2bc3e00dff", subject: "Welcome to Claude Code", sender: "Claude Team" },
  { threadId: "19d207fe87112808", subject: "Re: Back-Testing Never Dies", sender: "Bob Wallace" },
  { threadId: "19d217ea342b0fda", subject: "Only 7 things separate good emails from great ones", sender: "Apollo" },
  { threadId: "19d215e78a5cc564", subject: "New messages from 3 conversations in DDVC", sender: "Slack" },
  { threadId: "19d20f1e422fe499", subject: "Karmel Capital Data Project Weekly Meeting", sender: "Fyxer Notetaker" },
  { threadId: "19d208675915dd6e", subject: "Starting in under an hour: How AI Transforms CFO", sender: "Andre from DDVC" },
  { threadId: "19d205e3fa4fa9f6", subject: "Starting in under an hour: Building AI-Native VC Tech Stack", sender: "Andre from DDVC" },
  { threadId: "19d2051be6548227", subject: "Re: I am available for a call today", sender: "Jim Brailean" },
  { threadId: "19d1d159188f3838", subject: "Confirm your signup", sender: "AiGronomist.com" },
];

console.log("=== TEST 1: First prerun with threshold 10 ===\n");
const run1 = preRun(ACCOUNT, inboxThreads, 10);
console.log(`shouldRun: ${run1.shouldRun}`);
console.log(`reason: ${run1.reason}`);
console.log(`totalUnprocessed: ${run1.totalUnprocessed}`);
console.log(`alreadyProcessedCount: ${run1.alreadyProcessedCount}`);
console.log(`threads to process: ${run1.threads.length}`);
console.log(`runId: ${run1.runId}`);

console.log("\n=== TEST 2: Simulate processing 10 threads (star some, archive others) ===\n");
const processed = [
  { threadId: "19d268b51bff86c7", action: "starred", subject: "prompt", sender: "Scott Neuberger" },
  { threadId: "19d261ed2640e389", action: "starred", subject: "Invitation: Investment Memo Review", sender: "Thomas Hernandez" },
  { threadId: "19d25970fc3387de", action: "starred", subject: "Re: Interesting assessment by KAI", sender: "Alex Banham" },
  { threadId: "19d207fe87112808", action: "starred", subject: "Re: Back-Testing Never Dies", sender: "Bob Wallace" },
  { threadId: "19d2051be6548227", action: "starred", subject: "Re: I am available for a call today", sender: "Jim Brailean" },
  { threadId: "19d25a1827ddedd2", action: "archived", subject: "Order the new AirPods Max 2 today", sender: "Apple" },
  { threadId: "19d2581bee3e65bc", action: "archived", subject: "Ship your first major feature with Claude Code", sender: "Claude Team" },
  { threadId: "19d2576a0ff07ee6", action: "archived", subject: "Your OpenAI API account has been funded", sender: "OpenAI" },
  { threadId: "19d255759be6592b", action: "archived", subject: "Implement Stripe faster", sender: "Stripe" },
  { threadId: "19d251a172293dfe", action: "archived", subject: "More emoji, less writing", sender: "Slack" },
];
const recordResult = recordProcessed(ACCOUNT, processed);
completeRun(run1.runId, processed.length);
console.log(`Recorded: ${recordResult.recorded}, Already existed: ${recordResult.alreadyExisted}`);

console.log("\n=== TEST 3: Second prerun with SAME inbox threads (simulates next hour) ===\n");
const run2 = preRun(ACCOUNT, inboxThreads, 10);
console.log(`shouldRun: ${run2.shouldRun}`);
console.log(`reason: ${run2.reason}`);
console.log(`totalUnprocessed: ${run2.totalUnprocessed}`);
console.log(`alreadyProcessedCount: ${run2.alreadyProcessedCount}`);
if (run2.threads.length > 0) {
  console.log(`Unprocessed threads:`);
  run2.threads.forEach(t => console.log(`  - ${t.subject} (${t.sender})`));
}

console.log("\n=== TEST 4: Third prerun with same threads + 5 new ones (simulates accumulation) ===\n");
const newThreads = [
  { threadId: "new_001", subject: "Quarterly Board Deck Review", sender: "CFO" },
  { threadId: "new_002", subject: "LP Update Draft", sender: "Investor Relations" },
  { threadId: "new_003", subject: "Deal Flow Pipeline Update", sender: "Thomas Hernandez" },
  { threadId: "new_004", subject: "New pitch deck from startup X", sender: "Founder" },
  { threadId: "new_005", subject: "Follow up: Due diligence checklist", sender: "Legal" },
];
const run3 = preRun(ACCOUNT, [...inboxThreads, ...newThreads], 10);
console.log(`shouldRun: ${run3.shouldRun}`);
console.log(`reason: ${run3.reason}`);
console.log(`totalUnprocessed: ${run3.totalUnprocessed}`);
console.log(`alreadyProcessedCount: ${run3.alreadyProcessedCount}`);
if (run3.threads.length > 0) {
  console.log(`Threads to process (${run3.threads.length}):`);
  run3.threads.forEach(t => console.log(`  - ${t.subject} (${t.sender})`));
}

console.log("\n=== TEST 5: Memory stats ===\n");
const stats = getStats(ACCOUNT);
console.log(`Processed all time: ${stats.totalProcessedAllTime}`);
console.log(`Processed last 7 days: ${stats.totalProcessedLast7Days}`);
console.log(`Pending: ${stats.pendingCount}`);
console.log(`Last full run: ${stats.lastFullRunAt}`);
console.log(`Recent runs:`);
stats.recentRuns.forEach(r => {
  console.log(`  ${r.startedAt}: ${r.wasFullRun ? `Full (${r.threadsProcessed} processed)` : `Skipped: ${r.skipReason}`}`);
});

console.log("\n=== DONE ===");
