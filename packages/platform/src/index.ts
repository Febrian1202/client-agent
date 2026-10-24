export interface FindClientInput {
  username: string;
}

export interface ClientResult {
  id: string;
  username: string;
  displayName?: string;
}

export interface GetConversationInput {
  clientUsername: string;
  limit?: number;
}

export interface MessageAttachment {
  type: 'image' | 'file';
  url: string;
  name?: string;
  mimeType?: string;
}

export interface MessageResult {
  externalId: string;
  direction: 'inbound' | 'outbound';
  senderName: string;
  content: string;
  sentAt: Date | null;
  sentAtRaw?: string | null;
  attachments?: MessageAttachment[];
}

export interface ConversationResult {
  externalId: string;
  externalUrl: string;
  clientUsername: string;
  messages: MessageResult[];
}

export interface PlatformAdapter {
  findClient(input: FindClientInput): Promise<ClientResult>;
  getConversation(input: GetConversationInput): Promise<ConversationResult>;
  getMessages(input: { conversationId: string; limit?: number }): Promise<MessageResult[]>;
  sendMessage(input: { conversationId: string; content: string }): Promise<{
    success: boolean;
    messageId: string;
  }>;
}
