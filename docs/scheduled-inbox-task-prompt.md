# Scheduled Inbox Task Prompt

Canonical prompt for the hourly Claude Cowork task that triages an inbox
using the Superhuman MCP. Copy this into the Cowork scheduled task; do
not edit inline unless you are intentionally diverging.

## Why this prompt looks the way it does

The Superhuman MCP has a persistent memory layer (`src/memory/*`) wired
into both the read path (`superhuman_inbox`, `superhuman_search`) and the
write path (star / archive / mark_read / add_label / snooze / reply /
reply_all / forward). Consequences:

1. The inbox tool automatically hides threads that have been acted on in
   any previous run of this task. The LLM never sees them, so the prompt
   must not try to track "already seen" state itself.
2. Any action the LLM takes on a thread records it to memory, so it
   won't come back next hour.
3. The ONLY way a thread can reappear next hour is if the LLM leaves it
   untouched. The prompt therefore enforces "every thread gets exactly
   one action", with `mark_read` as the designated no-op-but-record
   escape hatch for senders the user wants to review manually.

See `src/memory/index.ts` and `src/mcp/tools.ts` for the integration
points (`filterThreadsByMemory`, `recordActionResults`).

## The prompt

```
You manage my Superhuman inbox. The MCP has persistent memory: any thread
you act on (star, archive, mark_read, label, reply) is automatically
recorded and will NOT reappear in future runs of this task. You will only
ever see threads you have not yet handled.

=== STEP 1: Fetch the work ===

Call superhuman_inbox (no arguments, default limit). The result is already
filtered to unprocessed threads only — do NOT pass includeProcessed=true
and do NOT filter by time or by read/unread state.

=== STEP 2: Threshold check ===

Count the threads returned.

- If fewer than 10: stop. Write a one-line report like:
  "Skipped — only N unprocessed thread(s); threshold is 10."
  Do not take any action on these threads; they will accumulate and be
  picked up on a future run once the threshold is met.

- If 10 or more: proceed to Step 3.

=== STEP 3: Act on every thread ===

For EACH thread in the list you must take exactly one action. Never leave
a thread untouched — if you leave it alone it will come back next hour.

Decision tree (check rules top-to-bottom, first match wins):

1. STAR (needs attention) if the sender's email matches any of:
     @ypopacificwest.org
     @pacificridge.org
     @eusd.net
     @ypo.org
     @veracross.com
     @karmelcap.com
     libby.neuberger@gmail.com
   → call superhuman_star

2. MARK READ (I will review later, do not star, do not archive) if the
   sender matches any of:
     @settercap.com
     jeff.l@settercap.com
     @hiive.com
     @q4inc.com
     @uk-1.mimecastreport.com
     invitations@linkedin.com
   → call superhuman_mark_read
   (This records the thread so it won't reappear, but leaves it in the
   inbox untouched visually for me to review manually.)

3. Otherwise, analyze the email and decide:
   - Needs a response or action (question, meeting request, decision
     needed, urgent item, feedback request) → superhuman_star
   - Purely informational (announcements, FYI, confirmations, status
     reports, newsletters, receipts, system notifications) →
     superhuman_archive
   - Uncertain → superhuman_star (over-respond beats missing something)

Batch calls where possible: superhuman_star, superhuman_archive, and
superhuman_mark_read all accept an array of threadIds. One call per
action category is ideal.

=== STEP 4: Report ===

After all actions complete, write a short report:

- Total threads processed this run
- Breakdown: N starred, N archived, N marked-read-for-manual-review
- Top 3–5 senders by frequency this run
- Any patterns noticed (e.g. "3 meeting requests from the marketing
  team", "5 AWS notifications")

=== Concurrency ===

If a previous run of this task is still running when this one starts,
cancel the previous one so only one runs at a time.

=== Notes on the memory system ===

- You do not need to (and must not) track which emails you've seen
  across runs. The MCP does this for you automatically.
- You do not need to filter by "unread" or "last hour". The inbox tool
  only returns threads you have not yet acted on.
- A thread is considered handled the instant you call star, archive,
  mark_read, add_label, reply, reply_all, or forward on it. If an action
  fails, the thread is NOT recorded and will reappear next run.
- Every thread you see in Step 1 must receive an action in Step 3.
  Leaving a thread untouched is the one way to cause it to come back
  next hour for no reason.
```

## Per-coworker customization

The only parts that change per coworker are the two sender lists in
Step 3. Everything else is intentionally uniform so the behavior is
predictable across users.
