# MCP Usage Audit: Completeness & Desktop Parity

Audit of patterns similar to the two issues we fixed: (1) **not getting all emails** (inbox/search limits), (2) **drafts not in thread** (reply/reply-all backend association). Goal: find truncation, wrong associations, and feature gaps that could surprise users.

---

## Fixed (already addressed)

| Issue | Fix |
|-------|-----|
| Inbox/search only first 10/500 | Pagination + default 500, max 5000 so we don’t miss emails. |
| Reply/reply-all drafts not in thread | `createDraftWithUserInfo` with `action: "reply"`, `inReplyToThreadId`, threading headers so drafts show in Superhuman thread. |
| Forward drafts not in thread | When `send=false`, create forward via `createDraftWithUserInfo` with `action: "forward"`, `inReplyToThreadId`, so the draft appears in the thread in Superhuman. |
| Read thread (MS Graph) truncated at 50 | `getThreadMessagesMsGraph` and read thread now paginate; `read.ts` uses `getThreadMessages` for MS so long threads are complete. |
| Search only inbox | Search schema and handler now support `includeDone`; use `includeDone=true` to search all mail including archived. |

---

## Findings (remaining / lower priority)

### 1. **Forward drafts not in thread** — FIXED (see above)

### 2. **Read thread (MS Graph)** — FIXED (see above)

### 3. **Starred / snoozed lists: single page, default 50**

- **What:** Forward draft is created via provider (Gmail/Graph) only, so it doesn’t appear in the original thread in Superhuman.
- **Impact:** User asks “forward this as a draft”; draft exists but opening the thread doesn’t show it.
### 3. **Starred / snoozed lists: single page, default 50**

- **Where:** `listStarred` and `listSnoozedViaProvider` use a single request with `limit` default 50, no pagination.
- **Impact:** “Show all starred” or “list my snoozed emails” can miss items if there are more than 50.
- **Fix:** Same pattern as inbox: paginate (or raise default/cap) so “all” is possible. Lower priority than inbox/search.

### 2. **Calendar list: limit 50**

- **Where:** Calendar list uses `limit` default 50.
- **Impact:** “What’s on my calendar this month” could miss events if there are many.
- **Fix:** Raise default or add pagination; lower priority than email completeness.

### 6. **No “list drafts” MCP tool**

- **Where:** There is no tool to list the user’s drafts.
- **Impact:** User can’t ask “show my drafts” or “how many drafts do I have?”
- **Fix:** Add `superhuman_drafts` (or similar) that lists drafts with optional limit/offset if desired.

### 4. **Gmail read thread**

- **Where:** `readThreadGmail` uses `/threads/{id}?format=full`; Gmail returns the full thread.
- **Status:** No truncation; OK as-is.

---

## Priority (after fixes)

1. **Done:** Forward draft in thread, MS Graph read thread, search `includeDone`.
2. **Optional later:** Starred/snoozed pagination or higher cap, calendar limit, drafts list tool.

---

## How to re-check after changes

- **Forward in thread:** Create a forward draft via MCP, open that thread in Superhuman desktop; draft should appear in the conversation.
- **Read thread (Outlook):** Open a long thread (e.g. 60+ messages) and compare MCP `superhuman_read` output with Superhuman; no missing messages.
- **Search archived:** Ask to search for an archived email; with `includeDone` the model can request “all mail” and find it.
