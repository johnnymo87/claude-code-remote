#!/usr/bin/env node

/**
 * Claude-Code-Remote - Claude Code Smart Notification System
 * Main entry point for the CLI tool
 */

// Load environment variables from Claude-Code-Remote directory
const path = require('path');
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });

const Logger = require('./src/core/logger');
const Notifier = require('./src/core/notifier');
const ConfigManager = require('./src/core/config');

class ClaudeCodeRemoteCLI {
    constructor() {
        this.logger = new Logger('CLI');
        this.config = new ConfigManager();
        this.notifier = new Notifier(this.config);
    }

    async init() {
        // Load configuration
        this.config.load();
        
        // Initialize channels
        await this.notifier.initializeChannels();
    }

    async run() {
        const args = process.argv.slice(2);
        const command = args[0];

        try {
            await this.init();

            switch (command) {
                case 'notify':
                    await this.handleNotify(args.slice(1));
                    break;
                case 'test':
                    await this.handleTest(args.slice(1));
                    break;
                case 'status':
                    await this.handleStatus(args.slice(1));
                    break;
                case 'config':
                    await this.handleConfig(args.slice(1));
                    break;
                case 'install':
                    await this.handleInstall(args.slice(1));
                    break;
                case 'edit-config':
                    await this.handleEditConfig(args.slice(1));
                    break;
                case '--help':
                case '-h':
                case undefined:
                    this.showHelp();
                    break;
                default:
                    console.error(`Unknown command: ${command}`);
                    this.showHelp();
                    process.exit(1);
            }
        } catch (error) {
            this.logger.error('CLI error:', error.message);
            process.exit(1);
        }
    }

    async handleNotify(args) {
        const typeIndex = args.findIndex(arg => arg === '--type');
        
        if (typeIndex === -1 || typeIndex + 1 >= args.length) {
            console.error('Usage: claude-remote notify --type <completed|waiting>');
            process.exit(1);
        }

        const type = args[typeIndex + 1];
        
        if (!['completed', 'waiting'].includes(type)) {
            console.error('Invalid type. Use: completed or waiting');
            process.exit(1);
        }

        // Automatically capture current tmux session conversation content
        const metadata = await this.captureCurrentConversation();

        // Handle subagent notifications
        if (type === 'waiting') {
            const Config = require('./src/core/config');
            const config = new Config();
            config.load();
            const enableSubagentNotifications = config.get('enableSubagentNotifications', false);
            
            if (!enableSubagentNotifications) {
                // Instead of skipping, track the subagent activity
                const SubagentTracker = require('./src/utils/subagent-tracker');
                const tracker = new SubagentTracker();
                
                // Use tmux session as the tracking key
                const trackingKey = metadata.tmuxSession || 'default';
                
                // Capture more detailed information about the subagent activity
                const activityDetails = {
                    userQuestion: metadata.userQuestion || 'No question captured',
                    claudeResponse: metadata.claudeResponse || 'No response captured',
                    timestamp: new Date().toISOString(),
                    tmuxSession: metadata.tmuxSession
                };

                // Don't truncate the response too aggressively
                if (activityDetails.claudeResponse && activityDetails.claudeResponse.length > 1000) {
                    activityDetails.claudeResponse = activityDetails.claudeResponse.substring(0, 1000) + '...[see full output in tmux]';
                }

                tracker.addActivity(trackingKey, {
                    type: 'SubagentStop',
                    description: metadata.userQuestion || 'Subagent task',
                    details: activityDetails
                });
                
                this.logger.info(`Subagent activity tracked for tmux session: ${trackingKey}`);
                process.exit(0);
            }
        }
        
        // For completed notifications, include subagent activities and execution trace
        if (type === 'completed') {
            const Config = require('./src/core/config');
            const config = new Config();
            config.load();
            const showSubagentActivitiesInEmail = config.get('showSubagentActivitiesInEmail', false);
            
            if (showSubagentActivitiesInEmail) {
                const SubagentTracker = require('./src/utils/subagent-tracker');
                const tracker = new SubagentTracker();
                const trackingKey = metadata.tmuxSession || 'default';
                
                // Get and format subagent activities
                const subagentSummary = tracker.formatActivitiesForEmail(trackingKey);
                if (subagentSummary) {
                    metadata.subagentActivities = subagentSummary;
                }
                
                // Clear activities after including them in the notification
                tracker.clearActivities(trackingKey);
            } else {
                // Always clear activities even if not showing them
                const SubagentTracker = require('./src/utils/subagent-tracker');
                const tracker = new SubagentTracker();
                const trackingKey = metadata.tmuxSession || 'default';
                tracker.clearActivities(trackingKey);
            }
        }
        
        const result = await this.notifier.notify(type, metadata);
        
        if (result.success) {
            this.logger.info(`${type} notification sent successfully`);
            process.exit(0);
        } else {
            this.logger.error(`Failed to send ${type} notification`);
            process.exit(1);
        }
    }

