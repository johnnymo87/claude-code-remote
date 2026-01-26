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
      # macOS: read from Keychain
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
      echo ""
      echo "Start webhook server:"
      echo "  op run --env-file=.env.1password -- npm run webhooks:log"
    else
      echo ""
      echo "1Password not configured. To set up:"
      echo "  # macOS: Store token in Keychain"
      echo "  security add-generic-password -s 'op-service-account' -a 'OP_SERVICE_ACCOUNT_TOKEN' -w '<token>' -U"
      echo ""
      echo "  # Then start webhook server:"
      echo "  op run --env-file=.env.1password -- npm run webhooks:log"
    fi
  '';
}
