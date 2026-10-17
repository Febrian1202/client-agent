import { describe, expect, it } from 'bun:test';
import {
  buildSummaryPrompt,
  buildReplyPrompt,
  type ConversationContextForPrompt,
  SYSTEM_ANTI_SLOP_RULES,
  SYSTEM_CREATOR_PERSONA,
} from '../src/prompts/builder';

describe('Prompt Architecture & Anti-Slop Builder', () => {
  const sampleHistory: ConversationContextForPrompt = {
    clientUsername: 'erianosamu',
    clientDisplayName: 'Erian Osamu',
    creatorUsername: 'r1daz_',
    messages: [
      {
        direction: 'inbound',
        senderName: 'ErianOsamu',
        content: 'Halo kak, untuk choker dan badannya apa sudah selesai dipisah layernya?',
        sentAt: new Date('2026-10-17T14:00:00Z'),
      },
      {
        direction: 'outbound',
        senderName: 'r1daz_',
        content: 'Halo! Sedang aku kerjakan ya, sebentar lagi selesai.',
        sentAt: new Date('2026-10-17T14:05:00Z'),
      },
      {
        direction: 'inbound',
        senderName: 'ErianOsamu',
        content: 'Oke sip kak, ditunggu ya!',
        sentAt: new Date('2026-10-17T14:06:00Z'),
      },
    ],
  };

  it('includes anti-slop rules and persona in system prompt', () => {
    expect(SYSTEM_CREATOR_PERSONA).toContain('Live2D');
    expect(SYSTEM_ANTI_SLOP_RULES).toContain('emoji');
    expect(SYSTEM_ANTI_SLOP_RULES).toContain('greeting');
  });

  it('builds summary prompt containing conversation history and structured schema requirements', () => {
    const messages = buildSummaryPrompt(sampleHistory);

    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(SYSTEM_CREATOR_PERSONA);
    expect(messages[0]!.content).toContain(SYSTEM_ANTI_SLOP_RULES);

    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('erianosamu');
    expect(messages[1]!.content).toContain('Halo kak, untuk choker dan badannya');
    expect(messages[1]!.content).toContain('Status / Stage');
    expect(messages[1]!.content).toContain('Key Details');
    expect(messages[1]!.content).toContain('Next Action');
  });

  it('builds reply prompt including creator instruction, history, and anti-slop constraints', () => {
    const instruction = 'Katakan revisi choker dan badannya sudah beres dan file di Drive sudah diupdate';
    const messages = buildReplyPrompt(sampleHistory, instruction);

    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Do NOT repeat robotic greetings');
    expect(messages[0]!.content).toContain('Maximum 1 emoji or none');
    expect(messages[0]!.content).toContain('Receptive to minor revisions');

    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain(instruction);
    expect(messages[1]!.content).toContain('erianosamu');
    expect(messages[1]!.content).toContain('Oke sip kak, ditunggu ya!');
  });

  it('handles empty message history gracefully', () => {
    const emptyHistory: ConversationContextForPrompt = {
      clientUsername: 'new_client',
      creatorUsername: 'r1daz_',
      messages: [],
    };

    const messages = buildSummaryPrompt(emptyHistory);
    expect(messages[1]!.content).toContain('No prior message history found');
  });
});
