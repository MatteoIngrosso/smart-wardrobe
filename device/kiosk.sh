#!/bin/bash
# Smart Wardrobe wall screen: opens the app full screen and keeps it open.
# Started at login by the desktop (see install.sh). Works on Wayland (Raspberry Pi OS, labwc)
# and on X11 (most mini-PC desktops).
#   wardrobe-kiosk           start the kiosk (only one runs at a time)
#   wardrobe-kiosk restart   close the browser; the running kiosk opens it again
# Its own messages go to ~/.config/wardrobe-kiosk/kiosk.log, the browser's to browser.log.
set -euo pipefail

CONF_DIR="$HOME/.config/wardrobe-kiosk"
CONF="$CONF_DIR/kiosk.conf"
URL="https://smart-wardrobe.matteo08-ingrosso.workers.dev"
BLANK_MINUTES=30
ROTATION=normal
NIGHTLY_RESTART_HOUR=4
GPU_BOOST=1
EXTRA_FLAGS=""
# shellcheck source=/dev/null
if [ -f "$CONF" ]; then . "$CONF"; fi

# A typo in kiosk.conf must not stop the screen: fall back to safe values.
case "$BLANK_MINUTES" in '' | *[!0-9]*) BLANK_MINUTES=0 ;; esac
case "$NIGHTLY_RESTART_HOUR" in '' | *[!0-9]*) NIGHTLY_RESTART_HOUR="" ;; esac
case "$ROTATION" in normal | 90 | 180 | 270) ;; *) ROTATION=normal ;; esac

BROWSER=$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || command -v google-chrome || true)
if [ -z "$BROWSER" ]; then
  echo "Chromium is not installed (run install.sh)" >&2
  exit 1
fi

# Ubuntu's Chromium is a snap, which can't write to hidden folders in the home folder.
PROFILE="$CONF_DIR/browser"
if [[ "$(readlink -f "$BROWSER")" == */snap* ]] || grep -qsI /snap/ "$BROWSER"; then
  PROFILE="$HOME/snap/chromium/common/wardrobe-kiosk"
fi

if [ "${1:-}" = "restart" ]; then
  pkill -f -- "--user-data-dir=$PROFILE" || true
  exit 0
fi

mkdir -p "$CONF_DIR" "$PROFILE"

# Only one kiosk at a time, even if the desktop starts it twice.
if command -v flock >/dev/null; then
  exec 9>"$CONF_DIR/kiosk.lock"
  if ! flock -n 9; then
    echo "The kiosk is already running" >&2
    exit 0
  fi
fi

# Keep the log small: one old copy, about 256 KB each.
LOG="$CONF_DIR/kiosk.log"
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 262144 ]; then mv -f "$LOG" "$LOG.1"; fi
exec >>"$LOG" 2>&1
say() { echo "$(date '+%F %T') $*"; }

# Leave nothing behind when the session ends or the kiosk is stopped.
cleanup() { jobs -p | xargs -r kill 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 0' TERM INT HUP

if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  SESSION=wayland
elif [ -n "${DISPLAY:-}" ]; then
  SESSION=x11
else
  say "No desktop session (no WAYLAND_DISPLAY or DISPLAY): start the kiosk from the desktop's autostart"
  exit 1
fi
say "Starting on $SESSION, $(uname -m), $("$BROWSER" --version 2>/dev/null || echo "$BROWSER")"

# Screen direction, then screen off when nobody touches it and back on at the next touch.
if [ "$SESSION" = wayland ]; then
  # The first output wlr-randr lists is the touch screen.
  OUTPUT=$(wlr-randr 2>/dev/null | awk '/^[^ ]/ {print $1; exit}' || true)
  if [ -n "$OUTPUT" ] && [ "$ROTATION" != normal ]; then
    wlr-randr --output "$OUTPUT" --transform "$ROTATION" || say "Could not rotate $OUTPUT"
  fi
  if [ "$BLANK_MINUTES" -gt 0 ] && command -v swayidle >/dev/null; then
    pkill -x swayidle || true
    swayidle -w timeout $((BLANK_MINUTES * 60)) 'wlopm --off \*' resume 'wlopm --on \*' 9>&- &
  fi
  # On-screen keyboard for the password and the stylist.
  if command -v squeekboard >/dev/null && ! pgrep -x squeekboard >/dev/null; then
    squeekboard 9>&- &
  fi
else
  # X11 blanks the screen by itself after 10 minutes: turn that off, then switch the screen
  # off (not blank it) after BLANK_MINUTES, like on Wayland. A touch wakes it.
  if command -v xset >/dev/null; then
    xset s off -dpms || true
    xset s noblank || true
    if [ "$BLANK_MINUTES" -gt 0 ]; then
      xset +dpms dpms 0 0 $((BLANK_MINUTES * 60)) || true
    fi
  else
    say "xset is missing (package x11-xserver-utils): the desktop may blank the screen"
  fi
  if [ "$ROTATION" != normal ] && command -v xrandr >/dev/null; then
    OUTPUT=$(xrandr --query 2>/dev/null | awk '/ connected/ {print $1; exit}' || true)
    case "$ROTATION" in 90) TURN=left ;; 180) TURN=inverted ;; *) TURN=right ;; esac
    if [ -n "$OUTPUT" ] && xrandr --output "$OUTPUT" --rotate "$TURN"; then
      # Turn the touch input with the picture.
      if command -v xinput >/dev/null; then
        xinput list --name-only 2>/dev/null | grep -i touch | while read -r dev; do
          xinput map-to-output "$dev" "$OUTPUT" 2>/dev/null || true
        done || true
      fi
    else
      say "Could not rotate the screen"
    fi
  fi
