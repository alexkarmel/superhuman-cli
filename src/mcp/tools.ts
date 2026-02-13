/**
 * MCP Tools Definition
 *
 * Defines the MCP tools that wrap Superhuman automation functions.
 */

import { z } from "zod";
import {
  connectToSuperhuman,
  disconnect,
  textToHtml,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox, searchInbox, type SearchOptions } from "../inbox";
import { readThread } from "../read";
import { listAccounts, switchAccount } from "../accounts";
import { replyToThread, replyAllToThread, forwardThread } from "../reply";
import { archiveThread, deleteThread } from "../archive";
import { markAsRead, markAsUnread } from "../read-status";
import { listLabels, getThreadLabels, addLabel, removeLabel, starThread, unstarThread, listStarred } from "../labels";
import { parseSnoozeTime, snoozeThreadViaProvider, unsnoozeThreadViaProvider, listSnoozedViaProvider } from "../snooze";
import { listAttachments, downloadAttachment } from "../attachments";
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent as deleteCalendarEvent,
  getFreeBusy,
  type CreateEventInput,
  type UpdateEventInput,
} from "../calendar";
import { listSnippets, findSnippet, applyVars, parseVars } from "../snippets";
import { getUserInfo, getUserInfoFromCache, createDraftWithUserInfo, sendDraftSuperhuman } from "../draft-api";
import { sendEmailViaProvider, createDraftViaProvider } from "../send-api";
import { CDPConnectionProvider, resolveProvider, type ConnectionProvider } from "../connection-provider";
import {
  loadTokensFromDisk,
  getCachedToken,
  getCachedAccounts,
  hasCachedSuperhumanCredentials,
  askAISearch,
  getThreadInfoDirect,
  getThreadMessages,
  type TokenInfo,
} from "../token-api";
import fs from "fs";

const CDP_PORT = 9333;

/**
 * Resolve a cached Superhuman token with idToken + userId.
 * Tries any cached account with Superhuman credentials.
 */
async function resolveSuperhumanToken(): Promise<TokenInfo | null> {
  await loadTokensFromDisk();
  const accounts = getCachedAccounts();
  for (const email of accounts) {
    if (await hasCachedSuperhumanCredentials(email)) {
      const token = await getCachedToken(email);
      if (token?.idToken && token?.userId) return token;
    }
  }
  return null;
}

/**
 * Shared schema for email composition (draft and send use the same fields)
 */
export const EmailSchema = z.object({
  to: z.string().describe("Recipient email address"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body content (plain text or HTML)"),
  cc: z.string().optional().describe("CC recipient email address (optional)"),
  bcc: z.string().optional().describe("BCC recipient email address (optional)"),
});

export const DraftSchema = EmailSchema;
export const SendSchema = EmailSchema;

/**
 * Zod schema for inbox search parameters
 */
/** Max threads to return per request; backend paginates to reach this. */
const INBOX_SEARCH_MAX_LIMIT = 5000;

export const SearchSchema = z.object({
  query: z.string().describe("Search query string (e.g. 'after:2025/2/12' for date, or 'from:name')"),
  limit: z.number().optional().describe("Maximum number of threads to return (default: 500). Backend paginates automatically; use up to 5000 to get all matching emails."),
  includeDone: z.boolean().optional().describe("If true, search all mail including archived/done. Use when the user asks to find archived emails or 'search everywhere'."),
});

/**
 * Zod schema for inbox listing
 */
export const InboxSchema = z.object({
  limit: z.number().optional().describe("Maximum number of threads to return (default: 500). Backend paginates automatically; use up to 5000 to get all."),
});

/**
 * Zod schema for reading a thread
 */
export const ReadSchema = z.object({
  threadId: z.string().describe("Thread ID from superhuman_inbox or superhuman_search"),
});

/**
 * Zod schema for listing accounts (no parameters)
 */
export const AccountsSchema = z.object({});

/**
 * Zod schema for switching accounts
 */
export const SwitchAccountSchema = z.object({
  account: z.string().describe("Account to switch to: either an email address or 1-based index number"),
});

/**
 * Zod schema for reply to a thread. Use only when user explicitly asks to "reply"; for "draft a response" use DraftSchema and superhuman_draft.
 */
export const ReplySchema = z.object({
  threadId: z.string().describe("Thread ID from superhuman_inbox, superhuman_search, or superhuman_read"),
  body: z.string().describe("Reply message body"),
  send: z.boolean().optional().describe("If true, send immediately. Default false. Prefer false unless user explicitly asks to send."),
});

/**
 * Zod schema for reply-all to a thread. Use only when user explicitly asks to "reply all".
 */
export const ReplyAllSchema = z.object({
  threadId: z.string().describe("Thread ID from superhuman_inbox, superhuman_search, or superhuman_read"),
  body: z.string().describe("Reply message body"),
  send: z.boolean().optional().describe("If true, send immediately. Default false. Prefer false unless user explicitly asks to send."),
});

/**
 * Zod schema for forwarding a thread. Use only when user explicitly asks to "forward".
 */
export const ForwardSchema = z.object({
  threadId: z.string().describe("Thread ID from superhuman_inbox, superhuman_search, or superhuman_read"),
  toEmail: z.string().describe("Email address to forward to"),
  body: z.string().describe("Message body to include before the forwarded content"),
  send: z.boolean().optional().describe("If true, send immediately. Default false. Prefer false unless user explicitly asks to send."),
});

/** Draft-only schemas (no send option); used when SEND_DISABLED so the model never sees send. */
export const ReplySchemaDraftOnly = ReplySchema.omit({ send: true });
export const ReplyAllSchemaDraftOnly = ReplyAllSchema.omit({ send: true });
export const ForwardSchemaDraftOnly = ForwardSchema.omit({ send: true });

/**
 * Zod schema for archiving threads
 */
export const ArchiveSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
});

