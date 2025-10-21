import { describe, expect, it } from 'vitest';

import {
  normalizeMessageContent,
  extractLatestUserMessage,
  deterministicId,
} from './server';

describe('memory proxy helpers', () => {
  it('normalizes string and structured message content', () => {
    expect(normalizeMessageContent('hello')).toBe('hello');

    const structured = [
      { type: 'text', text: 'Part ' },
      { type: 'text', text: 'one' },
      { type: 'image_url', text: 'ignored' },
    ];

    expect(normalizeMessageContent(structured)).toBe('Part one');
  });

  it('extracts the latest user message from chat history', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first user' },
      { role: 'assistant', content: 'reply' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'second ' },
          { type: 'text', text: 'user' },
        ],
      },
    ];

    expect(extractLatestUserMessage(messages)).toBe('second user');
  });

  it('generates deterministic session identifiers', () => {
    const idA = deterministicId('user:session');
    const idB = deterministicId('user:session');
    const idC = deterministicId('user:other');

    expect(idA).toHaveLength(32);
    expect(idA).toBe(idB);
    expect(idC).not.toBe(idA);
  });
});
