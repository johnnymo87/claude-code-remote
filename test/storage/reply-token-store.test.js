import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { ReplyTokenStore } = await import('../../src/storage/reply-token-store.js');

describe('ReplyTokenStore', () => {
  let store;
  let dbPath;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `reply-tokens-test-${Date.now()}.db`);
    store = new ReplyTokenStore({ dbPath, ttlMs: 5000 });
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('stores and retrieves a token by channelId + replyKey', () => {
    store.store('chan123', 'msg456', 'tokenXYZ');
    expect(store.lookup('chan123', 'msg456')).toBe('tokenXYZ');
  });

  it('returns null for non-existent mapping', () => {
    expect(store.lookup('chan123', 'missing')).toBeNull();
  });

  it('deletes a mapping', () => {
    store.store('chan123', 'msg456', 'tokenXYZ');
    store.delete('chan123', 'msg456');
    expect(store.lookup('chan123', 'msg456')).toBeNull();
  });

  it('returns null for expired tokens', async () => {
    const shortStore = new ReplyTokenStore({ dbPath: dbPath + '.ttl', ttlMs: 50 });
    shortStore.store('chan123', 'msg456', 'tokenXYZ');
    await new Promise(r => setTimeout(r, 100));
    expect(shortStore.lookup('chan123', 'msg456')).toBeNull();
    shortStore.close();
    try { fs.unlinkSync(dbPath + '.ttl'); } catch {}
  });
});
