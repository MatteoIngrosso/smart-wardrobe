#!/bin/bash
# Smart Wardrobe wall screen: opens the app full screen and keeps it open.
# Started by labwc at login (see install.sh). "wardrobe-kiosk restart" restarts the browser.
set -u

CONF="$HOME/.config/wardrobe-kiosk/kiosk.conf"
PROFILE="$HOME/.config/wardrobe-kiosk/browser"
URL="https://smart-wardrobe.matteo08-ingrosso.workers.dev"
BLANK_MINUTES=5
ROTATION=normal
NIGHTLY_RESTART_HOUR=4
# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"

if [ "${1:-}" = "restart" ]; then
  pkill -f -- "--user-data-dir=$PROFILE"
  exit 0
fi

BROWSER=$(command -v chromium || command -v chromium-browser)
if [ -z "$BROWSER" ]; then
  echo "Chromium is not installed" >&2
  exit 1
fi

# Screen direction. The first output wlr-randr lists is the touch screen.
OUTPUT=$(wlr-randr 2>/dev/null | awk '/^[^ ]/ {print $1; exit}')
if [ -n "$OUTPUT" ] && [ "$ROTATION" != "normal" ]; then
  wlr-randr --output "$OUTPUT" --transform "$ROTATION"
fi

# Screen off when nobody touches it, back on at the next touch.
if [ "${BLANK_MINUTES:-0}" -gt 0 ] && command -v swayidle >/dev/null; then
  pkill -x swayidle
  swayidle -w timeout $((BLANK_MINUTES * 60)) 'wlopm --off \*' resume 'wlopm --on \*' &
fi

# On-screen keyboard for the password and the stylist.
if command -v squeekboard >/dev/null && ! pgrep -x squeekboard >/dev/null; then
  squeekboard &
fi

# Nightly browser restart.
if [ -n "${NIGHTLY_RESTART_HOUR:-}" ]; then
  (
    while sleep 600; do
      if [ "$(date +%-H)" = "$NIGHTLY_RESTART_HOUR" ] && [ "$(date +%F)" != "${last:-}" ]; then
        last=$(date +%F)
        pkill -f -- "--user-data-dir=$PROFILE"
      fi
    done
  ) &
fi

mkdir -p "$PROFILE"
while true; do
  # Wait up to a minute for Wi-Fi so the first page isn't an error.
  for _ in $(seq 30); do
    curl -s -o /dev/null --max-time 3 "$URL" && break
    sleep 2
  done

  # A power cut must not bring up "Restore pages?".
  PREFS="$PROFILE/Default/Preferences"
  if [ -f "$PREFS" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"
  fi

  "$BROWSER" \
    --user-data-dir="$PROFILE" \
    --kiosk "$URL" \
    --ozone-platform=wayland \
    --enable-wayland-ime --wayland-text-input-version=3 \
    --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --hide-crash-restore-bubble \
    --disable-features=Translate,TouchpadOverscrollHistoryNavigation \
    --overscroll-history-navigation=0 --disable-pinch \
    --password-store=basic \
    --check-for-update-interval=31536000
  sleep 3
done