/**
 * Zod schema for deleting threads
 */
export const DeleteSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
});

/**
 * Zod schema for marking threads as read
 */
export const MarkReadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
});

/**
 * Zod schema for marking threads as unread
 */
export const MarkUnreadSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
});

/**
 * Zod schema for listing labels (no parameters)
 */
export const LabelsSchema = z.object({});

/**
 * Zod schema for getting labels on a thread
 */
export const GetLabelsSchema = z.object({
  threadId: z.string().describe("Thread ID from superhuman_inbox or superhuman_read"),
});

/**
 * Zod schema for adding a label to threads
 */
export const AddLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
  labelId: z.string().describe("Label ID from superhuman_labels"),
});

/**
 * Zod schema for removing a label from threads
 */
export const RemoveLabelSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
  labelId: z.string().describe("Label ID from superhuman_labels or superhuman_get_labels"),
});

/**
 * Zod schema for starring threads
 */
export const StarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
});

/**
 * Zod schema for unstarring threads
 */
export const UnstarSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_starred or superhuman_inbox"),
});

/**
 * Zod schema for listing starred threads
 */
export const StarredSchema = z.object({
  limit: z.number().optional().describe("Maximum number of starred threads to return (default: 50)"),
});

/**
 * Zod schema for snoozing threads
 */
export const SnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_inbox or superhuman_search"),
  until: z.string().describe("When to unsnooze: preset (tomorrow, next-week, weekend, evening) or ISO datetime (e.g., 2024-02-15T14:00:00Z)"),
});

/**
 * Zod schema for unsnoozing threads
 */
export const UnsnoozeSchema = z.object({
  threadIds: z.array(z.string()).describe("Thread ID(s) from superhuman_snoozed or superhuman_inbox"),
});

/**
 * Zod schema for listing snoozed threads
 */
export const SnoozedSchema = z.object({
  limit: z.number().optional().describe("Maximum number of snoozed threads to return (default: 50)"),
});

/**
 * Zod schema for listing attachments in a thread
 */
export const AttachmentsSchema = z.object({
  threadId: z.string().describe("Thread ID from superhuman_inbox or superhuman_read"),
});

/**
 * Zod schema for downloading an attachment
 */
export const DownloadAttachmentSchema = z.object({
  messageId: z.string().describe("Message ID from superhuman_attachments"),
  attachmentId: z.string().describe("Attachment ID from superhuman_attachments"),
  threadId: z.string().optional().describe("Thread ID (optional; from superhuman_read or superhuman_attachments)"),
  mimeType: z.string().optional().describe("MIME type from superhuman_attachments (optional)"),
});

/**
 * Zod schema for listing calendar events
 */
export const CalendarListSchema = z.object({
  date: z.string().optional().describe("Start date (YYYY-MM-DD or 'today', 'tomorrow'). Defaults to today. Ignored if 'start' is provided."),
  range: z.number().optional().describe("Number of days to show (default: 1). Ignored if 'start' is provided."),
  start: z.string().optional().describe("Exact start time as ISO datetime (e.g., '2026-02-10T00:00:00'). Takes precedence over 'date'/'range'."),
  end: z.string().optional().describe("Exact end time as ISO datetime (e.g., '2026-02-10T23:59:59'). Used with 'start'. Defaults to end of start day."),
});

/**
 * Zod schema for creating a calendar event
 */
export const CalendarCreateSchema = z.object({
  title: z.string().describe("Event title/summary"),
  startTime: z.string().describe("Start time as ISO datetime (e.g., 2026-02-03T14:00:00Z)"),
  endTime: z.string().optional().describe("End time as ISO datetime (optional, defaults to 30 minutes after start)"),
  description: z.string().optional().describe("Event description"),
  attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
  allDay: z.boolean().optional().describe("Whether this is an all-day event (if true, use date format YYYY-MM-DD for startTime)"),
});

/**
 * Zod schema for updating a calendar event
 */
export const CalendarUpdateSchema = z.object({
  eventId: z.string().describe("Event id from superhuman_calendar_list"),
  title: z.string().optional().describe("New event title/summary"),
  startTime: z.string().optional().describe("New start time as ISO datetime"),
  endTime: z.string().optional().describe("New end time as ISO datetime"),
  description: z.string().optional().describe("New event description"),
  attendees: z.array(z.string()).optional().describe("New list of attendee email addresses"),
});

/**
 * Zod schema for deleting a calendar event
 */
export const CalendarDeleteSchema = z.object({
  eventId: z.string().describe("Event id from superhuman_calendar_list"),
});

/**
 * Zod schema for checking free/busy availability
 */
export const CalendarFreeBusySchema = z.object({
  timeMin: z.string().describe("Start of time range as ISO datetime"),
  timeMax: z.string().describe("End of time range as ISO datetime"),
});

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

function successResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Log MCP tool errors to a file when SUPERHUMAN_MCP_LOG or SUPERHUMAN_MCP_DEBUG is set (for debugging). */
function logMcpErrorToFile(message: string): void {
  const logPath =
    process.env.SUPERHUMAN_MCP_LOG ||
    (process.env.SUPERHUMAN_MCP_DEBUG ? `${process.env.HOME ?? ""}/Library/Logs/superhuman-mcp.log` : "");
  if (!logPath) return;
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(logPath, line);
  } catch {
    // ignore
  }
}

