{ pkgs, ... }:
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  dotenv.enable = true;

  enterShell = ''
    echo "Claude Code Remote - Node $(node --version)"
  '';
}
