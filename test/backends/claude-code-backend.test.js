import { describe, it, expect, vi } from 'vitest';

const { AgentBackend } = await import('../../src/backends/agent-backend.js');
const { ClaudeCodeBackend } = await import('../../src/backends/claude-code-backend.js');

describe('AgentBackend', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new AgentBackend()).toThrow('abstract');
  });
});

describe('ClaudeCodeBackend', () => {
  it('injectCommand delegates to injector', async () => {
    const mockInjector = { inject: vi.fn().mockResolvedValue({ ok: true }) };
    const createInjector = vi.fn().mockReturnValue(mockInjector);

    const backend = new ClaudeCodeBackend({ createInjector });
    const session = {
      transport: { kind: 'tmux', pane_id: '%5' },
      label: 'test',
    };

    const result = await backend.injectCommand(session, 'hello');
    expect(result.ok).toBe(true);
    expect(createInjector).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ type: 'tmux' }) })
    );
    expect(mockInjector.inject).toHaveBeenCalledWith('hello');
  });

  it('falls back from nvim to tmux on failure', async () => {
    const nvimInjector = { inject: vi.fn().mockResolvedValue({ ok: false, error: 'nvim gone' }) };
    const tmuxInjector = { inject: vi.fn().mockResolvedValue({ ok: true }) };
    const createInjector = vi.fn().mockImplementation(({ session }) => {
      return session.type === 'nvim' ? nvimInjector : tmuxInjector;
    });

    const backend = new ClaudeCodeBackend({ createInjector });
    const session = {
      transport: { kind: 'nvim', nvim_socket: '/tmp/nv.sock', tmux_pane_id: '%5' },
    };

    const result = await backend.injectCommand(session, 'test');
    expect(result.ok).toBe(true);
    expect(nvimInjector.inject).toHaveBeenCalled();
    expect(tmuxInjector.inject).toHaveBeenCalled();
  });

  it('returns error when all injection methods fail', async () => {
    const failInjector = { inject: vi.fn().mockResolvedValue({ ok: false, error: 'nope' }) };
    const createInjector = vi.fn().mockReturnValue(failInjector);

    const backend = new ClaudeCodeBackend({ createInjector });
    const session = { transport: { kind: 'tmux', pane_id: '%5' } };

    const result = await backend.injectCommand(session, 'test');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
