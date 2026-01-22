/**
 * Claude-Code-Remote Configuration Manager
 * Interactive configuration tool for managing settings
 */

const readline = require('readline');
const Logger = require('../core/logger');

class ConfigurationManager {
    constructor(configManager) {
        this.config = configManager;
        this.logger = new Logger('ConfigManager');
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Enable keypress events
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        readline.emitKeypressEvents(process.stdin, this.rl);
    }

    async run(args = []) {
        if (args.includes('--help') || args.includes('-h')) {
            this.showHelp();
            this.rl.close();
            return;
        }

        if (args.includes('--show')) {
            this.displayCurrentConfig();
            this.rl.close();
            return;
        }

        await this.showMainMenu();
    }

    async question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    displayCurrentConfig() {
        console.log('\nCurrent configuration:');
        console.log('├─ Language:', this.config.get('language'));
        console.log('├─ Enabled status:', this.config.get('enabled') ? 'Enabled' : 'Disabled');
        console.log('└─ Timeout:', this.config.get('timeout') + ' seconds');
        console.log();
    }

    async showMainMenu() {
        while (true) {
            console.log('\n=== Claude-Code-Remote Configuration Manager ===');
            this.displayCurrentConfig();
            console.log('Options:');
            console.log('1. Basic Settings');
            console.log('2. Notification Channels');
            console.log('3. Command Relay');
            console.log('4. Test Notifications');
            console.log('5. Save and Exit');
            console.log('6. Exit (without saving)');

            const choice = await this.question('\nPlease select (1-6): ');

            switch (choice) {
                case '1':
                    await this.configureBasicSettings();
                    break;
                case '2':
                    await this.configureChannels();
                    break;
                case '3':
                    await this.configureRelay();
                    break;
                case '4':
                    await this.testNotifications();
                    break;
                case '5':
                    if (this.config.save()) {
                        console.log('✅ Configuration saved');
                        this.rl.close();
                        return;
                    } else {
                        console.log('❌ Save failed');
                    }
                    break;
                case '6':
                    console.log('Exit (changes not saved)');
                    this.rl.close();
                    return;
                default:
                    console.log('❌ Invalid selection');
            }
        }
    }

    async configureBasicSettings() {
        console.log('\n=== Basic Settings ===');
        console.log('1. Configure Language');
        console.log('2. Toggle Enabled Status');
        console.log('3. Configure Timeout');
        console.log('4. Custom Messages');
        console.log('0. Return to Main Menu');

        const choice = await this.question('\n Please select (0-4): ');

        switch (choice) {
            case '1':
                await this.configureLanguage();
                break;
            case '2':
                await this.toggleEnabled();
                break;
            case '3':
                await this.configureTimeout();
                break;
            case '4':
                await this.configureCustomMessages();
                break;
            case '0':
                return;
            default:
                console.log('❌ Invalid selection');
        }
    }

    async configureLanguage() {
        const languages = ['zh-CN', 'en', 'ja'];
        console.log('\nAvailable languages:');
        languages.forEach((lang, index) => {
            console.log(`${index + 1}. ${lang}`);
        });

        const choice = await this.question(`Select language (1-${languages.length}): `);
        const index = parseInt(choice) - 1;

        if (index >= 0 && index < languages.length) {
            this.config.set('language', languages[index]);
            console.log(`✅ Language set to: ${languages[index]}`);
        } else {
            console.log('❌ Invalid selection');
        }
    }

    async toggleEnabled() {
        const current = this.config.get('enabled', true);
        this.config.set('enabled', !current);
        console.log(`✅ Notifications ${!current ? 'enabled' : 'disabled'}`);
    }

    async configureTimeout() {
        const timeout = await this.question('Set timeout (seconds): ');
        const timeoutNum = parseInt(timeout);
        if (timeoutNum > 0 && timeoutNum <= 30) {
            this.config.set('timeout', timeoutNum);
            console.log(`✅ Timeout set to: ${timeoutNum} seconds`);
        } else {
            console.log('❌ Invalid timeout (1-30 seconds)');
        }
    }

