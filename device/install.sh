#!/bin/bash
# Turns a fresh Raspberry Pi OS (with desktop) into the Smart Wardrobe wall screen.
# Run it as your normal user, not as root:  bash install.sh
# Safe to run again: it only rewrites its own files.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user (without sudo). It asks for sudo itself." >&2
  exit 1
fi

HERE=$(cd "$(dirname "$0")" && pwd)
CONF_DIR="$HOME/.config/wardrobe-kiosk"

echo "1/4 Installing the browser and screen tools..."
sudo apt-get update -qq
CHROMIUM=chromium
apt-cache show chromium >/dev/null 2>&1 || CHROMIUM=chromium-browser
sudo apt-get install -y -qq "$CHROMIUM" wlr-randr curl
# Screen off and the on-screen keyboard: nice to have, so one missing package doesn't stop the setup.
for pkg in swayidle wlopm squeekboard; do
  sudo apt-get install -y -qq "$pkg" || echo "    could not install $pkg, skipping it"
done

echo "2/4 Logging in to the desktop automatically..."
sudo raspi-config nonint do_wayland W3 || true  # labwc desktop (already the default on newer images)
sudo raspi-config nonint do_boot_behaviour B4    # desktop, auto login
sudo raspi-config nonint do_blanking 1 || true   # the kiosk handles screen off itself

echo "3/4 Copying the kiosk files..."
mkdir -p "$CONF_DIR" "$HOME/.local/bin" "$HOME/.config/labwc"
install -m 755 "$HERE/kiosk.sh" "$HOME/.local/bin/wardrobe-kiosk"
if [ -f "$CONF_DIR/kiosk.conf" ]; then
  echo "    keeping your existing $CONF_DIR/kiosk.conf"
else
  install -m 644 "$HERE/kiosk.conf" "$CONF_DIR/kiosk.conf"
fi

echo "4/4 Starting the app at login instead of the desktop..."
AUTOSTART="$HOME/.config/labwc/autostart"
if [ -f "$AUTOSTART" ] && ! grep -q wardrobe-kiosk "$AUTOSTART"; then
  cp "$AUTOSTART" "$AUTOSTART.before-wardrobe"
  echo "    your old autostart is saved as $AUTOSTART.before-wardrobe"
fi
cat > "$AUTOSTART" <<AUTO
# Smart Wardrobe wall screen (written by install.sh).
# To get the normal desktop back: rm ~/.config/labwc/autostart and restart.
$HOME/.local/bin/wardrobe-kiosk &
AUTO

echo
echo "Done. Restart with:  sudo reboot"
echo "Settings (screen off time, rotation): $CONF_DIR/kiosk.conf"
