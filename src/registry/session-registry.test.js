/**
 * Session Registry Tests
 *
 * Tests for mutex-protected concurrent access to the registry.
 */

const fs = require('fs');
const path = require('path');
const SessionRegistry = require('./session-registry');

const TEST_DATA_DIR = path.join(__dirname, '../../test-data-' + process.pid);

// Quiet logger for tests
const quietLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    log: () => {},
};

describe('SessionRegistry', () => {
    let registry;

    beforeEach(() => {
        // Clean up test directory
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
        registry = new SessionRegistry({
            dataDir: TEST_DATA_DIR,
            logger: quietLogger,
        });
    });

    afterEach(() => {
        // Clean up test directory
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true });
        }
    });

    describe('basic operations', () => {
        test('upsertSession creates a session', async () => {
            const session = await registry.upsertSession({
                session_id: 'test-session-1',
                ppid: 1234,
                cwd: '/test/path',
            });

            expect(session.session_id).toBe('test-session-1');
            expect(session.ppid).toBe(1234);
            expect(session.cwd).toBe('/test/path');
            expect(session.notify).toBe(false);
            expect(session.state).toBe('running');
        });

        test('getSession retrieves a session', async () => {
            await registry.upsertSession({
                session_id: 'test-session-2',
                ppid: 5678,
            });

            const session = registry.getSession('test-session-2');
            expect(session).not.toBeNull();
            expect(session.ppid).toBe(5678);
        });

        test('enableNotify updates session', async () => {
            await registry.upsertSession({
                session_id: 'test-session-3',
            });

            const session = await registry.enableNotify('test-session-3', 'My Label');
            expect(session.notify).toBe(true);
            expect(session.label).toBe('My Label');
        });

        test('deleteSession removes session', async () => {
            await registry.upsertSession({
                session_id: 'test-session-4',
            });

            await registry.deleteSession('test-session-4');

            const session = registry.getSession('test-session-4');
            expect(session).toBeNull();
        });
    });

    describe('token operations', () => {
        test('mintToken creates a token', async () => {
            const token = await registry.mintToken('session-1', 'chat-123', {
                context: { event: 'Stop' },
            });

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.length).toBeGreaterThan(10);
        });

        test('validateToken validates a token', async () => {
            const token = await registry.mintToken('session-1', 'chat-123');

            const result = await registry.validateToken(token, 'chat-123');
            expect(result.valid).toBe(true);
            expect(result.session_id).toBe('session-1');
        });

        test('validateToken rejects wrong chat_id', async () => {
            const token = await registry.mintToken('session-1', 'chat-123');

            const result = await registry.validateToken(token, 'chat-999');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Chat ID mismatch');
        });

        test('revokeToken removes a token', async () => {
            const token = await registry.mintToken('session-1', 'chat-123');

            await registry.revokeToken(token);

            const result = await registry.validateToken(token, 'chat-123');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Token not found');
        });
    });

    describe('concurrent access (mutex)', () => {
        test('concurrent upsertSession calls do not lose data', async () => {
            // Create many sessions concurrently
            const NUM_SESSIONS = 50;
            const promises = [];

            for (let i = 0; i < NUM_SESSIONS; i++) {
                promises.push(
                    registry.upsertSession({
                        session_id: `concurrent-session-${i}`,
                        ppid: 1000 + i,
                        label: `Session ${i}`,
                    })
                );
            }

            await Promise.all(promises);

            // Verify all sessions were created
            const sessions = registry.listSessions();
            expect(sessions.length).toBe(NUM_SESSIONS);

            // Verify each session has correct data
            for (let i = 0; i < NUM_SESSIONS; i++) {
                const session = registry.getSession(`concurrent-session-${i}`);
                expect(session).not.toBeNull();
                expect(session.ppid).toBe(1000 + i);
                expect(session.label).toBe(`Session ${i}`);
            }
        });

        test('concurrent updates to same session preserve last write', async () => {
            // Create initial session
            await registry.upsertSession({
                session_id: 'race-test-session',
                label: 'initial',
            });

            // Launch many concurrent updates
            const NUM_UPDATES = 20;
            const promises = [];

            for (let i = 0; i < NUM_UPDATES; i++) {
                promises.push(
                    registry.upsertSession({
                        session_id: 'race-test-session',
                        label: `update-${i}`,
                    })
                );
            }

            await Promise.all(promises);

            // Session should exist and have one of the update labels
            const session = registry.getSession('race-test-session');
            expect(session).not.toBeNull();
            expect(session.label).toMatch(/^update-\d+$/);
        });

        test('concurrent token minting creates unique tokens', async () => {
            const NUM_TOKENS = 30;
            const promises = [];

            for (let i = 0; i < NUM_TOKENS; i++) {
                promises.push(
                    registry.mintToken(`session-${i % 5}`, 'chat-123', {
                        context: { index: i },
                    })
                );
            }

            const tokens = await Promise.all(promises);

            // All tokens should be unique
            const uniqueTokens = new Set(tokens);
            expect(uniqueTokens.size).toBe(NUM_TOKENS);
        });

        test('mixed concurrent operations maintain consistency', async () => {
            // Create some initial sessions
            for (let i = 0; i < 5; i++) {
                await registry.upsertSession({
                    session_id: `mixed-session-${i}`,
                    notify: false,
                });
            }

            // Launch mixed concurrent operations
            const promises = [];

            // Enable notify on some
            for (let i = 0; i < 3; i++) {
                promises.push(
                    registry.enableNotify(`mixed-session-${i}`, `Label ${i}`)
                );
            }

            // Touch some
            for (let i = 0; i < 5; i++) {
                promises.push(registry.touchSession(`mixed-session-${i}`));
            }

            // Create new sessions
            for (let i = 5; i < 10; i++) {
                promises.push(
                    registry.upsertSession({
                        session_id: `mixed-session-${i}`,
                    })
                );
            }

            // Mint some tokens
            for (let i = 0; i < 5; i++) {
                promises.push(
                    registry.mintToken(`mixed-session-${i}`, 'chat-123')
                );
            }

            await Promise.all(promises);

            // Verify final state
            const sessions = registry.listSessions();
            expect(sessions.length).toBe(10);

            // First 3 should have notify enabled
            for (let i = 0; i < 3; i++) {
                const session = registry.getSession(`mixed-session-${i}`);
                expect(session.notify).toBe(true);
            }
        });
    });
});