fi

# GNOME (Ubuntu) locks the screen when it turns off; a wall screen has nobody to type the password.
if [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && command -v gsettings >/dev/null; then
  gsettings set org.gnome.desktop.screensaver lock-enabled false || true
  gsettings set org.gnome.desktop.session idle-delay $((BLANK_MINUTES * 60)) || true
fi

# Nightly browser restart.
if [ -n "$NIGHTLY_RESTART_HOUR" ]; then
  (
    trap 'kill "${nap:-}" 2>/dev/null; exit 0' TERM
    last=""
    while true; do
      sleep 600 &
      nap=$!
      wait "$nap" || true
      if [ "$(date +%-H)" = "$NIGHTLY_RESTART_HOUR" ] && [ "$(date +%F)" != "$last" ]; then
        last=$(date +%F)
        say "Nightly browser restart"
        pkill -f -- "--user-data-dir=$PROFILE" || true
      fi
    done
  ) 9>&- &
fi

# The app learns it runs on the wall screen: its ambient screen is on by default, and the
# diagnostics (tap a page title 5 times) say so.
case "$URL" in *\?*) OPEN_URL="$URL&kiosk=1" ;; *) OPEN_URL="$URL?kiosk=1" ;; esac

# shellcheck disable=SC2054 # the commas belong to --disable-features
FLAGS=(
  --user-data-dir="$PROFILE"
  --kiosk "$OPEN_URL"
  --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check
  --disable-session-crashed-bubble --hide-crash-restore-bubble
  # No pinch zoom, no swipe back, no translate bar or casting prompts.
  --disable-pinch --overscroll-history-navigation=0
  --disable-features=Translate,OptimizationHints,MediaRouter,TouchpadOverscrollHistoryNavigation
  --password-store=basic
  # Never show "Chromium is out of date" on the wall.
  --check-for-update-interval=31536000
  "--simulate-outdated-no-au=Tue, 31 Dec 2099 23:59:59 GMT"
)
if [ "$SESSION" = wayland ]; then
  FLAGS+=(--ozone-platform=wayland --enable-wayland-ime --wayland-text-input-version=3)
else
  FLAGS+=(--ozone-platform=x11)
fi
# The 3D mirror at 60 FPS: draw with the graphics chip even where Chromium plays it safe.
if [ "$GPU_BOOST" = 1 ]; then
  FLAGS+=(--ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy
    --enable-webgl --enable-accelerated-2d-canvas)
fi
if [ -n "$EXTRA_FLAGS" ]; then
  read -r -a MORE <<<"$EXTRA_FLAGS"
  FLAGS+=("${MORE[@]}")
fi

while true; do
  # Wait up to a minute for Wi-Fi so the first page isn't an error.
  for _ in $(seq 30); do
    curl -s -o /dev/null --max-time 3 "$URL" && break
    sleep 2
  done

  # A power cut must not bring up "Restore pages?".
  PREFS="$PROFILE/Default/Preferences"
  if [ -f "$PREFS" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS" || true
  fi

  STARTED=$(date +%s)
  "$BROWSER" "${FLAGS[@]}" >"$CONF_DIR/browser.log" 2>&1 9>&- &
  STATUS=0
  wait "$!" || STATUS=$?
  say "Browser closed (exit $STATUS) after $(($(date +%s) - STARTED)) s, opening it again in 2 s"
  sleep 2
done
