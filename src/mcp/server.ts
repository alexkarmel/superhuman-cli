/**
 * MCP Server for Superhuman CLI
 *
 * Exposes Superhuman automation functions as MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SendSchema, SearchSchema, InboxSchema, ReadSchema,
  AccountsSchema, SwitchAccountSchema, ReplySchema, ReplyAllSchema, ForwardSchema,
  ReplySchemaDraftOnly, ReplyAllSchemaDraftOnly, ForwardSchemaDraftOnly,
  ArchiveSchema, DeleteSchema,
  MarkReadSchema, MarkUnreadSchema, LabelsSchema, GetLabelsSchema, AddLabelSchema, RemoveLabelSchema,
  StarSchema, UnstarSchema, StarredSchema,
  SnoozeSchema, UnsnoozeSchema, SnoozedSchema,
  AttachmentsSchema, DownloadAttachmentSchema,
  CalendarListSchema, CalendarCreateSchema, CalendarUpdateSchema, CalendarDeleteSchema, CalendarFreeBusySchema,
  sendHandler, searchHandler, inboxHandler, readHandler,
  accountsHandler, switchAccountHandler, replyHandler, replyAllHandler, forwardHandler,
  archiveHandler, deleteHandler,
  markReadHandler, markUnreadHandler, labelsHandler, getLabelsHandler, addLabelHandler, removeLabelHandler,
  starHandler, unstarHandler, starredHandler,
  snoozeHandler, unsnoozeHandler, snoozedHandler,
  attachmentsHandler, downloadAttachmentHandler,
  calendarListHandler, calendarCreateHandler, calendarUpdateHandler, calendarDeleteHandler, calendarFreeBusyHandler,
  SnippetsSchema, UseSnippetSchema,
  snippetsHandler, useSnippetHandler,
  AskAISchema, askAIHandler,
  SEND_DISABLED,
} from "./tools";

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "superhuman-cli", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  if (!SEND_DISABLED) {
    server.registerTool(
      "superhuman_send",
      {
        description: "Send an email immediately. Use ONLY when the user explicitly asks to send or 'send now'. For drafts use superhuman_reply; user sends manually from Superhuman.",
        inputSchema: SendSchema,
      },
      sendHandler
    );
  }

  server.registerTool(
    "superhuman_search",
    {
      description: "Search the Superhuman inbox (or all mail). Returns matching threads with a threadId for each; use those threadIds with superhuman_read, superhuman_star, superhuman_reply, etc. Use includeDone=true when the user asks to find archived emails or 'search all my emails'. Backend paginates automatically (default 500, max 5000).",
      inputSchema: SearchSchema,
    },
    searchHandler
  );

  server.registerTool(
    "superhuman_inbox",
    {
      description: "List recent emails from the Superhuman inbox. Returns thread summaries and a threadId for each; use those threadIds with superhuman_read, superhuman_star, superhuman_archive, etc. Backend paginates automatically (default 500, max 5000) so you never miss emails.",
      inputSchema: InboxSchema,
    },
    inboxHandler
  );

  server.registerTool(
    "superhuman_read",
    {
      description: "Read a specific email thread by threadId. Pass the threadId from superhuman_inbox or superhuman_search. Returns all messages with messageId and threadId for use with superhuman_download_attachment, superhuman_reply, superhuman_reply_all, or superhuman_forward.",
      inputSchema: ReadSchema,
    },
    readHandler
  );

  server.registerTool(
    "superhuman_accounts",
    {
      description: "List all linked email accounts in Superhuman. Returns accounts with current marker.",
      inputSchema: AccountsSchema,
    },
    accountsHandler
  );

  server.registerTool(
    "superhuman_switch_account",
    {
      description: "Switch to a different linked email account in Superhuman. Accepts either an email address or a 1-based index number.",
      inputSchema: SwitchAccountSchema,
    },
    switchAccountHandler
  );

  server.registerTool(
    "superhuman_reply",
    {
      description: SEND_DISABLED
        ? "Create a reply draft in the thread (requires threadId). Use for ANY reply or 'draft a response' to an email — this is the only way to create reply drafts; the draft appears in the thread with the conversation above it. Get threadId from superhuman_inbox or superhuman_read. User sends manually from Superhuman."
        : "Reply or draft a response in the thread (requires threadId). Use for reply, respond, or draft a response — this is the only way to create reply drafts; the draft appears in the thread with the conversation above it. Get threadId from superhuman_inbox or superhuman_read. Optional send=true sends immediately; default is draft in thread.",
      inputSchema: SEND_DISABLED ? ReplySchemaDraftOnly : ReplySchema,
    },
    replyHandler
  );

  server.registerTool(
    "superhuman_reply_all",
    {
      description: SEND_DISABLED
        ? "Create a reply-all draft in the thread (requires threadId). Use when the user asks to 'reply all'. This is the only way to create reply-all drafts; the draft appears in the thread with the conversation above it. User sends manually from Superhuman."
        : "Reply-all in-thread (requires threadId). Use when the user asks to 'reply all'. The draft appears in the thread with the conversation above it. Optional send=true sends immediately.",
      inputSchema: SEND_DISABLED ? ReplyAllSchemaDraftOnly : ReplyAllSchema,
    },
    replyAllHandler
  );

  server.registerTool(
    "superhuman_forward",
    {
      description: SEND_DISABLED
        ? "Create a forward draft (requires threadId and toEmail). Use when the user asks to 'forward'. This is the only way to create forward drafts; the draft appears in the thread with the conversation above it. User sends manually from Superhuman."
        : "Forward a thread (requires threadId and toEmail). The draft appears in the thread with the conversation above it. Optional send=true sends immediately.",
      inputSchema: SEND_DISABLED ? ForwardSchemaDraftOnly : ForwardSchema,
    },
    forwardHandler
  );

  server.registerTool(
    "superhuman_archive",
    {
      description: "Archive one or more email threads. Pass threadIds from superhuman_inbox or superhuman_search. Removes threads from inbox without deleting.",
      inputSchema: ArchiveSchema,
    },
    archiveHandler
  );

  server.registerTool(
    "superhuman_delete",
    {
      description: "Delete (trash) one or more email threads. Pass threadIds from superhuman_inbox or superhuman_search. Moves threads to trash.",
      inputSchema: DeleteSchema,
    },
    deleteHandler
  );

  server.registerTool(
    "superhuman_mark_read",
    {
      description: "Mark one or more email threads as read. Removes the unread indicator from threads.",
      inputSchema: MarkReadSchema,
    },
    markReadHandler
  );

  server.registerTool(
    "superhuman_mark_unread",
    {
      description: "Mark one or more email threads as unread. Adds the unread indicator to threads.",
      inputSchema: MarkUnreadSchema,
    },
    markUnreadHandler
  );

  server.registerTool(
    "superhuman_labels",
    {
      description: "List all available labels/folders in the Superhuman account. Returns label IDs and names.",
      inputSchema: LabelsSchema,
    },
    labelsHandler
  );

  server.registerTool(
    "superhuman_get_labels",
    {
      description: "Get all labels on a specific email thread. Returns label IDs and names for the thread.",
      inputSchema: GetLabelsSchema,
    },
    getLabelsHandler
  );

  server.registerTool(
    "superhuman_add_label",
    {
      description: "Add a label to one or more email threads. Use superhuman_labels first to get available label IDs.",
      inputSchema: AddLabelSchema,
    },
    addLabelHandler
  );

  server.registerTool(
    "superhuman_remove_label",
    {
      description: "Remove a label from one or more email threads. Use superhuman_get_labels to see current labels on a thread.",
      inputSchema: RemoveLabelSchema,
    },
    removeLabelHandler
  );

  server.registerTool(
    "superhuman_star",
    {
      description: "Star one or more email threads. Pass threadIds from superhuman_inbox or superhuman_search. Adds the STARRED label.",
      inputSchema: StarSchema,
    },
    starHandler
  );

  server.registerTool(
    "superhuman_unstar",
    {
      description: "Unstar one or more email threads. Removes the STARRED label from threads.",
      inputSchema: UnstarSchema,
    },
    unstarHandler
  );

  server.registerTool(
    "superhuman_starred",
    {
      description: "List all starred email threads. Returns thread IDs of emails marked with the STARRED label.",
      inputSchema: StarredSchema,
    },
    starredHandler
  );

  server.registerTool(
    "superhuman_snooze",
    {
      description: "Snooze one or more email threads until a specific time. Use presets (tomorrow, next-week, weekend, evening) or ISO datetime.",
      inputSchema: SnoozeSchema,
    },
    snoozeHandler
  );

  server.registerTool(
    "superhuman_unsnooze",
    {
      description: "Unsnooze one or more email threads. Cancels the snooze and returns threads to inbox.",
      inputSchema: UnsnoozeSchema,
    },
    unsnoozeHandler
  );

  server.registerTool(
    "superhuman_snoozed",
    {
      description: "List all snoozed email threads. Returns thread IDs and snooze times.",
      inputSchema: SnoozedSchema,
    },
    snoozedHandler
  );

  server.registerTool(
    "superhuman_attachments",
    {
      description: "List all attachments in an email thread. Pass threadId from superhuman_inbox or superhuman_read. Returns messageId and attachmentId for each; use those with superhuman_download_attachment.",
      inputSchema: AttachmentsSchema,
    },
    attachmentsHandler
  );

  server.registerTool(
    "superhuman_download_attachment",
    {
      description: "Download an attachment from an email. Pass messageId and attachmentId from superhuman_attachments. Returns file content as base64 plus size and MIME type.",
      inputSchema: DownloadAttachmentSchema,
    },
    downloadAttachmentHandler
  );

  server.registerTool(
    "superhuman_calendar_list",
    {
      description: "List calendar events from Superhuman for a date range. Returns each event's id; use that id with superhuman_calendar_update or superhuman_calendar_delete.",
      inputSchema: CalendarListSchema,
    },
    calendarListHandler
  );

  server.registerTool(
    "superhuman_calendar_create",
    {
      description: "Create a new calendar event in Superhuman. Supports timed events and all-day events with optional attendees.",
      inputSchema: CalendarCreateSchema,
    },
    calendarCreateHandler
  );

  server.registerTool(
    "superhuman_calendar_update",
    {
      description: "Update an existing calendar event in Superhuman. Can modify title, times, description, or attendees.",
      inputSchema: CalendarUpdateSchema,
    },
    calendarUpdateHandler
  );

  server.registerTool(
    "superhuman_calendar_delete",
    {
      description: "Delete a calendar event from Superhuman by its event ID.",
      inputSchema: CalendarDeleteSchema,
    },
    calendarDeleteHandler
  );

  server.registerTool(
    "superhuman_calendar_free_busy",
    {
      description: "Check free/busy availability in the calendar. Returns busy time slots within the specified time range.",
      inputSchema: CalendarFreeBusySchema,
    },
    calendarFreeBusyHandler
  );

  server.registerTool(
    "superhuman_snippets",
    {
      description: "List all snippets (reusable email templates) in Superhuman. Returns each snippet's name; use the exact name with superhuman_snippet.",
      inputSchema: SnippetsSchema,
    },
    snippetsHandler
  );

  server.registerTool(
    "superhuman_snippet",
    {
      description: "Use a snippet to compose or send an email. Pass the snippet name from superhuman_snippets (fuzzy match supported). Creates a draft by default or send=true to send immediately.",
      inputSchema: UseSnippetSchema,
    },
    useSnippetHandler
  );

  server.registerTool(
    "superhuman_ask_ai",
    {
      description: "Ask Superhuman AI to search emails, answer questions, or compose drafts. Pass a natural-language query; optionally pass thread_id (from superhuman_inbox or superhuman_read) to ask about a specific thread.",
      inputSchema: AskAISchema,
    },
    askAIHandler
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { createMcpServer };
