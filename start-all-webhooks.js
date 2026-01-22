#!/usr/bin/env node

/**
 * Telegram Webhook Server
 * Starts the Telegram webhook server for Claude Code Remote
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

console.log('Starting Claude Code Remote Telegram Webhook Server...\n');

// Verify Telegram is configured
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('Telegram bot token not configured.');
    console.log('Please configure TELEGRAM_BOT_TOKEN in .env file.');
    console.log('\nTip: run `npm run setup` for an interactive configuration wizard.');
    process.exit(1);
}

console.log('Starting Telegram webhook server...');
const telegramProcess = spawn('node', ['start-telegram-webhook.js'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: process.env
});

telegramProcess.on('exit', (code) => {
    console.log(`Telegram webhook server exited with code ${code}`);
    process.exit(code);
});

console.log('\nTelegram webhook server started.');
console.log('\nCommand format: /cmd TOKEN123 <command>');
console.log('\nTo stop the service, press Ctrl+C\n');

// Handle graceful shutdown
function shutdown() {
    console.log('\nShutting down webhook server...');
    telegramProcess.kill('SIGTERM');

    setTimeout(() => {
        console.log('Service stopped');
        process.exit(0);
    }, 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep the main process alive
process.stdin.resume();
