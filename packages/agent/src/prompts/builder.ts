import type { ChatMessage, ChatContentPart } from '@client-agent/ai';
import type { MessageAttachment } from '@client-agent/platform';

export interface PromptMessageHistory {
  direction: 'inbound' | 'outbound';
  senderName: string;
  content: string;
  sentAt: Date | string;
  attachments?: MessageAttachment[];
}

export interface ClientMemoryItemForPrompt {
  type: 'fact' | 'preference' | 'inference' | string;
  category: string;
  content: string;
}

export interface ConversationContextForPrompt {
  clientUsername: string;
  clientDisplayName?: string;
  creatorUsername?: string;
  messages: PromptMessageHistory[];
  memories?: ClientMemoryItemForPrompt[];
}

export const SYSTEM_CREATOR_PERSONA = `You are a client communication assistant representing an art creator on VGen (@r1daz_).
The creator specializes in Live2D art cutting, layer separation, style-matching redraws, and animation for VTubers.
Your tone is authentic, calm, polite, helpful, and concise — like a skilled professional artist talking directly to a client.`;

export const SYSTEM_ANTI_SLOP_RULES = `STRICT ANTI-AI SLOP & CONVERSATION RHYTHM RULES:
1. GREETING RHYTHM: Do NOT repeat robotic greetings like "Hi [Name]!" or "Hello @client!" if the conversation is ongoing or messages were exchanged recently. Answer directly and naturally.
2. EMOJI RULE: Maximum 1 emoji per message, or none at all. Never stack or sprinkle multiple emojis.
3. REVISION POLICY: Receptive to minor revisions (e.g., small layer cuts, minor adjustments), but never promise out-of-scope work without creator confirmation.
4. FACTUALITY: Never invent facts, prices, dates, or delivery promises. Never hallucinate history.
5. LANGUAGE & VOICE: Respond in the matching natural language used in the chat (Indonesian / English). Match the creator's casual-professional style.
6. MEMORY FIDELITY: Use verified facts and known preferences to personalize your draft. If referencing an inference, phrase it gently as a question, and NEVER state an unverified inference as a confirmed fact.`;

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

function formatClientMemories(memories?: ClientMemoryItemForPrompt[]): string {
  if (!memories || memories.length === 0) {
    return '';
  }

  const facts = memories.filter((m) => m.type.toLowerCase() === 'fact');
  const preferences = memories.filter((m) => m.type.toLowerCase() === 'preference');
  const inferences = memories.filter((m) => m.type.toLowerCase() === 'inference');

  if (facts.length === 0 && preferences.length === 0 && inferences.length === 0) {
    return '';
  }

  const parts: string[] = ['CLIENT BACKGROUND & MEMORY:'];

  if (facts.length > 0) {
    parts.push('[VERIFIED FACTS]');
    for (const f of facts) {
      parts.push(`- (${f.category}): ${f.content}`);
    }
  }

  if (preferences.length > 0) {
    parts.push('[KNOWN PREFERENCES]');
    for (const p of preferences) {
      parts.push(`- (${p.category}): ${p.content}`);
    }
  }

  if (inferences.length > 0) {
    parts.push('[AI INFERENCES - NOT VERIFIED FACTS]');
    parts.push('(Caveat: Treat only as tentative context. Never assume as established fact; verify with client before relying on it!)');
    for (const inf of inferences) {
      parts.push(`- (${inf.category}): ${inf.content}`);
    }
  }

  return parts.join('\n');
}

