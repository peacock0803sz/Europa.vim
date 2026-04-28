#!/usr/bin/env bash
# Phase 0 Sixel spike: convert a PNG to Sixel escapes and write them to /dev/tty
# so the result renders in the active terminal session.
#
# Usage: scripts/spike-sixel.sh [PNG_PATH]
#   Defaults to tests/fixtures/sample.png when no argument is given.
#
# Requires ImageMagick. The flake.nix devShell does not yet pull imagemagick in
# by default (see the commented-out entry there); install it locally or run
# this spike from a shell that has `magick` available. CI never runs this
# script: Sixel verification is a one-off manual confirmation by a team member
# with access to a Sixel-capable terminal (WezTerm, foot, mlterm, ...).

set -euo pipefail

PNG_PATH="${1:-tests/fixtures/sample.png}"

if [[ ! -f "$PNG_PATH" ]]; then
  echo "spike-sixel: input not found: $PNG_PATH" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  CONVERTER="magick"
elif command -v convert >/dev/null 2>&1; then
  CONVERTER="convert"
else
  echo "spike-sixel: ImageMagick (magick or convert) is required" >&2
  exit 2
fi

# tmux without sixel support intercepts Sixel escapes and either drops them or
# prints a "SIXEL IMAGE (WxH)" placeholder. Most stock tmux builds (Homebrew,
# nixpkgs default) ship without --enable-sixel, so the spike must run from a
# raw terminal session. Warn and continue rather than exiting so the operator
# can still inspect the output if they know what they are doing.
if [[ -n "${TMUX:-}" ]]; then
  echo "spike-sixel: detected TMUX session; sixel escapes likely will not render." >&2
  echo "spike-sixel: open a new terminal window without tmux and rerun, or rebuild tmux with --enable-sixel." >&2
fi

# Stream Sixel directly to the terminal device so the calling shell renders it.
# A non-Sixel terminal silently ignores the escape sequence; the spike does not
# crash the session.
"$CONVERTER" "$PNG_PATH" sixel:- > /dev/tty
