{
  description = "Europa.vim";

  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        # To import an internal flake module: ./other.nix
        # To import an external flake module:
        #   1. Add foo to inputs
        #   2. Add foo as a parameter to the outputs function
        #   3. Add here: foo.flakeModule

        inputs.git-hooks.flakeModule
      ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      perSystem =
        {
          config,
          self',
          inputs',
          pkgs,
          system,
          ...
        }:
        {
          # Per-system attributes can be defined here. The self' and inputs'
          # module parameters provide easy access to attributes of the same
          # system.

          pre-commit.settings.hooks = {
            # Nix formatter
            nixfmt.enable = true;

            # General hygiene
            typos.enable = true;
            end-of-file-fixer.enable = true;

            deno-check = {
              enable = true;
              name = "deno task check";
              entry = "${pkgs.deno}/bin/deno task check";
              files = "\\.(ts|js|tsx|jsx|json|jsonc)$";
              pass_filenames = false;
            };
          };

          # Equivalent to  inputs'.nixpkgs.legacyPackages.hello;
          devShells.default = pkgs.mkShell {
            inputsFrom = [ config.pre-commit.devShell ];
            packages = with pkgs; [
              deno # runtime + fmt + lint + test + runs npm:typedoc
              pandoc # required by panvimdoc (final stage: md -> vimdoc)
              nodejs # for npm: packages with native deps

              typos
              librsvg # provides rsvg-convert (Phase 3.6)

              # Added in Phase 1 (when implementing Sixel image rendering)
              # imagemagick     # used for PNG -> Sixel conversion
            ];
          };

        };
      flake = {
        # The usual flake attributes can be defined here, including system-
        # agnostic ones like nixosModule and system-enumerating ones, although
        # those are more easily expressed in perSystem.
      };
    };
}