export function buildSummaryPrompt(context: ConversationContextForPrompt): ChatMessage[] {
  const historyText = formatHistory(context.messages);
  const memoryBlock = formatClientMemories(context.memories);

  const systemContent = `${SYSTEM_CREATOR_PERSONA}

${SYSTEM_ANTI_SLOP_RULES}

Your goal is to provide an accurate, high-density summary of the conversation with client @${context.clientUsername}.`;

  const userContent = `Here is the conversation history with client @${context.clientUsername}${
    context.clientDisplayName ? ` (${context.clientDisplayName})` : ''
  }:

---
${historyText}
---
${memoryBlock ? `\n${memoryBlock}\n` : ''}
MEDIA & ATTACHMENT GUIDELINES:
- If the client attached images, character references, or files (indicated in messages or provided via attached images):
  * Under 'Key Details & Client Requests', analyze and describe the visual content of the attached media (character design, style, outfit, colors, or asset type) and how it connects to the creator's Live2D cutting/rigging services.
  * NEVER report 'no details provided' or 'unknown request' if visual references are attached. The visual content of the attached image IS key information for the commission.
  * Under 'Next Action for Creator', suggest concrete follow-ups acknowledging the visual material (e.g., clarify if client has a layered PSD for cutting or needs redraw/separation from a flat image).

Please analyze the conversation above and provide a structured summary with the following clear sections:
1. **Status / Stage**: Current status (e.g., Initial Inquiry, Price Discussion, Work in Progress, Revision Requested, Delivered/Complete).
2. **Key Details & Client Requests**: Bullet points detailing specifically what the client asked for or inquired about, including visual details of any attached images.
3. **Next Action for Creator**: The single most immediate and actionable next step for the creator.

Keep it grounded strictly in the messages above. If anything is ambiguous or uncertain, explicitly note it as unverified.`;

  // Collect image attachments for multimodal vision models
  const imageUrls: string[] = [];
  if (context.messages) {
    for (const msg of context.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (
            att.type === 'image' &&
            att.url &&
            (att.url.startsWith('http://') ||
              att.url.startsWith('https://') ||
              att.url.startsWith('data:image/'))
          ) {
            imageUrls.push(att.url);
          }
        }
      }
    }
  }

  let finalUserContent: string | ChatContentPart[] = userContent;
  if (imageUrls.length > 0) {
    const parts: ChatContentPart[] = [{ type: 'text', text: userContent }];
    for (const url of imageUrls) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
    finalUserContent = parts;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: finalUserContent },
  ];
}

export function buildReplyPrompt(
  context: ConversationContextForPrompt,
  instruction: string,
  tone?: string
): ChatMessage[] {
  const historyText = formatHistory(context.messages);
  const memoryBlock = formatClientMemories(context.memories);

  const systemContent = `${SYSTEM_CREATOR_PERSONA}

${SYSTEM_ANTI_SLOP_RULES}

IMPORTANT CONSTRAINTS FOR DRAFTING:
- Do NOT repeat robotic greetings or call out client name repeatedly if chatting consecutively.
- Maximum 1 emoji or none.
- Receptive to minor revisions.
- Follow the creator's instruction faithfully without overpromising.
- If the client shared reference images or artwork, naturally acknowledge and refer to what they shared (e.g. complimenting the character design, asking about PSD layer separation vs flat illustration).
- Use verified facts and known preferences to personalize your draft. If referencing an inference, phrase it gently as a question, and NEVER state an unverified inference as a confirmed fact.
- Write ONLY the draft message itself so the creator can review and send it directly.`;

  const userContent = `Conversation history with client @${context.clientUsername}:

---
${historyText}
---
${memoryBlock ? `\n${memoryBlock}\n` : ''}
Creator's Instruction:
"${instruction}"
${tone ? `Desired Tone Adjustment: ${tone}` : ''}

Draft the reply message to the client according to the instruction above:`;

  // Collect image attachments for multimodal vision models
  const imageUrls: string[] = [];
  if (context.messages) {
    for (const msg of context.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (
            att.type === 'image' &&
            att.url &&
            (att.url.startsWith('http://') ||
              att.url.startsWith('https://') ||
              att.url.startsWith('data:image/'))
          ) {
            imageUrls.push(att.url);
          }
        }
      }
    }
  }

  let finalUserContent: string | ChatContentPart[] = userContent;
  if (imageUrls.length > 0) {
    const parts: ChatContentPart[] = [{ type: 'text', text: userContent }];
    for (const url of imageUrls) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
    finalUserContent = parts;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: finalUserContent },
  ];
}
