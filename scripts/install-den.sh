#!/bin/bash
# Swap the staged /Applications/Den.app.new in for den: quits den, waits for
# it to exit, swaps the bundle (old one to the Trash), reopens. Detaches
# itself first, so it survives den quitting when run from a den terminal.
if [ "${1:-}" != "--detached" ]; then
  nohup perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' /bin/bash "$0" --detached > "$HOME/.den/install-den.log" 2>&1 < /dev/null &
  echo "Installing in the background; den quits in 3s. Log: ~/.den/install-den.log"
  exit 0
fi
set -u
[ -d /Applications/Den.app.new ] || { echo "$(date) nothing staged at /Applications/Den.app.new"; exit 1; }
sleep 3
# den quits itself when its update button runs this (DEN_INSTALL_NO_QUIT).
[ -n "${DEN_INSTALL_NO_QUIT:-}" ] || osascript -e 'tell application "Den" to quit'
for i in $(seq 1 600); do pgrep -f "/Applications/Den.app/Contents/MacOS/Den" >/dev/null || break; sleep 1; done
if pgrep -f "/Applications/Den.app/Contents/MacOS/Den" >/dev/null; then echo "$(date) den still running after 10 min; nothing swapped"; exit 1; fi
sleep 2
mv /Applications/Den.app "$HOME/.Trash/Den-replaced-$(date +%Y%m%d-%H%M%S).app" || { echo "$(date) could not move old bundle"; exit 1; }
mv /Applications/Den.app.new /Applications/Den.app || { echo "$(date) could not move new bundle"; exit 1; }
echo "$(date) swapped; reopening"
open /Applications/Den.app
