/**
 * Inbox Module
 *
 * Functions for listing and searching inbox threads via direct Gmail/MS Graph API.
 */

import type { ConnectionProvider } from "./connection-provider";
import {
  searchGmailDirect,
  listInboxDirect,
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
}

export interface SearchOptions {
  query: string;
  limit?: number;
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

/**
 * List threads from the current inbox view
 */
export async function listInbox(
  provider: ConnectionProvider,
  options: ListInboxOptions = {}
): Promise<InboxThread[]> {
  const limit = options.limit ?? 10;
  const token = await provider.getToken();
  return listInboxDirect(token, limit);
}

/**
 * Search threads using direct Gmail/MS Graph API.
 *
 * When includeDone is false (default), only searches inbox threads.
 * When includeDone is true, searches ALL emails including archived/done items.
 */
export async function searchInbox(
  provider: ConnectionProvider,
  options: SearchOptions
): Promise<InboxThread[]> {
  const { query, limit = 10, includeDone = false } = options;
  const token = await provider.getToken();

  if (includeDone) {
    // Search all emails (no inbox filter)
    return searchGmailDirect(token, query, limit);
  } else {
    // Search only inbox threads
    // For Gmail, add label:INBOX to query
    // For MS Graph, listInboxDirect already filters to inbox
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
        if (!response.ok) return [];
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

      const threads: InboxThread[] = [];
      for (const [convId, messages] of conversationMap) {
        if (threads.length >= limit) break;
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
      return threads;
    } else {
      // Gmail: Add label:INBOX to the query
      const inboxQuery = `label:INBOX ${query}`;
      return searchGmailDirect(token, inboxQuery, limit);
    }
  }
}
