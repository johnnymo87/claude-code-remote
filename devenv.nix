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
    # Load 1Password service account token based on platform
    if [ -f /run/secrets/op_service_account_token ]; then
      # Devbox (NixOS): read from sops-nix
      export OP_SERVICE_ACCOUNT_TOKEN="$(< /run/secrets/op_service_account_token)"
      export CCR_MACHINE_ID="devbox"
    elif command -v security &>/dev/null; then
      # macOS: optionally read from Keychain (or use desktop app auth)
      _token=$(security find-generic-password -s "op-service-account" -a "OP_SERVICE_ACCOUNT_TOKEN" -w 2>/dev/null || true)
      if [ -n "$_token" ]; then
        export OP_SERVICE_ACCOUNT_TOKEN="$_token"
        export CCR_MACHINE_ID="''${CCR_MACHINE_ID:-macbook}"
      fi
      unset _token
    fi

    echo "Claude Code Remote - Node $(node --version)"
    if [ -n "$OP_SERVICE_ACCOUNT_TOKEN" ]; then
      echo "1Password service account configured (''${CCR_MACHINE_ID})"
    elif command -v security &>/dev/null; then
      echo "1Password: using desktop app auth (run 'op signin' if needed)"
      export CCR_MACHINE_ID="''${CCR_MACHINE_ID:-macbook}"
    else
      echo "1Password: not configured"
    fi
    echo ""
    echo "Start webhook server:"
    echo "  op run --account my.1password.com --env-file=.env.1password -- npm run webhooks:log"
  '';
}
