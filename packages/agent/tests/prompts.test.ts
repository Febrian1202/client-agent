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

  it('builds multimodal summary prompt with image_url parts when messages contain image attachments', () => {
    const historyWithImages: ConversationContextForPrompt = {
      clientUsername: 'art_buyer',
      creatorUsername: 'r1daz_',
      messages: [
        {
          direction: 'inbound',
          senderName: 'ArtBuyer',
          content: 'Hi! Here is the character model sheet for layer cutting:\n[Attached image: model_sheet.png]',
          sentAt: new Date('2026-10-17T15:00:00Z'),
          attachments: [
            {
              type: 'image',
              url: 'https://vgen.co/media/model_sheet.png',
              name: 'model_sheet.png',
            },
          ],
        },
      ],
    };

    const messages = buildSummaryPrompt(historyWithImages);
    expect(messages.length).toBe(2);
    expect(messages[1]!.role).toBe('user');
    expect(Array.isArray(messages[1]!.content)).toBeTrue();

    const parts = messages[1]!.content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('MEDIA & ATTACHMENT GUIDELINES');
    expect(parts[0].text).toContain('model_sheet.png');
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://vgen.co/media/model_sheet.png' },
    });
  });

  it('builds multimodal reply prompt with image_url parts when messages contain image attachments', () => {
    const historyWithImages: ConversationContextForPrompt = {
      clientUsername: 'art_buyer',
      creatorUsername: 'r1daz_',
      messages: [
        {
          direction: 'inbound',
          senderName: 'ArtBuyer',
          content: '[Attached image: char.png]',
          sentAt: new Date('2026-10-17T15:00:00Z'),
          attachments: [
            {
              type: 'image',
              url: 'https://vgen.co/media/char.png',
              name: 'char.png',
            },
          ],
        },
      ],
    };

    const messages = buildReplyPrompt(historyWithImages, 'Ask if they have a PSD file ready');
    expect(messages.length).toBe(2);
    expect(Array.isArray(messages[1]!.content)).toBeTrue();

    const parts = messages[1]!.content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('Ask if they have a PSD file ready');
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://vgen.co/media/char.png' },
    });
  });
});