function errorResult(message: string): ToolResult {
  logMcpErrorToFile(message);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** User-facing hint when Superhuman or auth is unavailable. */
const CONNECTION_HINT =
  "Ensure Superhuman is running (with remote debugging if using the desktop app) and you have authenticated at least one account (e.g. via the MCP installer or 'superhuman account auth').";

/** When true, send is hidden from the model. Default is true (send disabled). Set SUPERHUMAN_MCP_DISABLE_SEND=0 or false to allow send. */
export const SEND_DISABLED =
  process.env.SUPERHUMAN_MCP_DISABLE_SEND !== "0" && process.env.SUPERHUMAN_MCP_DISABLE_SEND !== "false";

/**
 * Get a ConnectionProvider for MCP tools.
 * Prefers cached tokens; falls back to CDP.
 */
async function getMcpProvider(): Promise<ConnectionProvider> {
  const provider = await resolveProvider({ port: CDP_PORT });
  if (provider) return provider;

  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) {
    throw new Error(
      `Could not connect to Superhuman (remote debugging on port ${CDP_PORT}). ${CONNECTION_HINT}`
    );
  }
  return new CDPConnectionProvider(conn);
}

/**
 * Handler for superhuman_draft tool
 */
export async function draftHandler(args: z.infer<typeof DraftSchema>): Promise<ToolResult> {
  try {
    // Try Superhuman native API first (no CDP needed)
    const token = await resolveSuperhumanToken();
    if (token) {
      const userInfo = getUserInfoFromCache(token.userId, token.email, token.idToken);
      const bodyHtml = textToHtml(args.body);
      const result = await createDraftWithUserInfo(userInfo, {
        to: [args.to],
        cc: args.cc ? [args.cc] : undefined,
        bcc: args.bcc ? [args.bcc] : undefined,
        subject: args.subject,
        body: bodyHtml,
      });

      if (result.success) {
        return successResult(
          `Draft created successfully.\nTo: ${args.to}\nSubject: ${args.subject}\nDraft ID: ${result.draftId || "(unknown)"}\nAccount: ${token.email}`
        );
      } else {
        return errorResult(`Failed to create draft: ${result.error}`);
      }
    }

    // Fallback to provider-based approach (CDP)
    const provider = await getMcpProvider();
    try {
      const bodyHtml = textToHtml(args.body);
      const result = await createDraftViaProvider(provider, {
        to: [args.to],
        cc: args.cc ? [args.cc] : undefined,
        bcc: args.bcc ? [args.bcc] : undefined,
        subject: args.subject,
        body: bodyHtml,
      });

      if (result.success) {
        return successResult(
          `Draft created successfully.\nTo: ${args.to}\nSubject: ${args.subject}\nDraft ID: ${result.draftId || "(unknown)"}`
        );
      } else {
        return errorResult(`Failed to create draft: ${result.error}`);
      }
    } finally {
      await provider.disconnect();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to create draft: ${message}`);
  }
}

/**
 * Handler for superhuman_send tool
 */
export async function sendHandler(args: z.infer<typeof SendSchema>): Promise<ToolResult> {
  if (SEND_DISABLED) {
    return errorResult(
      "Sending is disabled. Use superhuman_draft to create drafts only; send manually from Superhuman when ready."
    );
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const bodyHtml = textToHtml(args.body);
    const result = await sendEmailViaProvider(provider, {
      to: [args.to],
      cc: args.cc ? [args.cc] : undefined,
      bcc: args.bcc ? [args.bcc] : undefined,
      subject: args.subject,
      body: bodyHtml,
      isHtml: true,
    });

    if (result.success) {
      return successResult(`Email sent successfully.\nTo: ${args.to}\nSubject: ${args.subject}`);
    } else {
      return errorResult(`Failed to send email: ${result.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to send email: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_search tool
 */
export async function searchHandler(args: z.infer<typeof SearchSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = Math.min(args.limit ?? 500, INBOX_SEARCH_MAX_LIMIT);

    const threads = await searchInbox(provider, {
      query: args.query,
      limit,
      includeDone: args.includeDone ?? false,
    });

    if (threads.length === 0) {
      return successResult(`No results found for query: "${args.query}"`);
    }

    const resultsText = threads
      .map((t, i) => {
        const from = t.from.name || t.from.email;
        return `${i + 1}. threadId: ${t.id}\n   From: ${from}\n   Subject: ${t.subject}\n   Date: ${t.date}\n   Snippet: ${t.snippet.substring(0, 100)}...`;
      })
      .join("\n\n");

    return successResult(`Found ${threads.length} result(s) for query: "${args.query}". Use threadId with superhuman_read or superhuman_star.\n\n${resultsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to search inbox: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_inbox tool
 */
export async function inboxHandler(args: z.infer<typeof InboxSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = Math.min(args.limit ?? 500, INBOX_SEARCH_MAX_LIMIT);
    const threads = await listInbox(provider, { limit });

    if (threads.length === 0) {
      return successResult("No emails in inbox");
    }

    const resultsText = threads
      .map((t, i) => {
        const from = t.from.name || t.from.email;
        return `${i + 1}. threadId: ${t.id}\n   From: ${from}\n   Subject: ${t.subject}\n   Date: ${t.date}\n   Snippet: ${t.snippet.substring(0, 100)}...`;
      })
      .join("\n\n");

    return successResult(`Inbox (${threads.length} threads). Use threadId with superhuman_read or superhuman_star.\n\n${resultsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list inbox: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_read tool
 */
export async function readHandler(args: z.infer<typeof ReadSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const messages = await readThread(provider, args.threadId);

    if (messages.length === 0) {
      return errorResult(`Thread not found: ${args.threadId}`);
    }

    const messagesText = messages
      .map((msg, i) => {
        const from = msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email;
        const to = msg.to.map(r => r.email).join(", ");
        const cc = msg.cc.length > 0 ? `\nCc: ${msg.cc.map(r => r.email).join(", ")}` : "";
        return `--- Message ${i + 1} ---\nmessageId: ${msg.id}\nthreadId: ${msg.threadId}\nFrom: ${from}\nTo: ${to}${cc}\nDate: ${msg.date}\nSubject: ${msg.subject}\n\n${msg.snippet}`;
      })
      .join("\n\n");

    return successResult(`Thread: ${messages[0].subject}\nUse messageId/threadId with superhuman_download_attachment (after superhuman_attachments) or reply/forward.\n\n${messagesText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to read thread: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_accounts tool
 */
export async function accountsHandler(_args: z.infer<typeof AccountsSchema>): Promise<ToolResult> {
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const accounts = await listAccounts(conn);

    if (accounts.length === 0) {
      return successResult("No linked accounts found");
    }

    const accountsText = accounts
      .map((a, i) => {
        const marker = a.isCurrent ? "* " : "  ";
        const current = a.isCurrent ? " (current)" : "";
        return `${marker}${i + 1}. ${a.email}${current}`;
      })
      .join("\n");

    return successResult(`Linked accounts. Use index (e.g. 2) or email with superhuman_switch_account.\n\n${accountsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const hint = message.includes("Could not connect") || message.includes("connect to Superhuman") ? ` ${CONNECTION_HINT}` : "";
    return errorResult(`Failed to list accounts: ${message}.${hint}`);
  } finally {
    if (conn) await disconnect(conn);
  }
}

/**
 * Handler for superhuman_switch_account tool
 */
export async function switchAccountHandler(args: z.infer<typeof SwitchAccountSchema>): Promise<ToolResult> {
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    // Get accounts to resolve the target
    const accounts = await listAccounts(conn);

    if (accounts.length === 0) {
      return errorResult("No linked accounts found");
    }

    // Determine target email: either by index (1-based) or by email address
    let targetEmail: string | undefined;
    const indexMatch = args.account.match(/^(\d+)$/);

    if (indexMatch) {
      // It's an index (1-based)
      const index = parseInt(indexMatch[1], 10);
      if (index < 1 || index > accounts.length) {
        return errorResult(`Account index ${index} not found. Valid range: 1-${accounts.length}`);
      }
      targetEmail = accounts[index - 1].email;
    } else {
      // It's an email address
      const account = accounts.find((a) => a.email === args.account);
      if (!account) {
        return errorResult(`Account "${args.account}" not found`);
      }
      targetEmail = account.email;
    }

    // Perform the switch
    const result = await switchAccount(conn, targetEmail);

    if (result.success) {
      return successResult(`Switched to ${result.email}`);
    } else {
      return errorResult(`Failed to switch to ${targetEmail}. Current account: ${result.email}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to switch account: ${message}`);
  } finally {
    if (conn) await disconnect(conn);
  }
}

/**
 * Handler for superhuman_reply tool.
 * When send=false, creates a draft via Superhuman backend (same as superhuman_draft) so it appears in the drafts list.
 * When send=true, sends the reply via provider API.
 */
export async function replyHandler(args: z.infer<typeof ReplySchema>): Promise<ToolResult> {
  const send = args.send ?? false;

  // When creating a draft (send=false), use Superhuman backend only so the draft appears in Superhuman inbox and thread
  if (!send) {
    const token = await resolveSuperhumanToken();
    if (!token?.userId || !token?.idToken) {
      return errorResult(
        "Drafts must be created with Superhuman credentials to appear in the Superhuman inbox. Run 'superhuman account auth' in Terminal (with Superhuman running), then try again."
      );
    }
    const threadInfo = await getThreadInfoDirect(token, args.threadId);
    if (!threadInfo?.from) {
      return errorResult(
        `Could not load thread ${args.threadId}. The draft must be created via Superhuman so it appears in your inbox; check the thread exists and try again.`
      );
    }
    const userInfo = getUserInfoFromCache(token.userId, token.email, token.idToken);
    const subject = threadInfo.subject.startsWith("Re:")
      ? threadInfo.subject
      : `Re: ${threadInfo.subject}`;
    const result = await createDraftWithUserInfo(userInfo, {
      action: "reply",
      inReplyToThreadId: args.threadId,
      inReplyToRfc822Id: threadInfo.messageId ?? undefined,
      references: threadInfo.references?.length ? threadInfo.references : undefined,
      to: [threadInfo.from],
      subject,
      body: textToHtml(args.body),
    });
    if (result.success) {
      return successResult(
        `Reply draft created for thread ${args.threadId} (visible in Superhuman inbox and in the email thread).\nTo: ${threadInfo.from}\nSubject: ${subject}\nDraft ID: ${result.draftId ?? "(unknown)"}`
      );
    }
    return errorResult(
      `Draft could not be created in Superhuman: ${result.error}. Run 'superhuman account auth' and try again.`
    );
  }

  // Send now
  if (send && SEND_DISABLED) {
    return errorResult(
      "Sending is disabled. Reply drafts are created with send=false; send manually from Superhuman when ready."
    );
  }

  let provider: ConnectionProvider | null = null;
  try {
    provider = await getMcpProvider();
    const result = await replyToThread(provider, args.threadId, args.body, send);

    if (!result.success) {
      throw new Error(result.error || "Failed to create reply");
    }

    if (send) {
      return successResult(`Reply sent successfully to thread ${args.threadId}`);
    } else {
      return successResult(
        `Reply draft created for thread ${args.threadId}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}\n(If you don't see it in Superhuman, the app may show provider drafts only when you open the thread.)`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to reply: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_reply_all tool.
 * When send=false, creates a draft via Superhuman backend so it appears in the drafts list.
 */
export async function replyAllHandler(args: z.infer<typeof ReplyAllSchema>): Promise<ToolResult> {
  const send = args.send ?? false;

  if (!send) {
    const token = await resolveSuperhumanToken();
    if (!token?.userId || !token?.idToken) {
      return errorResult(
        "Drafts must be created with Superhuman credentials to appear in the Superhuman inbox. Run 'superhuman account auth' in Terminal (with Superhuman running), then try again."
      );
    }
    const threadInfo = await getThreadInfoDirect(token, args.threadId);
    if (!threadInfo?.from) {
      return errorResult(
        `Could not load thread ${args.threadId}. The draft must be created via Superhuman so it appears in your inbox; check the thread exists and try again.`
      );
    }
    const userInfo = getUserInfoFromCache(token.userId, token.email, token.idToken);
    const subject = threadInfo.subject.startsWith("Re:")
      ? threadInfo.subject
      : `Re: ${threadInfo.subject}`;
    const toSet = new Set<string>([threadInfo.from]);
    for (const e of threadInfo.to) {
      if (e !== token.email) toSet.add(e);
    }
    const to = [...toSet];
    const cc = (threadInfo.cc || []).filter((e) => e !== token.email);
    const result = await createDraftWithUserInfo(userInfo, {
      action: "reply",
      inReplyToThreadId: args.threadId,
      inReplyToRfc822Id: threadInfo.messageId ?? undefined,
      references: threadInfo.references?.length ? threadInfo.references : undefined,
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject,
      body: textToHtml(args.body),
    });
    if (result.success) {
      return successResult(
        `Reply-all draft created for thread ${args.threadId} (visible in Superhuman inbox and in the email thread).\nTo: ${to.join(", ")}\nSubject: ${subject}\nDraft ID: ${result.draftId ?? "(unknown)"}`
      );
    }
    return errorResult(
      `Draft could not be created in Superhuman: ${result.error}. Run 'superhuman account auth' and try again.`
    );
  }

  if (send && SEND_DISABLED) {
    return errorResult(
      "Sending is disabled. Reply-all drafts are created with send=false; send manually from Superhuman when ready."
    );
  }

  let provider: ConnectionProvider | null = null;
  try {
    provider = await getMcpProvider();
    const result = await replyAllToThread(provider, args.threadId, args.body, send);

    if (!result.success) {
      throw new Error(result.error || "Failed to create reply-all");
    }

    if (send) {
      return successResult(`Reply-all sent successfully to thread ${args.threadId}`);
    } else {
      return successResult(`Reply-all draft created for thread ${args.threadId}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to reply-all: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/** Build HTML body for a forward draft (so it shows in Superhuman with original context). */
function buildForwardBodyHtml(opts: {
  userBody: string;
  from: string;
  subject: string;
  toLine: string;
  originalBody: string;
}): string {
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const parts: string[] = [];
  if (opts.userBody) {
    parts.push(`<div>${opts.userBody}</div><br>`);
  }
  parts.push("<div>---------- Forwarded message ---------</div>");
  parts.push(`<div>From: ${esc(opts.from)}</div>`);
  parts.push(`<div>Date: ${esc(new Date().toUTCString())}</div>`);
  parts.push(`<div>Subject: ${esc(opts.subject)}</div>`);
  parts.push(`<div>To: ${esc(opts.toLine)}</div><br>`);
  parts.push(opts.originalBody.includes("<") ? `<div>${opts.originalBody}</div>` : `<div>${textToHtml(opts.originalBody)}</div>`);
  return parts.join("\n");
}

/**
 * Handler for superhuman_forward tool
 */
export async function forwardHandler(args: z.infer<typeof ForwardSchema>): Promise<ToolResult> {
  const send = args.send ?? false;
  if (send && SEND_DISABLED) {
    return errorResult(
      "Sending is disabled. Forward drafts are created with send=false; send manually from Superhuman when ready."
    );
  }

  // When creating a draft, use Superhuman backend only so the forward appears in Superhuman inbox and thread
  if (!send) {
    const token = await resolveSuperhumanToken();
    if (!token?.userId || !token?.idToken) {
      return errorResult(
        "Drafts must be created with Superhuman credentials to appear in the Superhuman inbox. Run 'superhuman account auth' in Terminal (with Superhuman running), then try again."
      );
    }
    const threadInfo = await getThreadInfoDirect(token, args.threadId);
    if (!threadInfo) {
      return errorResult(
        `Could not load thread ${args.threadId}. The draft must be created via Superhuman so it appears in your inbox; check the thread exists and try again.`
      );
    }
    const messages = await getThreadMessages(token, args.threadId);
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const originalBody = lastMessage?.body ?? "";
    const subject = threadInfo.subject.startsWith("Fwd:")
      ? threadInfo.subject
      : `Fwd: ${threadInfo.subject}`;
    const toLine = [...threadInfo.to, ...threadInfo.cc].filter(Boolean).join(", ") || threadInfo.from;
    const forwardBody = buildForwardBodyHtml({
      userBody: args.body,
      from: threadInfo.from,
      subject: threadInfo.subject,
      toLine,
      originalBody,
    });
    const userInfo = getUserInfoFromCache(token.userId, token.email, token.idToken);
    const result = await createDraftWithUserInfo(userInfo, {
      action: "forward",
      inReplyToThreadId: args.threadId,
      inReplyToRfc822Id: threadInfo.messageId ?? undefined,
      references: threadInfo.references?.length ? threadInfo.references : undefined,
      to: [args.toEmail],
      subject,
      body: forwardBody,
    });
    if (result.success) {
      return successResult(
        `Forward draft created for thread ${args.threadId} (visible in Superhuman inbox and in the email thread).\nTo: ${args.toEmail}\nSubject: ${subject}\nDraft ID: ${result.draftId ?? "(unknown)"}`
      );
    }
    return errorResult(
      `Draft could not be created in Superhuman: ${result.error}. Run 'superhuman account auth' and try again.`
    );
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const result = await forwardThread(provider, args.threadId, args.toEmail, args.body, send);

    if (!result.success) {
      throw new Error(result.error || "Failed to create forward");
    }

    if (send) {
      return successResult(`Email forwarded successfully to ${args.toEmail}`);
    } else {
      return successResult(`Forward draft created for ${args.toEmail}${result.draftId ? `\nDraft ID: ${result.draftId}` : ""}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to forward: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_archive tool
 */
export async function archiveHandler(args: z.infer<typeof ArchiveSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await archiveThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Archived ${succeeded} thread(s) successfully`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to archive all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Archived ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to archive: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_delete tool
 */
export async function deleteHandler(args: z.infer<typeof DeleteSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await deleteThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Deleted ${succeeded} thread(s) successfully`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to delete all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Deleted ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to delete: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_mark_read tool
 */
export async function markReadHandler(args: z.infer<typeof MarkReadSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await markAsRead(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Marked ${succeeded} thread(s) as read`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to mark all ${failed} thread(s) as read: ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Marked ${succeeded} thread(s) as read, failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to mark as read: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_mark_unread tool
 */
export async function markUnreadHandler(args: z.infer<typeof MarkUnreadSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await markAsUnread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Marked ${succeeded} thread(s) as unread`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to mark all ${failed} thread(s) as unread: ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Marked ${succeeded} thread(s) as unread, failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to mark as unread: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_labels tool
 */
export async function labelsHandler(_args: z.infer<typeof LabelsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const labels = await listLabels(provider);

    if (labels.length === 0) {
      return successResult("No labels found");
    }

    const labelsText = labels
      .map((l) => {
        const typeInfo = l.type ? ` (${l.type})` : "";
        return `- ${l.name}${typeInfo}\n  labelId: ${l.id}`;
      })
      .join("\n");

    return successResult(`Available labels. Use labelId with superhuman_add_label or superhuman_remove_label.\n\n${labelsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list labels: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_get_labels tool
 */
export async function getLabelsHandler(args: z.infer<typeof GetLabelsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const labels = await getThreadLabels(provider, args.threadId);

    if (labels.length === 0) {
      return successResult(`No labels on thread ${args.threadId}`);
    }

    const labelsText = labels
      .map((l) => {
        const typeInfo = l.type ? ` (${l.type})` : "";
        return `- ${l.name}${typeInfo}\n  labelId: ${l.id}`;
      })
      .join("\n");

    return successResult(`Labels on thread ${args.threadId}. Use labelId with superhuman_remove_label or superhuman_add_label.\n\n${labelsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to get thread labels: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_add_label tool
 */
export async function addLabelHandler(args: z.infer<typeof AddLabelSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await addLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Added label to ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to add label to all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Added label to ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to add label: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_remove_label tool
 */
export async function removeLabelHandler(args: z.infer<typeof RemoveLabelSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await removeLabel(provider, threadId, args.labelId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Removed label from ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to remove label from all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Removed label from ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to remove label: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_star tool
 */
export async function starHandler(args: z.infer<typeof StarSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await starThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Starred ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to star all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Starred ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to star: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_unstar tool
 */
export async function unstarHandler(args: z.infer<typeof UnstarSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const results: { threadId: string; success: boolean; error?: string }[] = [];

    for (const threadId of args.threadIds) {
      const result = await unstarThread(provider, threadId);
      results.push({ threadId, success: result.success, error: result.error });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Unstarred ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      const details = results.map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return errorResult(`Failed to unstar all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = results.filter((r) => !r.success).map((r) => `${r.threadId}${r.error ? ` (${r.error})` : ""}`).join("; ");
      return successResult(`Unstarred ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to unstar: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_starred tool
 */
export async function starredHandler(args: z.infer<typeof StarredSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const limit = args.limit ?? 50;
    const threads = await listStarred(provider, limit);

    if (threads.length === 0) {
      return successResult("No starred threads found");
    }

    const threadsText = threads
      .map((t, i) => `${i + 1}. threadId: ${t.id}`)
      .join("\n");

    return successResult(`Starred threads (${threads.length}). Use threadId with superhuman_unstar, superhuman_read, superhuman_archive, etc.\n\n${threadsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list starred threads: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_snooze tool
 */
export async function snoozeHandler(args: z.infer<typeof SnoozeSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let snoozeTime: Date;
  try {
    snoozeTime = parseSnoozeTime(args.until);
  } catch (e) {
    return errorResult(`Invalid snooze time: ${args.until}`);
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const results = await snoozeThreadViaProvider(provider, args.threadIds, snoozeTime);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Snoozed ${succeeded} thread(s) until ${snoozeTime.toISOString()}`);
    } else if (succeeded === 0) {
      const details = args.threadIds
        .map((id, i) => `${id}${results[i].error ? ` (${results[i].error})` : ""}`)
        .filter((_, i) => !results[i].success)
        .join("; ");
      return errorResult(`Failed to snooze all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = args.threadIds
        .map((id, i) => (!results[i].success ? `${id}${results[i].error ? ` (${results[i].error})` : ""}` : ""))
        .filter(Boolean)
        .join("; ");
      return successResult(`Snoozed ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to snooze: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_unsnooze tool
 */
export async function unsnoozeHandler(args: z.infer<typeof UnsnoozeSchema>): Promise<ToolResult> {
  if (args.threadIds.length === 0) {
    return errorResult("At least one thread ID is required");
  }

  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const results = await unsnoozeThreadViaProvider(provider, args.threadIds);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      return successResult(`Unsnoozed ${succeeded} thread(s)`);
    } else if (succeeded === 0) {
      const details = args.threadIds
        .map((id, i) => `${id}${results[i].error ? ` (${results[i].error})` : ""}`)
        .filter((_, i) => !results[i].success)
        .join("; ");
      return errorResult(`Failed to unsnooze all ${failed} thread(s): ${details}`);
    } else {
      const failedDetails = args.threadIds
        .map((id, i) => (!results[i].success ? `${id}${results[i].error ? ` (${results[i].error})` : ""}` : ""))
        .filter(Boolean)
        .join("; ");
      return successResult(`Unsnoozed ${succeeded} thread(s), failed on ${failed}: ${failedDetails}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to unsnooze: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_snoozed tool
 */
export async function snoozedHandler(args: z.infer<typeof SnoozedSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const limit = args.limit ?? 50;
    const threads = await listSnoozedViaProvider(provider, limit);

    if (threads.length === 0) {
      return successResult("No snoozed threads found");
    }

    const threadsText = threads
      .map((t, i) => {
        const untilStr = t.snoozeUntil ? ` (until ${t.snoozeUntil})` : "";
        return `${i + 1}. threadId: ${t.id}${untilStr}`;
      })
      .join("\n");

    return successResult(`Snoozed threads (${threads.length}). Use threadId with superhuman_unsnooze, superhuman_read, etc.\n\n${threadsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list snoozed threads: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_attachments tool
 */
export async function attachmentsHandler(args: z.infer<typeof AttachmentsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const attachments = await listAttachments(provider, args.threadId);

    if (attachments.length === 0) {
      return successResult(`No attachments found in thread ${args.threadId}`);
    }

    const attachmentsText = attachments
      .map((att, i) => {
        return `${i + 1}. ${att.name}\n   mimeType: ${att.mimeType}\n   attachmentId: ${att.attachmentId}\n   messageId: ${att.messageId}`;
      })
      .join("\n\n");

    return successResult(`Attachments in thread ${args.threadId} (${attachments.length}). Use messageId and attachmentId with superhuman_download_attachment.\n\n${attachmentsText}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list attachments: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_download_attachment tool
 */
export async function downloadAttachmentHandler(args: z.infer<typeof DownloadAttachmentSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const content = await downloadAttachment(provider, args.messageId, args.attachmentId, args.threadId, args.mimeType);

    return successResult(JSON.stringify({
      data: content.data,
      size: content.size,
      mimeType: args.mimeType || "application/octet-stream",
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to download attachment: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}


/**
 * Handler for superhuman_calendar_list tool
 */
export async function calendarListHandler(args: z.infer<typeof CalendarListSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    // Parse date range
    let timeMin: Date;
    let timeMax: Date;

    if (args.start) {
      // --start/--end take precedence over date/range
      timeMin = new Date(args.start);
      if (isNaN(timeMin.getTime())) throw new Error(`Invalid start time: ${args.start}`);
      if (args.end) {
        timeMax = new Date(args.end);
        if (isNaN(timeMax.getTime())) throw new Error(`Invalid end time: ${args.end}`);
      } else {
        // Default: end of same day as start
        timeMax = new Date(timeMin);
        timeMax.setHours(23, 59, 59, 999);
      }
    } else {
      if (args.date) {
        const lowerDate = args.date.toLowerCase();
        if (lowerDate === "today") {
          timeMin = new Date();
          timeMin.setHours(0, 0, 0, 0);
        } else if (lowerDate === "tomorrow") {
          timeMin = new Date();
          timeMin.setDate(timeMin.getDate() + 1);
          timeMin.setHours(0, 0, 0, 0);
        } else {
          // Parse YYYY-MM-DD as local midnight (not UTC)
          // new Date("YYYY-MM-DD") per ECMAScript spec parses as UTC midnight,
          // which becomes the previous day in timezones west of UTC.
          const dateMatch = args.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (dateMatch) {
            timeMin = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]));
          } else {
            timeMin = new Date(args.date);
          }
        }
      } else {
        timeMin = new Date();
        timeMin.setHours(0, 0, 0, 0);
      }

      const range = args.range || 1;
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + range);
      timeMax.setHours(23, 59, 59, 999);
    }

    const events = await listEvents(provider, { timeMin, timeMax });

    const intro = "Calendar events. Use each event's 'id' with superhuman_calendar_update or superhuman_calendar_delete.\n\n";
    return successResult(intro + JSON.stringify(events, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list calendar events: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_calendar_create tool
 */
export async function calendarCreateHandler(args: z.infer<typeof CalendarCreateSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const startTime = new Date(args.startTime);
    let endTime: Date;
    if (args.endTime) {
      endTime = new Date(args.endTime);
    } else {
      endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // Default 30 minutes
    }

    const eventInput: CreateEventInput = {
      summary: args.title,
      description: args.description,
      start: args.allDay
        ? { date: args.startTime.split("T")[0] }
        : { dateTime: startTime.toISOString() },
      end: args.allDay
        ? { date: endTime.toISOString().split("T")[0] }
        : { dateTime: endTime.toISOString() },
      attendees: args.attendees?.map(email => ({ email })),
    };

    const result = await createEvent(provider, eventInput);

    if (result.success) {
      return successResult(JSON.stringify({
        success: true,
        eventId: result.eventId,
        message: "Event created successfully",
      }));
    } else {
      return errorResult(`Failed to create event: ${result.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to create calendar event: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_calendar_update tool
 */
export async function calendarUpdateHandler(args: z.infer<typeof CalendarUpdateSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();

    const updates: UpdateEventInput = {};
    if (args.title) updates.summary = args.title;
    if (args.description) updates.description = args.description;
    if (args.startTime) updates.start = { dateTime: new Date(args.startTime).toISOString() };
    if (args.endTime) updates.end = { dateTime: new Date(args.endTime).toISOString() };
    if (args.attendees) updates.attendees = args.attendees.map(email => ({ email }));

    const result = await updateEvent(provider, args.eventId, updates);

    if (result.success) {
      return successResult(JSON.stringify({
        success: true,
        eventId: result.eventId,
        message: "Event updated successfully",
      }));
    } else {
      return errorResult(`Failed to update event: ${result.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to update calendar event: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_calendar_delete tool
 */
export async function calendarDeleteHandler(args: z.infer<typeof CalendarDeleteSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const result = await deleteCalendarEvent(provider, args.eventId);

    if (result.success) {
      return successResult(JSON.stringify({
        success: true,
        message: `Event ${args.eventId} deleted successfully`,
      }));
    } else {
      return errorResult(`Failed to delete event: ${result.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to delete calendar event: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_calendar_free_busy tool
 */
export async function calendarFreeBusyHandler(args: z.infer<typeof CalendarFreeBusySchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const result = await getFreeBusy(provider, {
      timeMin: new Date(args.timeMin),
      timeMax: new Date(args.timeMax),
    });

    return successResult(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to check free/busy: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

// =============================================================================
// Snippets Tools
// =============================================================================

export const SnippetsSchema = z.object({});

export const UseSnippetSchema = z.object({
  name: z.string().describe("Exact snippet name from superhuman_snippets (fuzzy match supported)"),
  to: z.string().optional().describe("Recipient email address (overrides snippet default)"),
  cc: z.string().optional().describe("CC recipient email (overrides snippet default)"),
  bcc: z.string().optional().describe("BCC recipient email (overrides snippet default)"),
  vars: z.string().optional().describe("Template variables as 'key1=val1,key2=val2'"),
  send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
});

/**
 * Get UserInfo from a ConnectionProvider (prefers cached tokens, falls back to CDP).
 */
async function getUserInfoFromProvider(provider: ConnectionProvider): Promise<import("../draft-api").UserInfo> {
  const token = await provider.getToken();
  if (token.userId && token.idToken) {
    return getUserInfoFromCache(token.userId, token.email, token.idToken);
  }
  // Fallback: if token lacks userId/idToken, try CDP
  const conn = await connectToSuperhuman(CDP_PORT);
  if (!conn) {
    throw new Error("Cached token missing userId/idToken. Run 'superhuman account auth' to re-authenticate.");
  }
  try {
    return await getUserInfo(conn);
  } finally {
    await disconnect(conn);
  }
}

/**
 * Handler for superhuman_snippets tool - list all snippets
 */
export async function snippetsHandler(_args: z.infer<typeof SnippetsSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const userInfo = await getUserInfoFromProvider(provider);
    const snippets = await listSnippets(userInfo);

    if (snippets.length === 0) {
      return successResult("No snippets found");
    }

    const snippetsList = snippets
      .map((s) => {
        const lastUsed = s.lastSentAt ? new Date(s.lastSentAt).toLocaleDateString() : "never";
        return `- name: ${s.name}\n  Sends: ${s.sends} | Last used: ${lastUsed}\n  Subject: ${s.subject || "(none)"}\n  Preview: ${s.snippet || "(empty)"}`;
      })
      .join("\n\n");

    return successResult(`Snippets (${snippets.length}). Use the exact 'name' with superhuman_snippet.\n\n${snippetsList}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to list snippets: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

/**
 * Handler for superhuman_snippet tool - use a snippet to compose/send
 */
export async function useSnippetHandler(args: z.infer<typeof UseSnippetSchema>): Promise<ToolResult> {
  let provider: ConnectionProvider | null = null;

  try {
    provider = await getMcpProvider();
    const userInfo = await getUserInfoFromProvider(provider);
    const snippets = await listSnippets(userInfo);
    const snippet = findSnippet(snippets, args.name);

    if (!snippet) {
      const available = snippets.map((s) => s.name).join(", ");
      return errorResult(`No snippet matching "${args.name}". Available: ${available}`);
    }

    // Apply template variables
    const vars = args.vars ? parseVars(args.vars) : {};
    let body = snippet.body;
    let subject = snippet.subject;
    if (Object.keys(vars).length > 0) {
      body = applyVars(body, vars);
      subject = applyVars(subject, vars);
    }

    // Merge recipients
    const to = args.to ? [args.to] : snippet.to;
    const cc = args.cc ? [args.cc] : snippet.cc.length > 0 ? snippet.cc : undefined;
    const bcc = args.bcc ? [args.bcc] : snippet.bcc.length > 0 ? snippet.bcc : undefined;

    if (args.send) {
      if (to.length === 0) {
        return errorResult("At least one recipient is required (provide 'to' or snippet must have default recipients)");
      }

      const draftResult = await createDraftWithUserInfo(userInfo, { to, cc, bcc, subject, body });
      if (!draftResult.success || !draftResult.draftId || !draftResult.threadId) {
        return errorResult(`Failed to create draft: ${draftResult.error}`);
      }

      const sendResult = await sendDraftSuperhuman(userInfo, {
        draftId: draftResult.draftId,
        threadId: draftResult.threadId,
        to: to.map((email) => ({ email })),
        cc: cc?.map((email) => ({ email })),
        bcc: bcc?.map((email) => ({ email })),
        subject,
        htmlBody: body,
        delay: 0,
      });

      if (sendResult.success) {
        return successResult(`Sent using snippet "${snippet.name}" to ${to.join(", ")}`);
      } else {
        return errorResult(`Failed to send: ${sendResult.error}`);
      }
    } else {
      const result = await createDraftWithUserInfo(userInfo, { to, cc, bcc, subject, body });
      if (result.success) {
        return successResult(
          `Draft created from snippet "${snippet.name}"\nDraft ID: ${result.draftId}\nTo: ${to.join(", ")}\nSubject: ${subject || "(none)"}`
        );
      } else {
        return errorResult(`Failed to create draft: ${result.error}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`Failed to use snippet: ${message}`);
  } finally {
    if (provider) await provider.disconnect();
  }
}

// ========== AI Search ==========

export const AskAISchema = z.object({
  query: z.string().describe("Natural language query — search emails, ask questions, compose drafts, etc."),
  thread_id: z.string().optional().describe("Optional thread ID (from superhuman_inbox or superhuman_read) to ask about a specific email thread"),
});

export async function askAIHandler(args: z.infer<typeof AskAISchema>): Promise<ToolResult> {
  try {
    const token = await resolveSuperhumanToken();
    if (!token || !token.idToken) {
      return errorResult(
        "No Superhuman credentials found. Log in to Superhuman in the app and ensure the MCP setup has run (or run 'superhuman account auth' from the CLI). " + CONNECTION_HINT
      );
    }

    const result = await askAISearch(
      token.idToken,
      token,
      args.query,
      { threadId: args.thread_id },
    );

    return successResult(result.response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResult(`AI query failed: ${message}`);
  }
}
