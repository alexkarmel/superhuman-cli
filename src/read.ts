/**
 * Read Module
 *
 * Functions for reading thread/message content via direct Gmail / MS Graph APIs.
 */

import type { ConnectionProvider } from "./connection-provider";
import type { TokenInfo } from "./token-api";
import { gmailFetch, getThreadMessages } from "./token-api";

export interface ThreadMessage {
  id: string;
  threadId: string;
  subject: string;
  from: {
    email: string;
    name: string;
  };
  to: Array<{ email: string; name: string }>;
  cc: Array<{ email: string; name: string }>;
  date: string;
  snippet: string;
}

/**
 * Parse a single email address from a header value like "Name <email>" or bare "email".
 */
function parseRecipient(str: string): { email: string; name: string } {
  const trimmed = str.trim();
  if (!trimmed) return { email: "", name: "" };
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, ""),
      email: match[2],
    };
  }
  return { email: trimmed, name: "" };
}

/**
 * Parse a comma-separated list of email addresses from a header value.
 */
function parseRecipientList(
  header: string
): Array<{ email: string; name: string }> {
  if (!header) return [];
  return header
    .split(",")
    .map(parseRecipient)
    .filter((r) => r.email);
}

/**
 * Read all messages in a thread via direct API calls (Gmail or MS Graph).
 */
export async function readThread(
  provider: ConnectionProvider,
  threadId: string
): Promise<ThreadMessage[]> {
  const token = await provider.getToken();

  if (token.isMicrosoft) {
    return readThreadMSGraph(token, threadId);
  } else {
    return readThreadGmail(token.accessToken, threadId);
  }
}

/**
 * Read thread messages from Gmail API.
 */
async function readThreadGmail(
  accessToken: string,
  threadId: string
): Promise<ThreadMessage[]> {
  const result = await gmailFetch(
    accessToken,
    `/threads/${threadId}?format=full`
  );

  if (!result || !result.messages) {
    return [];
  }

  return result.messages.map((msg: any) => {
    const headers: Array<{ name: string; value: string }> =
      msg.payload?.headers || [];

    const getHeader = (name: string): string => {
      const h = headers.find(
        (h: any) => h.name.toLowerCase() === name.toLowerCase()
      );
      return h?.value || "";
    };

    const fromParsed = parseRecipient(getHeader("From"));

    return {
      id: msg.id,
      threadId: result.id,
      subject: getHeader("Subject") || "(no subject)",
      from: fromParsed,
      to: parseRecipientList(getHeader("To")),
      cc: parseRecipientList(getHeader("Cc")),
      date: getHeader("Date"),
      snippet: msg.snippet || "",
    };
  });
}

/**
 * Read thread messages from MS Graph API.
 * Uses getThreadMessages (which paginates) so long threads are not truncated.
 */
async function readThreadMSGraph(
  token: TokenInfo,
  conversationId: string
): Promise<ThreadMessage[]> {
  const fullMessages = await getThreadMessages(token, conversationId);
  return fullMessages.map((msg) => ({
    id: msg.message_id,
    threadId: conversationId,
    subject: msg.subject || "(no subject)",
    from: msg.from,
    to: msg.to,
    cc: msg.cc,
    date: msg.date,
    snippet: msg.snippet,
  }));
}
