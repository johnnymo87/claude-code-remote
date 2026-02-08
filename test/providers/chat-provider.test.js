import { describe, it, expect, vi } from 'vitest';

// We'll use dynamic import since the codebase is CJS
const { ChatProvider } = await import('../../src/providers/chat-provider.js');

describe('ChatProvider', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new ChatProvider({})).toThrow('ChatProvider is abstract');
  });

  it('requires subclass to implement name getter', () => {
    class BadProvider extends ChatProvider {}
    const p = new BadProvider({});
    expect(() => p.name).toThrow('must implement');
  });

  it('requires subclass to implement sendNotification', async () => {
    class BadProvider extends ChatProvider {}
    const p = new BadProvider({});
    await expect(p.sendNotification({})).rejects.toThrow('must implement');
  });

  it('requires subclass to implement start', async () => {
    class BadProvider extends ChatProvider {}
    const p = new BadProvider({});
    await expect(p.start()).rejects.toThrow('must implement');
  });

  it('provides default capabilities', () => {
    class TestProvider extends ChatProvider {
      get name() { return 'test'; }
      async sendNotification() {}
      async handleInbound() {}
      async start() {}
      async stop() {}
    }
    const p = new TestProvider({});
    expect(p.capabilities).toEqual({
      supportsEditing: false,
      supportsButtons: false,
      supportsThreading: false,
      supportsStreaming: false,
      maxMessageLength: 4096,
    });
  });

  it('chunkText splits at newlines within limit', () => {
    class TestProvider extends ChatProvider {
      get name() { return 'test'; }
      get capabilities() { return { ...super.capabilities, maxMessageLength: 20 }; }
      async sendNotification() {}
      async handleInbound() {}
      async start() {}
      async stop() {}
    }
    const p = new TestProvider({});
    const chunks = p.chunkText('line one\nline two\nline three\nline four');
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(20));
  });
});
