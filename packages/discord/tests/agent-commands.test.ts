import { describe, expect, it } from 'bun:test';
import {
  SUMMARIZE_COMMAND,
  formatSummaryMessage,
  REPLY_COMMAND,
  formatReplyDraftMessage,
} from '../src/index';

describe('Discord Agent Commands', () => {
  it('defines valid SUMMARIZE_COMMAND specification', () => {
    expect(SUMMARIZE_COMMAND.name).toBe('summarize');
    expect(SUMMARIZE_COMMAND.options.length).toBe(1);
    expect(SUMMARIZE_COMMAND.options[0]!.name).toBe('username');
  });

  it('defines valid REPLY_COMMAND specification', () => {
    expect(REPLY_COMMAND.name).toBe('reply');
    expect(REPLY_COMMAND.options.length).toBe(2);
    expect(REPLY_COMMAND.options[0]!.name).toBe('username');
    expect(REPLY_COMMAND.options[1]!.name).toBe('instruction');
  });

  it('formats summary message cleanly with header and client tag', () => {
    const summary = '1. Status: WIP\n2. Key Details: Choker revision requested\n3. Next Action: Update Google Drive';
    const formatted = formatSummaryMessage('erianosamu', summary);

    expect(formatted).toContain('📋 **Conversation Summary · @erianosamu**');
    expect(formatted).toContain('Choker revision requested');
    expect(formatted).toContain('Update Google Drive');
  });

  it('formats reply draft message cleanly emphasizing draft status', () => {
    const draft = 'Halo! Revisi choker dan badannya sudah beres ya, file di Google Drive sudah ku-update.';
    const formatted = formatReplyDraftMessage('erianosamu', draft);

    expect(formatted).toContain('✍️ **Draft Reply for @erianosamu**');
    expect(formatted).toContain('Draft only — human approval required');
    expect(formatted).toContain(draft);
  });
});
