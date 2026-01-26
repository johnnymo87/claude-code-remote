{ pkgs, config, ... }:
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  # Python needed for node-gyp (building native modules like better-sqlite3, node-pty)
  # 1Password CLI for secrets injection
  packages = [
    pkgs.python3
    pkgs._1password-cli
  ];

  enterShell = ''
    # On devbox, export 1Password service account token from sops-nix
    if [ -f /run/secrets/op_service_account_token ]; then
      export OP_SERVICE_ACCOUNT_TOKEN="$(< /run/secrets/op_service_account_token)"
      export CCR_MACHINE_ID="devbox"
      echo "Claude Code Remote - Node $(node --version)"
      echo "1Password service account configured"
      echo ""
      echo "Start webhook server:"
      echo "  op run --env-file=.env.1password -- npm run webhooks:log"
    else
      echo "Claude Code Remote - Node $(node --version)"
      echo ""
      echo "Start webhook server (requires 1Password):"
      echo "  op run --env-file=.env.1password -- npm run webhooks:log"
    fi
  '';
}
