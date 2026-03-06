/**
 * Inbox Module
 *
 * Functions for listing and searching inbox threads via direct Gmail/MS Graph API.
 */

import type { ConnectionProvider } from "./connection-provider";
import {
  searchGmailDirect,
  listInboxDirect,
  countInboxDirect,
  type CountInboxOptions,
  type CountInboxResult,
  type SearchListResult,
} from "./token-api";

export interface InboxThread {
  id: string;
  subject: string;
  from: {
    email: string;
    name: string;
  };
  date: string;
  snippet: string;
  labelIds: string[];
  messageCount: number;
}

export interface ListInboxOptions {
  limit?: number;
  /** Skip this many threads (for pagination; use with limit to avoid timeout). */
  offset?: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  /** Skip this many threads (for pagination; use with limit to avoid timeout). */
  offset?: number;
  /**
   * When true, use direct Gmail/MS Graph API for search.
   * This searches ALL emails including archived/done items.
   * Default (false) uses Superhuman's inbox-only search.
   *
   * Note: With direct API migration, both modes now use direct API.
   * The difference is that includeDone=true removes label:INBOX filter.
   */
  includeDone?: boolean;
}

export type { SearchListResult };

/**
 * Count messages and threads matching a query without fetching thread details.
 * Fast for large mailboxes (e.g. "how many emails in the last 48 hours").
 */
export async function countInbox(
  provider: ConnectionProvider,
  options: CountInboxOptions = {}
): Promise<CountInboxResult> {
  const token = await provider.getToken();
  return countInboxDirect(token, options);
}

/**
 * List threads from the current inbox view.
 * Returns paginated result (threads, hasMore, nextOffset) to avoid timeout on large inboxes.
 */
export async function listInbox(
  provider: ConnectionProvider,
  options: ListInboxOptions = {}
): Promise<SearchListResult> {
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;
  const token = await provider.getToken();
  return listInboxDirect(token, limit, offset);
}

/**
 * Search threads using direct Gmail/MS Graph API.
 * Returns paginated result (threads, hasMore, nextOffset) to avoid timeout on large result sets.
 *
 * When includeDone is false (default), only searches inbox threads.
 * When includeDone is true, searches ALL emails including archived/done items.
 */
export async function searchInbox(
  provider: ConnectionProvider,
  options: SearchOptions
): Promise<SearchListResult> {
  const { query, limit = 10, offset = 0, includeDone = false } = options;
  const token = await provider.getToken();

  if (includeDone) {
    return searchGmailDirect(token, query, limit, offset);
  }

  if (token.isMicrosoft) {
    // MS Graph: search within inbox folder with pagination
    interface MSGraphMessage {
      id: string;
      conversationId: string;
      subject?: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      receivedDateTime: string;
      bodyPreview?: string;
    }
    const GRAPH_PAGE = 500;
    const MAX_SCAN = 5000;
    const allMessages: MSGraphMessage[] = [];
    let nextLink: string | null = null;
    const basePath = `https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages?$search="${encodeURIComponent(query)}"&$top=${GRAPH_PAGE}&$select=id,conversationId,subject,from,receivedDateTime,bodyPreview`;

    do {
      const url = nextLink ?? basePath;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (!response.ok) return { threads: [], hasMore: false, nextOffset: 0 };
      const result = (await response.json()) as { value?: MSGraphMessage[]; "@odata.nextLink"?: string };
      if (!result.value?.length) break;
      allMessages.push(...result.value);
      if (allMessages.length >= MAX_SCAN) break;
      nextLink = result["@odata.nextLink"] ?? null;
    } while (nextLink);

    const conversationMap = new Map<string, MSGraphMessage[]>();
    for (const msg of allMessages) {
      const existing = conversationMap.get(msg.conversationId);
      if (!existing) {
        conversationMap.set(msg.conversationId, [msg]);
      } else {
        existing.push(msg);
      }
    }

    const convEntries = Array.from(conversationMap.entries());
    const total = convEntries.length;
    const hasMore = total > offset + limit;
    const pageEntries = convEntries.slice(offset, offset + limit);

    const threads: InboxThread[] = [];
    for (const [convId, messages] of pageEntries) {
      messages.sort((a, b) =>
        new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
      );
      const latest = messages[0];
      threads.push({
        id: convId,
        subject: latest.subject || "(no subject)",
        from: {
          email: latest.from?.emailAddress?.address || "",
          name: latest.from?.emailAddress?.name || "",
        },
        date: latest.receivedDateTime,
        snippet: latest.bodyPreview || "",
        labelIds: [],
        messageCount: messages.length,
      });
    }
    return { threads, hasMore, nextOffset: offset + threads.length };
  }

  // Gmail: Add label:INBOX to the query
  const inboxQuery = `label:INBOX ${query}`;
  return searchGmailDirect(token, inboxQuery, limit, offset);
}
