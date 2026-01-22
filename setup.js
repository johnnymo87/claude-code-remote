#!/usr/bin/env node

/**
 * Interactive setup for Claude Code Remote
 * - Guides user through .env generation
 * - Merges required hooks into ~/.claude/settings.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

const projectRoot = __dirname;
const envPath = path.join(projectRoot, '.env');
const hookScriptPath = path.join(projectRoot, 'claude-hook-notify.js');
const defaultSessionMap = path.join(projectRoot, 'src', 'data', 'session-map.json');
const i18nPath = path.join(projectRoot, 'setup-i18n.json');

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    underscore: '\x1b[4m',
    blink: '\x1b[5m',
    reverse: '\x1b[7m',
    hidden: '\x1b[8m',
    
    // Foreground colors
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    // Background colors
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m'
};

// Icons
const icons = {
    check: '✓',
    cross: '✗',
    info: 'ℹ',
    warning: '⚠',
    arrow: '→',
    bullet: '•',
    star: '★',
    robot: '🤖',
    telegram: '💬',
    globe: '🌐',
    key: '🔑',
    gear: '⚙️',
    rocket: '🚀'
};

// Helper functions for colored output
const color = (text, colorName) => `${colors[colorName]}${text}${colors.reset}`;
const bold = (text) => `${colors.bright}${text}${colors.reset}`;
const dim = (text) => `${colors.dim}${text}${colors.reset}`;
const success = (text) => color(`${icons.check} ${text}`, 'green');
const error = (text) => color(`${icons.cross} ${text}`, 'red');
const warning = (text) => color(`${icons.warning} ${text}`, 'yellow');
const info = (text) => color(`${icons.info} ${text}`, 'blue');

// Load i18n
const i18nData = JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
let lang = 'en';
let i18n = i18nData[lang];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function printHeader() {
    console.clear();
    console.log(bold('\n' + '='.repeat(60)));
    console.log(bold(color(`${icons.robot} Claude Code Remote - Interactive Setup ${icons.gear}`, 'cyan')));
    console.log(bold('='.repeat(60)));
    console.log();
}

function printSection(title, icon = icons.bullet) {
    console.log('\n' + bold(color(`${icon} ${title}`, 'cyan')));
    console.log(color('─'.repeat(40), 'gray'));
}

function ask(question, defaultValue = '') {
    const suffix = defaultValue ? dim(` (${defaultValue})`) : '';
    return new Promise(resolve => {
        rl.question(`${color(icons.arrow, 'green')} ${question}${suffix}: `, answer => {
            resolve(answer.trim() || defaultValue);
        });
    });
}

function askSelect(question, options, defaultIndex = 0) {
    return new Promise(resolve => {
        console.log(`\n${bold(question)}`);
        options.forEach((opt, idx) => {
            const num = dim(`[${idx + 1}]`);
            const isDefault = idx === defaultIndex;
            const label = isDefault ? bold(opt.label) : opt.label;
            console.log(`  ${num} ${label}`);
        });
        rl.question(`\n${color(icons.arrow, 'green')} Select (1-${options.length}) ${dim(`[${defaultIndex + 1}]`)}: `, answer => {
            const num = parseInt(answer.trim() || (defaultIndex + 1));
            if (num >= 1 && num <= options.length) {
                resolve(options[num - 1]);
            } else {
                resolve(options[defaultIndex]);
            }
        });
    });
}

function askYesNo(question, defaultValue = false) {
    const suffix = defaultValue ? color(' [Y/n]', 'green') : color(' [y/N]', 'red');
    return new Promise(resolve => {
        rl.question(`${color(icons.arrow, 'green')} ${question}${suffix} `, answer => {
            const normalized = answer.trim().toLowerCase();
            if (!normalized) return resolve(defaultValue);
            resolve(normalized === 'y' || normalized === 'yes');
        });
    });
}

function loadExistingEnv() {
    if (!fs.existsSync(envPath)) return {};
    try {
        const content = fs.readFileSync(envPath, 'utf8');
        return dotenv.parse(content);
    } catch (error) {
        console.warn(warning('Failed to parse existing .env, starting fresh:') + ' ' + error.message);
        return {};
    }
}

function serializeEnvValue(value) {
    if (value === undefined || value === null) return '';
    const stringValue = String(value);
    if (stringValue === '') return '';
    if (/[^\w@%/:.\-]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '\\"')}"`;
    }
    return stringValue;
}

function writeEnvFile(values, existingEnv) {
    const orderedKeys = [
        'TELEGRAM_ENABLED', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_GROUP_ID',
        'TELEGRAM_WHITELIST', 'WEBHOOK_DOMAIN', 'TELEGRAM_WEBHOOK_PORT',
        'TELEGRAM_FORCE_IPV4',
        'SESSION_MAP_PATH', 'INJECTION_MODE', 'CLAUDE_CLI_PATH', 'LOG_LEVEL'
    ];

    // Merge: new values override existing, keep any extra keys user already had
    const merged = { ...existingEnv, ...values };
    const lines = [];

    lines.push('# Claude Code Remote configuration');
    lines.push(`# Generated by setup.js on ${new Date().toISOString()}`);
    lines.push('');

    orderedKeys.forEach(key => {
        if (merged[key] === undefined) return;
        lines.push(`${key}=${serializeEnvValue(merged[key])}`);
    });

    const extras = Object.keys(merged).filter(k => !orderedKeys.includes(k));
    if (extras.length > 0) {
        lines.push('');
        lines.push('# User-defined / preserved keys');
        extras.forEach(key => {
            lines.push(`${key}=${serializeEnvValue(merged[key])}`);
        });
    }

    fs.writeFileSync(envPath, lines.join('\n') + '\n');
    return envPath;
}

function makeHookCommand(event) {
    const script = hookScriptPath.includes(' ') ? `"${hookScriptPath}"` : hookScriptPath;
    return `node ${script} ${event}`;
}

function ensureHooksFile() {
    const settingsDir = path.join(os.homedir(), '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');
    let settings = {};
    let existing = false;
    let backupPath = null;

    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }

    if (fs.existsSync(settingsPath)) {
        existing = true;
        try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (error) {
            backupPath = `${settingsPath}.bak-${Date.now()}`;
            fs.copyFileSync(settingsPath, backupPath);
            console.warn(warning(`Existing ~/.claude/settings.json is invalid JSON, backed up to ${backupPath}`));
            settings = {};
        }
    }

    settings.hooks = settings.hooks || {};

    const stopHooks = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
    const subagentHooks = Array.isArray(settings.hooks.SubagentStop) ? settings.hooks.SubagentStop : [];

    const completedCommand = makeHookCommand('completed');
    const waitingCommand = makeHookCommand('waiting');

    function upsertHook(list, command) {
        const exists = list.some(entry =>
            Array.isArray(entry.hooks) && entry.hooks.some(h => h.command === command)
        );
        if (!exists) {
            list.push({
                matcher: '*',
                hooks: [{ type: 'command', command, timeout: 5 }]
            });
        }
        return list;
    }

    settings.hooks.Stop = upsertHook(stopHooks, completedCommand);
    settings.hooks.SubagentStop = upsertHook(subagentHooks, waitingCommand);

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    return { settingsPath, existing, backupPath };
}

async function main() {
    printHeader();
    
    // Language selection first
    const langChoice = await askSelect(bold(`${icons.globe} ${i18nData.en.selectLanguage}`), [
        { label: 'English', value: 'en' },
        { label: '中文', value: 'zh' }
    ], 0);
    lang = langChoice.value;
    i18n = i18nData[lang];

    printHeader();
    console.log(dim(`${i18n.projectRoot}: ${projectRoot}`));
    console.log(dim(`${i18n.targetEnv}: ${envPath}`));

    const existingEnv = loadExistingEnv();

    // Basic Configuration
    printSection(lang === 'en' ? 'Basic Configuration' : '基本配置', icons.gear);

    const sessionMapPath = await ask(i18n.sessionMapPath, existingEnv.SESSION_MAP_PATH || defaultSessionMap);
    let injectionMode = (await ask(i18n.injectionMode, existingEnv.INJECTION_MODE || 'pty')).toLowerCase();
    if (!['tmux', 'pty'].includes(injectionMode)) {
        console.log(warning(i18n.injectionModeInvalid));
        injectionMode = 'pty';
    }
    const logLevel = await ask(i18n.logLevel, existingEnv.LOG_LEVEL || 'info');

    // Telegram Configuration
    printSection('Telegram Configuration', icons.telegram);
    const telegram = {};
    telegram.botToken = await ask(i18n.telegramConfig.botToken, existingEnv.TELEGRAM_BOT_TOKEN || '');
    telegram.chatId = await ask(i18n.telegramConfig.chatId, existingEnv.TELEGRAM_CHAT_ID || '');
    telegram.groupId = await ask(i18n.telegramConfig.groupId, existingEnv.TELEGRAM_GROUP_ID || '');
    telegram.whitelist = await ask(i18n.telegramConfig.whitelist, existingEnv.TELEGRAM_WHITELIST || '');
    telegram.webhookDomain = await ask('Webhook domain (without https://)', existingEnv.WEBHOOK_DOMAIN || '');
    telegram.webhookPort = await ask(i18n.telegramConfig.webhookPort, existingEnv.TELEGRAM_WEBHOOK_PORT || '4731');
    telegram.forceIPv4 = await askYesNo(i18n.telegramConfig.forceIPv4, existingEnv.TELEGRAM_FORCE_IPV4 === 'true');

    const envValues = {
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: telegram.botToken,
        TELEGRAM_CHAT_ID: telegram.chatId,
        TELEGRAM_GROUP_ID: telegram.groupId,
        TELEGRAM_WHITELIST: telegram.whitelist,
        WEBHOOK_DOMAIN: telegram.webhookDomain,
        TELEGRAM_WEBHOOK_PORT: telegram.webhookPort,
        TELEGRAM_FORCE_IPV4: telegram.forceIPv4 ? 'true' : 'false',
        SESSION_MAP_PATH: sessionMapPath,
        INJECTION_MODE: injectionMode,
        LOG_LEVEL: logLevel
    };

    printSection(lang === 'en' ? 'Saving Configuration' : '保存配置', icons.star);
    const savedEnvPath = writeEnvFile(envValues, existingEnv);
    console.log('\n' + success(`${i18n.envSaved} ${savedEnvPath}`));

    const updateHooks = await askYesNo(i18n.updateHooks, true);
    if (updateHooks) {
        const { settingsPath, existing, backupPath } = ensureHooksFile();
        if (backupPath) {
            console.log(warning(`${i18n.invalidSettings} ${backupPath}`));
        }
        console.log(success(`${existing ? i18n.hooksUpdated : i18n.hooksCreated} ${settingsPath}`));
        console.log(dim(`   Stop → ${makeHookCommand('completed')}`));
        console.log(dim(`   SubagentStop → ${makeHookCommand('waiting')}`));
    } else {
        console.log(warning(i18n.hooksSkipped));
    }

    rl.close();
    
    console.log('\n' + bold(color('─'.repeat(60), 'gray')));
    console.log(bold(color(`${icons.rocket} ${i18n.setupComplete}`, 'green')));
    console.log(color('─'.repeat(60), 'gray'));
    console.log(`  ${icons.bullet} ${i18n.nextStep1}`);
    console.log(`  ${icons.bullet} ${i18n.nextStep2}`);
    console.log();
}

main().catch(err => {
    console.error(error(`${i18n?.setupFailed || 'Setup failed:'} ${err.message}`));
    rl.close();
    process.exit(1);
});