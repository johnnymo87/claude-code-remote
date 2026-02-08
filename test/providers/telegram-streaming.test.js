import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TelegramProvider } = await import('../../src/providers/telegram-provider.js');

describe('TelegramProvider draft streaming', () => {
  let provider;
  let mockHttp;

  beforeEach(() => {
    mockHttp = {
      post: vi.fn().mockResolvedValue({
        data: { ok: true, result: { message_id: 99 } },
      }),
    };

    provider = new TelegramProvider({ botToken: 'fake', chatId: '123', _http: mockHttp });
  });

  it('sendDraft sends initial message and returns messageId', async () => {
    const result = await provider.sendDraft('123', 'First chunk...');
    expect(result.messageId).toBe(99);
  });

  it('updateDraft edits existing message', async () => {
    await provider.updateDraft('123', 99, 'Updated text');
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining('/editMessageText'),
      expect.objectContaining({
        chat_id: '123',
        message_id: 99,
        text: 'Updated text',
      }),
      expect.any(Object)
    );
  });
});
