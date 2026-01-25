{ pkgs, config, ... }:
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  # Python needed for node-gyp (building native modules like better-sqlite3, node-pty)
  packages = [ pkgs.python3 ];

  # CCR startup script - injects secrets from sops-nix on devbox
  # On macOS, use `secretspec run -- <cmd>` instead (keyring provider)
  scripts.ccr-start.exec = ''
    set -euo pipefail

    # On devbox, inject secrets from /run/secrets/ (sops-nix)
    if [ -f /run/secrets/ccr_api_key ]; then
      exec env \
        CCR_API_KEY="$(< /run/secrets/ccr_api_key)" \
        TELEGRAM_BOT_TOKEN="$(< /run/secrets/telegram_bot_token)" \
        TELEGRAM_WEBHOOK_SECRET="$(< /run/secrets/telegram_webhook_secret)" \
        TELEGRAM_WEBHOOK_PATH_SECRET="$(< /run/secrets/telegram_webhook_path_secret)" \
        CCR_MACHINE_ID="devbox" \
        "$@"
    else
      echo "Error: /run/secrets/ccr_api_key not found."
      echo "On devbox: Ensure sops-nix is configured."
      echo "On macOS: Use 'secretspec run -- <command>' instead."
      exit 1
    fi
  '';

  enterShell = ''
    echo "Claude Code Remote - Node $(node --version)"
    echo ""
    echo "Start webhook server:"
    echo "  ccr-start node start-telegram-webhook.js"
    echo ""
    echo "Or with npm:"
    echo "  ccr-start npm run webhooks:log"
  '';
}
