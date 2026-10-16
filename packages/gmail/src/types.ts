export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
}

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export interface GmailClient {
  getProfile(): Promise<GmailProfile>;
  fetchMessageById(messageId: string): Promise<GmailMessage>;
  listHistory(startHistoryId: string): Promise<{ messageIds: string[]; latestHistoryId: string }>;
}
