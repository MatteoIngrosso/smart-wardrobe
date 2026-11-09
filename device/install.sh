#!/bin/bash
# Turns a fresh Raspberry Pi OS (64-bit, with desktop) or a Debian/Ubuntu mini-PC (x86_64,
# with a desktop) into the Smart Wardrobe wall screen. Run it as your normal user, not as root:
#   bash install.sh          set it up
#   bash install.sh --lint   also install shellcheck and check the kiosk scripts first
# Safe to run again: it only rewrites its own files.
set -euo pipefail

LINT=0
for arg in "$@"; do
  case "$arg" in
    --lint) LINT=1 ;;
    -h | --help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user (without sudo). It asks for sudo itself." >&2
  exit 1
fi
for cmd in sudo apt-get; do
  if ! command -v "$cmd" >/dev/null; then
    echo "This needs Raspberry Pi OS, Debian or Ubuntu ($cmd is missing)." >&2
    exit 1
  fi
done

HERE=$(cd "$(dirname "$0")" && pwd)
CONF_DIR="$HOME/.config/wardrobe-kiosk"
USER_NAME=$(id -un)

# The same steps work on both kinds of computer; only the details differ.
ARCH=$(uname -m)
case "$ARCH" in
  aarch64 | arm64) KIND="64-bit ARM" ;;
  x86_64 | amd64) KIND="x86_64" ;;
  armv7l | armv6l) KIND="32-bit ARM (works, but the 64-bit Raspberry Pi OS runs the 3D mirror much better)" ;;
  *) echo "This computer's processor ($ARCH) isn't supported: use a 64-bit ARM (Raspberry Pi) or x86_64 one." >&2; exit 1 ;;
esac
IS_PI=0
MODEL=/proc/device-tree/model
if [ -r "$MODEL" ] && tr -d '\0' <"$MODEL" | grep -q "Raspberry Pi"; then IS_PI=1; fi
if [ "$IS_PI" = 1 ]; then echo "Setting up a Raspberry Pi ($KIND)."; else echo "Setting up this computer ($KIND)."; fi

