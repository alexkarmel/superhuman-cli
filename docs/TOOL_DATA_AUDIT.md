# Tool data audit: last-message vs full-thread

This doc records where each tool gets its data (last message only vs full thread) so behavior is predictable and we can fix similar bugs like reply-all.

## Summary

| Tool | Data source | Status / notes |
|------|-------------|----------------|
| **superhuman_reply** | Last message (from) | OK — single reply-to sender is correct. |
| **superhuman_reply_all** | Full thread (all messages) | **Fixed** — recipients from all messages via `getThreadReplyAllRecipients`. |
| **superhuman_forward** | Thread participants for "To:" line; last message for quoted body | **Updated** — "Forwarded message" To line uses all participants; quoted content is still last message only. |
| **superhuman_read** | Full thread | OK — uses `getThreadMessages` / `readThread`. |
| **superhuman_attachments** | Full thread | OK — `listAttachments` → `getThreadDirect` iterates all messages. |
| **superhuman_inbox / search** | Thread list (not per-message) | OK. Default limit 5000 so "all emails from today" etc. won't miss any. |

## Details

### getThreadInfoDirect (token-api)

Returns **one message**: the **last message** in the thread. Used for:

- **Reply:** `from`, `subject`, `messageId`, `references` — correct for single reply and threading.
- **Reply-all:** Was used for `to`/`cc` (wrong). Now we use `getThreadReplyAllRecipients` for recipients; still use threadInfo for subject, messageId, references.
- **Forward:** Was used for "To:" in the forwarded header (wrong). Now we use `getThreadReplyAllRecipients` for that line; still use threadInfo for subject, messageId, references, from. Quoted **body** is still the last message only (by design for now).

### getThreadReplyAllRecipients (token-api)

New helper: loads all messages via `getThreadMessages`, collects every address in from/to/cc, dedupes, excludes current user. Used for:

- Reply-all: full recipient list (to/cc).
- Forward: "To:" line in the "---------- Forwarded message ---------" block.

### Forward: quoted body

The forwarded draft’s **quoted content** (the email body under the forwarded header) is still **only the last message’s body**. Including the full thread (multiple messages) would require concatenating all message bodies; not implemented. So “forward this thread” currently forwards the latest message with a header that lists all participants.

### Provider path (when sending is enabled)

If `SEND_DISABLED` is false, the **provider path** (e.g. `replyAllToThread` → `createReplyDraftWithToken` / `sendReplyWithToken`) still gets reply-all recipients from `getThreadInfoForReplyWithToken`, which uses **last message only**. So if you re-enable sending, reply-all sent via that path would have the same “last message only” bug unless we switch it to use `getThreadReplyAllRecipients` in send-api/reply.ts.
