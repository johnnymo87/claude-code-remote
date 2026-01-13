# Claude Code Remote

Control [Claude Code](https://claude.ai/code) remotely via Telegram, Email, LINE, or Desktop notifications.

| | |
|---|---|
| **Platforms** | Telegram, Email (SMTP/IMAP), LINE, Desktop |
| **Node.js** | 22 (via devenv) |
| **License** | MIT |

## Documentation

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Quick start, commands, skills reference |

## Quick Start

```bash
# Clone and install
git clone https://github.com/JessyTsui/Claude-Code-Remote.git
cd Claude-Code-Remote
direnv allow  # activates devenv (Node.js 22)
npm install

# Interactive setup
npm run setup

# Start services
npm run webhooks
```

## How It Works

1. Claude completes a task → hook triggers notification
2. You receive alert on Telegram/Email/LINE/Desktop
3. Reply with new command → injected into Claude session

## Demo

<div align="center">
  <a href="https://youtu.be/_yrNlDYOJhw">
    <img src="./assets/CCRemote_demo.png" alt="Claude Code Remote Demo" width="100%">
  </a>
</div>

## Contributing

- 🐛 [GitHub Issues](https://github.com/JessyTsui/Claude-Code-Remote/issues)
- 🐦 [@Jiaxi_Cui](https://x.com/Jiaxi_Cui)

## License

MIT
