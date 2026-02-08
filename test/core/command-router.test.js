import { describe, it, expect, vi, beforeEach } from 'vitest';

const { CommandRouter } = await import('../../src/core/command-router.js');

describe('CommandRouter', () => {
  let router;
  let mockProvider;
  let mockBackend;
  let mockRegistry;

  beforeEach(() => {
    mockProvider = {
      name: 'telegram',
      onCommand: vi.fn(),
      sendNotification: vi.fn().mockResolvedValue({ messageId: 42 }),
      sendCommandConfirmation: vi.fn(),
      sendError: vi.fn(),
      chunkText: vi.fn(t => [t]),
      chatId: '123',
    };
    mockBackend = {
      name: 'claude-code',
      injectCommand: vi.fn().mockResolvedValue({ ok: true, transport: 'tmux' }),
    };
    mockRegistry = {
      getSession: vi.fn().mockReturnValue({
        session_id: 'sess1',
        label: 'test',
        transport: { kind: 'tmux', pane_id: '%5' },
      }),
      mintToken: vi.fn().mockResolvedValue('token123'),
    };

    router = new CommandRouter({
      provider: mockProvider,
      backend: mockBackend,
      registry: mockRegistry,
    });
  });

  it('registers command handler on the provider', () => {
    expect(mockProvider.onCommand).toHaveBeenCalledWith(expect.any(Function));
  });

  it('handleStopEvent sends notification via provider', async () => {
    const result = await router.handleStopEvent({
      session: { session_id: 'sess1', label: 'test', cwd: '/foo/bar' },
      event: 'Stop',
      summary: 'Done!',
      label: 'test',
    });

    expect(mockRegistry.mintToken).toHaveBeenCalledWith('sess1', expect.any(String), expect.any(Object));
    expect(mockProvider.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'Stop',
        label: 'test',
        summary: 'Done!',
        token: 'token123',
      })
    );
    expect(result.token).toBe('token123');
  });

  it('routes inbound commands to backend', async () => {
    // Simulate the provider calling the command handler
    const handler = mockProvider.onCommand.mock.calls[0][0];
    await handler({
      channelId: '123',
      sessionId: 'sess1',
      command: 'continue',
    });

    expect(mockBackend.injectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess1' }),
      'continue'
    );
    expect(mockProvider.sendCommandConfirmation).toHaveBeenCalled();
  });

  it('sends error via provider when injection fails', async () => {
    mockBackend.injectCommand.mockResolvedValue({ ok: false, error: 'tmux gone' });

    const handler = mockProvider.onCommand.mock.calls[0][0];
    await handler({
      channelId: '123',
      sessionId: 'sess1',
      command: 'test',
    });

    expect(mockProvider.sendError).toHaveBeenCalledWith('123', expect.stringContaining('tmux gone'));
  });
});
