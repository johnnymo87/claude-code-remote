#!/usr/bin/env node

/**
 * Telegram Webhook Server
 * Starts the Telegram webhook server for receiving messages
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const Logger = require('./src/core/logger');
const TelegramWebhookHandler = require('./src/channels/telegram/webhook');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const logger = new Logger('Telegram-Webhook-Server');

// Load configuration
const config = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    groupId: process.env.TELEGRAM_GROUP_ID,
    whitelist: process.env.TELEGRAM_WHITELIST ? process.env.TELEGRAM_WHITELIST.split(',').map(id => id.trim()) : [],
    port: process.env.TELEGRAM_WEBHOOK_PORT || 4731,
    webhookUrl: process.env.NGROK_DOMAIN ? `https://${process.env.NGROK_DOMAIN}` : undefined,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    webhookPathSecret: process.env.TELEGRAM_WEBHOOK_PATH_SECRET,
    dropPendingUpdates: process.env.TELEGRAM_DROP_PENDING_UPDATES === 'true'
};

// Validate configuration
if (!config.botToken) {
    logger.error('TELEGRAM_BOT_TOKEN must be set in .env file');
    process.exit(1);
}

if (!config.chatId && !config.groupId) {
    logger.error('Either TELEGRAM_CHAT_ID or TELEGRAM_GROUP_ID must be set in .env file');
    process.exit(1);
}

if (!config.webhookSecret) {
    logger.warn('TELEGRAM_WEBHOOK_SECRET not set. Webhook endpoint is vulnerable to forged requests.');
    logger.warn('Generate a secret with: openssl rand -hex 32');
}

// Create and start webhook handler
const webhookHandler = new TelegramWebhookHandler(config);

async function start() {
    logger.info('Starting Telegram webhook server...');
    logger.info(`Configuration:`);
    logger.info(`- Port: ${config.port}`);
    logger.info(`- Chat ID: ${config.chatId || 'Not set'}`);
    logger.info(`- Group ID: ${config.groupId || 'Not set'}`);
    logger.info(`- Whitelist: ${config.whitelist.length > 0 ? config.whitelist.join(', ') : 'None (using configured IDs)'}`);
    logger.info(`- Webhook Secret: ${config.webhookSecret ? 'Configured' : 'NOT SET (insecure)'}`);
    logger.info(`- Webhook Path Secret: ${config.webhookPathSecret ? 'Configured' : 'Not set (using default path)'}`);
    logger.info(`- Drop Pending Updates: ${config.dropPendingUpdates ? 'Yes' : 'No'}`);

    // Set webhook if URL is provided
    if (config.webhookUrl) {
        try {
            const webhookEndpoint = `${config.webhookUrl}${webhookHandler.getWebhookPath()}`;
            logger.info(`Checking webhook: ${webhookEndpoint}`);
            const result = await webhookHandler.setWebhook(webhookEndpoint);
            if (result.skipped) {
                logger.info('Webhook already configured, no update needed');
            } else {
                logger.info('Webhook registered successfully');
            }
        } catch (error) {
            logger.error('Failed to set webhook:', error.message);
            logger.info('You can manually set the webhook using:');
            const secretParam = config.webhookSecret ? ` -d "secret_token=${config.webhookSecret}"` : '';
            logger.info(`curl -X POST https://api.telegram.org/bot${config.botToken}/setWebhook -d "url=${config.webhookUrl}/webhook/telegram"${secretParam}`);
        }
    } else {
        logger.warn('NGROK_DOMAIN not set. Please set the webhook manually.');
        logger.info('To set webhook manually, use:');
        logger.info(`curl -X POST https://api.telegram.org/bot${config.botToken}/setWebhook -d "url=https://your-domain.com/webhook/telegram" -d "secret_token=YOUR_SECRET"`);
    }
    
    webhookHandler.start(config.port);

    // Start periodic cleanup of dead sessions (every 60 seconds)
    // This validates PID + start_time to catch sessions where the process has exited
    const CLEANUP_INTERVAL_MS = 60 * 1000;
    setInterval(async () => {
        try {
            const count = await webhookHandler.registry.cleanupDeadSessions();
            if (count > 0) {
                logger.info(`Periodic cleanup: removed ${count} dead sessions`);
            }
        } catch (error) {
            logger.error(`Periodic cleanup failed: ${error.message}`);
        }
    }, CLEANUP_INTERVAL_MS);
    logger.info(`Dead session cleanup scheduled every ${CLEANUP_INTERVAL_MS / 1000}s`);
}

start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down Telegram webhook server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Shutting down Telegram webhook server...');
    process.exit(0);
});