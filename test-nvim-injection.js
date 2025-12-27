#!/usr/bin/env node

/**
 * Integration test for neovim RPC injection
 *
 * Prerequisites:
 *   1. Start neovim with: nvim --listen /tmp/nvim-claude.sock
 *   2. Open a terminal buffer: :terminal
 *   3. Register the instance: :CCRegister test-instance
 *
 * This script tests the end-to-end flow:
 *   - Creating an nvim injector via the registry
 *   - Sending a test command
 *   - Capturing output
 */

const { createInjector, getRegisteredTypes } = require('./src/relay/injector-registry');

const SOCKET_PATH = process.env.NVIM_SOCKET || '/tmp/nvim-claude.sock';
const INSTANCE_NAME = process.argv[2] || 'test-instance';

const logger = {
    debug: (...args) => console.log('[DEBUG]', ...args),
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
};

async function main() {
    console.log('=== Neovim RPC Injection Test ===\n');
    console.log(`Socket path: ${SOCKET_PATH}`);
    console.log(`Instance name: ${INSTANCE_NAME}`);
    console.log(`Registered types: ${getRegisteredTypes().join(', ')}\n`);

    // Check if socket exists
    const fs = require('fs');
    if (!fs.existsSync(SOCKET_PATH)) {
        console.error(`ERROR: Socket not found at ${SOCKET_PATH}`);
        console.log('\nTo fix:');
        console.log('  1. Start neovim with: nvim --listen /tmp/nvim-claude.sock');
        console.log('  2. Open a terminal: :terminal');
        console.log('  3. Register instance: :CCRegister test-instance');
        process.exit(1);
    }

    console.log('Socket exists, creating injector...\n');

    // Create injector
    const injector = createInjector({
        logger,
        session: {
            type: 'nvim',
            socketPath: SOCKET_PATH,
            instanceName: INSTANCE_NAME,
        },
    });

    // Test 1: List instances
    console.log('--- Test 1: List instances ---');
    try {
        const listResult = await injector.listInstances();
        console.log('Result:', JSON.stringify(listResult, null, 2));

        if (!listResult.ok) {
            console.error('List failed:', listResult.error);
        } else if (listResult.instances.length === 0) {
            console.warn('No instances registered. Run :CCRegister <name> in neovim first.');
        } else {
            console.log(`Found ${listResult.instances.length} instance(s)`);
        }
    } catch (err) {
        console.error('List error:', err.message);
    }
    console.log();

    // Test 2: Capture output
    console.log('--- Test 2: Capture output ---');
    try {
        const captureResult = await injector.capture({ lines: 10 });
        console.log('Result:', JSON.stringify({
            ok: captureResult.ok,
            error: captureResult.error,
            outputLength: captureResult.output?.length,
            outputPreview: captureResult.output?.slice(0, 100),
        }, null, 2));
    } catch (err) {
        console.error('Capture error:', err.message);
    }
    console.log();

    // Test 3: Send a harmless echo command
    console.log('--- Test 3: Send command ---');
    const testCommand = 'echo "Hello from Claude-Code-Remote test at $(date)"';
    console.log(`Sending: ${testCommand}`);
    try {
        const injectResult = await injector.inject(testCommand);
        console.log('Result:', JSON.stringify(injectResult, null, 2));

        if (injectResult.ok) {
            console.log('SUCCESS: Command sent!');
            console.log('Check the neovim terminal buffer for the output.');
        }
    } catch (err) {
        console.error('Inject error:', err.message);
    }
    console.log();

    console.log('=== Test Complete ===');
}

main().catch(console.error);