    async configureChannels() {
        console.log('\n=== Notification Channel Configuration ===');
        console.log('1. Telegram Notifications');
        console.log('0. Return to Main Menu');

        const choice = await this.question('\nPlease select channel to configure (0-1): ');

        switch (choice) {
            case '1':
                await this.configureTelegramChannel();
                break;
            case '0':
                return;
            default:
                console.log('❌ Invalid selection');
        }

        if (choice !== '0') {
            await this.question('\nPress Enter to continue...');
        }
    }

    async configureTelegramChannel() {
        console.log('\n=== Telegram Notification Configuration ===');

        const currentConfig = this.config.getChannel('telegram') || { enabled: false, config: {} };
        const telegramConfig = currentConfig.config || {};

        console.log(`Current status: ${currentConfig.enabled ? '✅ Enabled' : '❌ Disabled'}`);

        // Bot token configuration
        const currentToken = telegramConfig.botToken || '';
        console.log(`Current bot token: ${currentToken ? '[Configured]' : 'Not configured'}`);
        const botToken = await this.question('Bot token (from @BotFather): ');

        // Chat ID configuration
        const currentChatId = telegramConfig.chatId || '';
        console.log(`Current chat ID: ${currentChatId || 'Not configured'}`);
        const chatId = await this.question('Chat ID: ');

        // Build telegram configuration
        const newTelegramConfig = {
            enabled: true,
            config: {
                botToken: botToken || currentToken,
                chatId: chatId || currentChatId
            }
        };

        // Save configuration
        this.config.setChannel('telegram', newTelegramConfig);
        console.log('\n✅ Telegram configuration saved');
    }

    async configureRelay() {
        console.log('\n=== Command Relay Configuration ===');
        console.log('(This feature will be implemented in future versions)');
        console.log('Will support sending commands via notification channels and auto-executing in Claude Code');
        
        await this.question('\nPress Enter to continue...');
    }

    async configureCustomMessages() {
        console.log('\n=== Custom Message Configuration ===');
        console.log('Tip: Use {project} as project name placeholder');
        console.log('Example: [{project}] Task completed!\n');

        // Configure completed message
        const currentCompleted = this.config.get('customMessages.completed') || 'Use default text';
        console.log(`Current task completion text: ${currentCompleted}`);
        const completedMsg = await this.question('New task completion text (Enter to skip): ');
        if (completedMsg.trim()) {
            this.config.set('customMessages.completed', completedMsg.trim());
            console.log('✅ Updated task completion text');
        }

        // Configure waiting message
        const currentWaiting = this.config.get('customMessages.waiting') || 'Use default text';
        console.log(`\nCurrent waiting input text: ${currentWaiting}`);
        const waitingMsg = await this.question('New waiting input text (Enter to skip): ');
        if (waitingMsg.trim()) {
            this.config.set('customMessages.waiting', waitingMsg.trim());
            console.log('✅ Updated waiting input text');
        }
    }

    async testNotifications() {
        console.log('\n=== Test Notifications ===');
        
        try {
            const Notifier = require('../core/notifier');
            const notifier = new Notifier(this.config);
            await notifier.initializeChannels();
            
            console.log('Sending task completion notification...');
            await notifier.notify('completed', { test: true });
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('Sending waiting input notification...');
            await notifier.notify('waiting', { test: true });
            
            console.log('✅ Test completed');
        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
        
        await this.question('\nPress Enter to continue...');
    }

    showHelp() {
        console.log(`
Claude-Code-Remote Configuration Manager

Usage: claude-remote config [options]

Options:
  --show    Show current configuration
  --help    Show help information

Interactive Commands:
  1. Basic Settings    - Language, enabled status, timeout, etc.
  2. Notification Channels    - Configure Telegram notifications
  3. Command Relay    - Configure remote command execution features
  4. Test Notifications    - Test all configured notification channels
        `);
    }
}

module.exports = ConfigurationManager;