    async captureCurrentConversation() {
        try {
            const { execSync } = require('child_process');
            const TmuxMonitor = require('./src/utils/tmux-monitor');
            
            // Get current tmux session name
            let currentSession = null;
            try {
                currentSession = execSync('tmux display-message -p "#S"', { 
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim();
            } catch (e) {
                // Not running in tmux, return empty metadata
                return {};
            }
            
            if (!currentSession) {
                return {};
            }
            
            // Use TmuxMonitor to capture conversation
            const tmuxMonitor = new TmuxMonitor();
            const conversation = tmuxMonitor.getRecentConversation(currentSession);
            const fullTrace = tmuxMonitor.getFullExecutionTrace(currentSession);
            
            return {
                userQuestion: conversation.userQuestion,
                claudeResponse: conversation.claudeResponse,
                tmuxSession: currentSession,
                fullExecutionTrace: fullTrace
            };
        } catch (error) {
            this.logger.debug('Failed to capture conversation:', error.message);
            return {};
        }
    }

    async handleTest(args) {
        console.log('Testing notification channels...\n');
        
        const results = await this.notifier.test();
        
        for (const [channel, result] of Object.entries(results)) {
            const status = result.success ? '✅ PASS' : '❌ FAIL';
            console.log(`${channel}: ${status}`);
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
        }
        
        const passCount = Object.values(results).filter(r => r.success).length;
        const totalCount = Object.keys(results).length;
        
        console.log(`\nTest completed: ${passCount}/${totalCount} channels passed`);
        
        if (passCount === 0) {
            process.exit(1);
        }
    }

    async handleStatus(args) {
        const status = this.notifier.getStatus();
        
        console.log('Claude-Code-Remote Status\n');
        console.log('Configuration:');
        console.log(`  Enabled: ${status.enabled ? 'Yes' : 'No'}`);
        console.log(`  Language: ${status.config.language}`);
        console.log(`  Sounds: ${status.config.sound.completed} / ${status.config.sound.waiting}`);
        
        console.log('\nChannels:');
        
        // Display all available channels, including disabled ones
        const allChannels = this.config._channels || {};
        const activeChannels = status.channels || {};
        
        // Merge all channel information
        const channelNames = new Set([
            ...Object.keys(allChannels),
            ...Object.keys(activeChannels)
        ]);
        
        for (const name of channelNames) {
            const channelConfig = allChannels[name] || {};
            const channelStatus = activeChannels[name];
            
            let enabled, configured, relay;
            
            if (channelStatus) {
                // Active channel, use actual status
                enabled = channelStatus.enabled ? '✅' : '❌';
                configured = channelStatus.configured ? '✅' : '❌';
                relay = channelStatus.supportsRelay ? '✅' : '❌';
            } else {
                // Inactive channel, use configuration status
                enabled = channelConfig.enabled ? '✅' : '❌';
                configured = this._isChannelConfigured(name, channelConfig) ? '✅' : '❌';
                relay = this._supportsRelay(name) ? '✅' : '❌';
            }
            
            console.log(`  ${name}:`);
            console.log(`    Enabled: ${enabled}`);
            console.log(`    Configured: ${configured}`);
            console.log(`    Supports Relay: ${relay}`);
        }
    }

    _isChannelConfigured(name, config) {
        switch (name) {
            case 'desktop':
                return true; // Desktop notifications don't need special configuration
            case 'telegram':
                return config.config &&
                       config.config.botToken &&
                       config.config.chatId;
            default:
                return false;
        }
    }

    _supportsRelay(name) {
        // Telegram supports relay via webhook
        return name === 'telegram';
    }

    async handleConfig(args) {
        // Launch the configuration tool
        const ConfigTool = require('./src/tools/config-manager');
        const configTool = new ConfigTool(this.config);
        await configTool.run(args);
    }

    async handleInstall(args) {
        // Launch the installer
        const Installer = require('./src/tools/installer');
        const installer = new Installer(this.config);
        await installer.run(args);
    }


    async handleEditConfig(args) {
        const { spawn } = require('child_process');
        const path = require('path');
        
        const configType = args[0];
        
        if (!configType) {
            console.log('Available configuration files:');
            console.log('  user      - User personal configuration (config/user.json)');
            console.log('  channels  - Notification channel configuration (config/channels.json)');
            console.log('  default   - Default configuration template (config/default.json)');
            console.log('');
            console.log('Usage: claude-remote edit-config <configuration-type>');
            console.log('Example: claude-remote edit-config channels');
            return;
        }

        const configFiles = {
            'user': path.join(__dirname, 'config/user.json'),
            'channels': path.join(__dirname, 'config/channels.json'),
            'default': path.join(__dirname, 'config/default.json')
        };

        const configFile = configFiles[configType];
        if (!configFile) {
            console.error('❌ Invalid configuration type:', configType);
            console.log('Available types: user, channels, default');
            return;
        }

        // Check if file exists
        const fs = require('fs');
        if (!fs.existsSync(configFile)) {
            console.error('❌ Configuration file does not exist:', configFile);
            return;
        }

        console.log(`📝 Opening configuration file: ${configFile}`);
        console.log('💡 Save and close the editor after editing to take effect');
        console.log('');

        // Determine the editor to use
        const editor = process.env.EDITOR || process.env.VISUAL || this._getDefaultEditor();
        
        try {
            const editorProcess = spawn(editor, [configFile], {
                stdio: 'inherit'
            });

            editorProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Configuration file saved');
                    console.log('💡 Run "claude-remote status" to view updated configuration');
                } else {
                    console.log('❌ Editor exited abnormally');
                }
            });

            editorProcess.on('error', (error) => {
                console.error('❌ Unable to start editor:', error.message);
                console.log('');
                console.log('💡 You can manually edit the configuration file:');
                console.log(`   ${configFile}`);
            });

        } catch (error) {
            console.error('❌ Failed to start editor:', error.message);
            console.log('');
            console.log('💡 You can manually edit the configuration file:');
            console.log(`   ${configFile}`);
        }
    }

    _getDefaultEditor() {
        // Determine default editor based on platform
        if (process.platform === 'win32') {
            return 'notepad';
        } else if (process.platform === 'darwin') {
            return 'nano'; // Use nano on macOS as most users have it
        } else {
            return 'nano'; // Linux default to nano
        }
    }


    showHelp() {
        console.log(`
Claude-Code-Remote - Claude Code Telegram Notification System

Usage: claude-remote <command> [options]

Commands:
  notify --type <type>    Send a notification (completed|waiting)
  test                    Test notification channels
  status                  Show system status
  config                  Launch configuration manager
  edit-config <type>      Edit configuration files directly
  install                 Install and configure Claude Code hooks

Options:
  -h, --help             Show this help message

Examples:
  claude-remote notify --type completed
  claude-remote test
  claude-remote edit-config channels
  claude-remote config
  claude-remote install

For more information, visit: https://github.com/Claude-Code-Remote/Claude-Code-Remote
        `);
    }
}

// Run CLI if this file is executed directly
if (require.main === module) {
    const cli = new ClaudeCodeRemoteCLI();
    cli.run().catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = ClaudeCodeRemoteCLI;