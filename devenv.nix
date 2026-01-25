{ pkgs, config, ... }:
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  # Python needed for node-gyp (building native modules like better-sqlite3, node-pty)
  packages = [ pkgs.python3 ];

  # SecretSpec is configured in devenv.yaml
  # Secrets injected via: secretspec run -- <command>

  enterShell = ''
    echo "Claude Code Remote - Node $(node --version)"
    echo "Run commands with secrets: secretspec run -- npm run webhooks:log"
  '';
}
