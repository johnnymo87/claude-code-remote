import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TelegramProvider } = await import('../../src/providers/telegram-provider.js');

describe('TelegramProvider', () => {
  let provider;
  let mockHttp;

  beforeEach(() => {
    mockHttp = {
      post: vi.fn().mockResolvedValue({
        data: { ok: true, result: { message_id: 42 } },
      }),
      get: vi.fn().mockResolvedValue({
        data: { ok: true, result: { username: 'test_bot' } },
      }),
    };

    provider = new TelegramProvider({
      botToken: 'fake-token',
      chatId: '123',
      _http: mockHttp,
    });
  });

  it('has name "telegram"', () => {
    expect(provider.name).toBe('telegram');
  });

  it('declares correct capabilities', () => {
    const caps = provider.capabilities;
    expect(caps.supportsEditing).toBe(true);
    expect(caps.supportsButtons).toBe(true);
    expect(caps.maxMessageLength).toBe(4096);
  });

  it('sendNotification formats Stop event with buttons', async () => {
    const result = await provider.sendNotification({
      event: 'Stop',
      sessionId: 'abc123',
      label: 'my-project',
      summary: 'Task completed successfully',
      cwd: '/home/dev/projects/foo',
      token: 'testtoken123',
      buttons: [
        { text: '▶️ Continue', action: 'continue' },
        { text: '✅ Yes', action: 'y' },
      ],
    });

    expect(result.messageId).toBe(42);
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining('/sendMessage'),
      expect.objectContaining({
        chat_id: '123',
        text: expect.stringContaining('my-project'),
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      }),
      expect.any(Object)
    );
  });

  it('chunkText uses 4096 limit', () => {
    const longText = 'a'.repeat(5000);
    const chunks = provider.chunkText(longText);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBeLessThanOrEqual(4096);
  });
});