# A package this system's repositories offer (name in $1)?
has_pkg() {
  local c
  c=$(apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/ {print $2; exit}') || true
  [ -n "$c" ] && [ "$c" != "(none)" ]
}

sudo -v  # ask for the password once, at the start

echo "1/5 Installing the browser and screen tools..."
sudo apt-get update -qq
CHROMIUM=chromium
has_pkg chromium || CHROMIUM=chromium-browser  # older Raspberry Pi OS and Ubuntu (a snap there)
if ! has_pkg "$CHROMIUM"; then
  echo "    no Chromium package found in this system's repositories" >&2
  exit 1
fi
sudo apt-get install -y -qq "$CHROMIUM" curl ca-certificates util-linux
# Nice to have, so one missing package doesn't stop the setup:
#   Wayland (Raspberry Pi OS): rotation, screen off, on-screen keyboard
#   X11 (most mini-PCs): screen blanking (xset), rotation (xrandr) and turning the touch with it
for pkg in wlr-randr swayidle wlopm squeekboard x11-xserver-utils xinput; do
  if has_pkg "$pkg"; then
    sudo apt-get install -y -qq "$pkg" || echo "    could not install $pkg, skipping it"
  fi
done

echo "2/5 Checking the kiosk files..."
for f in kiosk.sh kiosk.conf; do
  if [ ! -f "$HERE/$f" ]; then
    echo "    $f is missing: copy the whole device folder, then run install.sh from it" >&2
    exit 1
  fi
done
bash -n "$HERE/kiosk.sh"
if [ "$LINT" = 1 ]; then
  sudo apt-get install -y -qq shellcheck
  shellcheck "$HERE/kiosk.sh" "$HERE/install.sh"
  echo "    shellcheck: no problems"
fi
BROWSER=$(command -v chromium || command -v chromium-browser || true)
missing=""
for cmd in curl flock pkill; do command -v "$cmd" >/dev/null || missing="$missing $cmd"; done
[ -n "$BROWSER" ] || missing="$missing chromium"
if [ -n "$missing" ]; then
  echo "    still missing:$missing" >&2
  exit 1
fi
echo "    $("$BROWSER" --version 2>/dev/null || echo "$BROWSER")"

echo "3/5 Logging in to the desktop automatically..."
if [ "$IS_PI" = 1 ] && command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_wayland W3 || true  # labwc desktop (already the default on newer images)
  sudo raspi-config nonint do_boot_behaviour B4 || echo "    could not turn on auto login: use sudo raspi-config"
  sudo raspi-config nonint do_blanking 1 || true  # the kiosk handles screen off itself
elif [ -d /etc/lightdm ]; then
  sudo mkdir -p /etc/lightdm/lightdm.conf.d
  printf '[Seat:*]\nautologin-user=%s\nautologin-user-timeout=0\n' "$USER_NAME" |
    sudo tee /etc/lightdm/lightdm.conf.d/60-wardrobe-kiosk.conf >/dev/null
elif [ -d /etc/gdm3 ]; then
  echo "    GNOME: turn on Settings > Users > Automatic Login for $USER_NAME (once, by hand)"
else
  echo "    turn on automatic login for $USER_NAME in your desktop's settings (once, by hand)"
fi

echo "4/5 Copying the kiosk files..."
mkdir -p "$CONF_DIR" "$HOME/.local/bin"
# Through a new file, so a kiosk that is running right now keeps reading its old copy.
install -m 755 "$HERE/kiosk.sh" "$HOME/.local/bin/wardrobe-kiosk.new"
mv -f "$HOME/.local/bin/wardrobe-kiosk.new" "$HOME/.local/bin/wardrobe-kiosk"
if [ -f "$CONF_DIR/kiosk.conf" ]; then
  echo "    keeping your existing $CONF_DIR/kiosk.conf"
else
  install -m 644 "$HERE/kiosk.conf" "$CONF_DIR/kiosk.conf"
fi

echo "5/5 Starting the app at login..."
if command -v labwc >/dev/null; then
  # Raspberry Pi OS: the kiosk replaces the desktop.
  mkdir -p "$HOME/.config/labwc"
  AUTOSTART="$HOME/.config/labwc/autostart"
  if [ -f "$AUTOSTART" ] && ! grep -q wardrobe-kiosk "$AUTOSTART"; then
    cp "$AUTOSTART" "$AUTOSTART.before-wardrobe"
    echo "    your old autostart is saved as $AUTOSTART.before-wardrobe"
  fi
  cat >"$AUTOSTART" <<AUTO
# Smart Wardrobe wall screen (written by install.sh).
# To get the normal desktop back: rm ~/.config/labwc/autostart and restart.
$HOME/.local/bin/wardrobe-kiosk &
AUTO
  UNDO="rm ~/.config/labwc/autostart"
else
  # Other desktops (GNOME, Xfce, LXQt, KDE...): the standard autostart entry.
  mkdir -p "$HOME/.config/autostart"
  cat >"$HOME/.config/autostart/wardrobe-kiosk.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Smart Wardrobe wall screen
Comment=Written by install.sh. Delete this file to stop the kiosk starting at login.
Exec=$HOME/.local/bin/wardrobe-kiosk
X-GNOME-Autostart-enabled=true
DESKTOP
  UNDO="rm ~/.config/autostart/wardrobe-kiosk.desktop"
fi

URL=$(sed -n 's/^URL="\(.*\)"$/\1/p' "$CONF_DIR/kiosk.conf" | head -n 1 || true)
if [ -n "$URL" ] && ! curl -s -o /dev/null --max-time 5 "$URL"; then
  echo "    note: $URL can't be reached right now; the kiosk waits for the network at start"
fi

echo
echo "Done. Restart with:  sudo reboot"
echo "Settings (screen off time, rotation, GPU): $CONF_DIR/kiosk.conf"
echo "Kiosk log: $CONF_DIR/kiosk.log. To get the normal desktop back: $UNDO and restart."
