import type { ChatMessage } from '@client-agent/ai';

export interface PromptMessageHistory {
  direction: 'inbound' | 'outbound';
  senderName: string;
  content: string;
  sentAt: Date | string;
}

export interface ConversationContextForPrompt {
  clientUsername: string;
  clientDisplayName?: string;
  creatorUsername?: string;
  messages: PromptMessageHistory[];
}

export const SYSTEM_CREATOR_PERSONA = `You are a client communication assistant representing an art creator on VGen (@r1daz_).
The creator specializes in Live2D art cutting, layer separation, style-matching redraws, and animation for VTubers.
Your tone is authentic, calm, polite, helpful, and concise — like a skilled professional artist talking directly to a client.`;

export const SYSTEM_ANTI_SLOP_RULES = `STRICT ANTI-AI SLOP & CONVERSATION RHYTHM RULES:
1. GREETING RHYTHM: Do NOT repeat robotic greetings like "Hi [Name]!" or "Hello @client!" if the conversation is ongoing or messages were exchanged recently. Answer directly and naturally.
2. EMOJI RULE: Maximum 1 emoji per message, or none at all. Never stack or sprinkle multiple emojis.
3. REVISION POLICY: Receptive to minor revisions (e.g., small layer cuts, minor adjustments), but never promise out-of-scope work without creator confirmation.
4. FACTUALITY: Never invent facts, prices, dates, or delivery promises. Never hallucinate history.
5. LANGUAGE & VOICE: Respond in the matching natural language used in the chat (Indonesian / English). Match the creator's casual-professional style.`;

function formatHistory(messages: PromptMessageHistory[]): string {
  if (!messages || messages.length === 0) {
    return 'No prior message history found.';
  }

  return messages
    .map((m) => {
      const timeStr = m.sentAt instanceof Date ? m.sentAt.toISOString() : String(m.sentAt);
      const dirTag = m.direction === 'inbound' ? '[CLIENT]' : '[CREATOR]';
      return `${dirTag} ${m.senderName} (${timeStr}):\n${m.content}`;
    })
    .join('\n\n');
}

export function buildSummaryPrompt(context: ConversationContextForPrompt): ChatMessage[] {
  const historyText = formatHistory(context.messages);

  const systemContent = `${SYSTEM_CREATOR_PERSONA}

${SYSTEM_ANTI_SLOP_RULES}

Your goal is to provide an accurate, high-density summary of the conversation with client @${context.clientUsername}.`;

  const userContent = `Here is the conversation history with client @${context.clientUsername}${
    context.clientDisplayName ? ` (${context.clientDisplayName})` : ''
  }:

---
${historyText}
---

Please analyze the conversation above and provide a structured summary with the following clear sections:
1. **Status / Stage**: Current status (e.g., Initial Inquiry, Price Discussion, Work in Progress, Revision Requested, Delivered/Complete).
2. **Key Details & Client Requests**: Bullet points detailing specifically what the client asked for or inquired about.
3. **Next Action for Creator**: The single most immediate and actionable next step for the creator.

Keep it grounded strictly in the messages above. If anything is ambiguous or uncertain, explicitly note it as unverified.`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

export function buildReplyPrompt(
  context: ConversationContextForPrompt,
  instruction: string,
  tone?: string
): ChatMessage[] {
  const historyText = formatHistory(context.messages);

  const systemContent = `${SYSTEM_CREATOR_PERSONA}

${SYSTEM_ANTI_SLOP_RULES}

IMPORTANT CONSTRAINTS FOR DRAFTING:
- Do NOT repeat robotic greetings or call out client name repeatedly if chatting consecutively.
- Maximum 1 emoji or none.
- Receptive to minor revisions.
- Follow the creator's instruction faithfully without overpromising.
- Write ONLY the draft message itself so the creator can review and send it directly.`;

  const userContent = `Conversation history with client @${context.clientUsername}:

---
${historyText}
---

Creator's Instruction:
"${instruction}"
${tone ? `Desired Tone Adjustment: ${tone}` : ''}

Draft the reply message to the client according to the instruction above:`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}
