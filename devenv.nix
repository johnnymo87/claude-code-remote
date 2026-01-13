{ pkgs, ... }:
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  # Python needed for node-gyp (building native modules like better-sqlite3, node-pty)
  packages = [ pkgs.python3 ];

  dotenv.enable = true;

  enterShell = ''
    echo "Claude Code Remote - Node $(node --version)"
  '';
}
