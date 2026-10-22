import { describe, expect, it } from 'bun:test';
import {
  buildReplyPrompt,
  buildSummaryPrompt,
  type ConversationContextForPrompt,
  type ClientMemoryItemForPrompt,
} from '../src/prompts/builder';

describe('Agent Context Builder Memory Injection', () => {
  const sampleMemories: ClientMemoryItemForPrompt[] = [
    {
      type: 'fact',
      category: 'technical',
      content: 'Uses VTube Studio on iOS tracking',
    },
    {
      type: 'preference',
      category: 'scope',
      content: 'Prefers milestone review for head XYZ before body physics',
    },
    {
      type: 'inference',
      category: 'general',
      content: 'May be planning a debut next month',
    },
  ];

  const baseContext: ConversationContextForPrompt = {
    clientUsername: 'ErianOsamu',
    clientDisplayName: 'Erian',
    creatorUsername: 'r1daz_',
    messages: [
      {
        direction: 'inbound',
        senderName: 'Erian',
        content: 'Hi! Could you check my model file?',
        sentAt: new Date(),
      },
    ],
    memories: sampleMemories,
  };

  it('injects formatted memory block into reply prompt with strict inference caveat', () => {
    const prompt = buildReplyPrompt(baseContext, 'Confirm we will review the head first');
    const userMessage = prompt.find((m) => m.role === 'user')?.content ?? '';
    const systemMessage = prompt.find((m) => m.role === 'system')?.content ?? '';

    expect(userMessage).toContain('CLIENT BACKGROUND & MEMORY:');
    expect(userMessage).toContain('[VERIFIED FACTS]');
    expect(userMessage).toContain('Uses VTube Studio on iOS tracking');

    expect(userMessage).toContain('[KNOWN PREFERENCES]');
    expect(userMessage).toContain('Prefers milestone review for head XYZ before body physics');

    expect(userMessage).toContain('[AI INFERENCES - NOT VERIFIED FACTS]');
    expect(userMessage).toContain('May be planning a debut next month');
    expect(userMessage).toContain('Never assume as established fact');

    expect(systemMessage).toContain('Use verified facts and known preferences to personalize your draft');
    expect(systemMessage).toContain('NEVER state an unverified inference as a confirmed fact');
  });

  it('renders gracefully when memories are empty', () => {
    const prompt = buildReplyPrompt({ ...baseContext, memories: [] }, 'Test reply');
    const userMessage = prompt.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).not.toContain('[VERIFIED FACTS]');
  });
});
