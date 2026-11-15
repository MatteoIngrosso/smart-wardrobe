# The wall screen

A Raspberry Pi with a touch screen that opens the live app full screen as soon as it is switched on. Nothing of the app runs on the Pi: it is a browser locked to https://smart-wardrobe.matteo08-ingrosso.workers.dev, so every update merged into `main` reaches the wall by itself (the app's offline cache picks up a new deploy within about half an hour, at a moment nobody is touching the screen).

The same setup also works on an x86_64 mini-PC with a touch monitor running Debian or Ubuntu with a desktop: see "On a mini-PC" below.

## Parts
- Raspberry Pi 5 (4 GB)
- Raspberry Pi Touch Display 2 (10.1"), with its ribbon and power cables
- Raspberry Pi 27 W USB-C power supply
- Raspberry Pi 5 Active Cooler
- 32 GB microSD card (A2), plus a card reader for the PC
- A frame or wall bracket, and a USB keyboard for the first setup only (handy, not required)

## 1. Prepare the card (on the PC)
1. Install **Raspberry Pi Imager** from raspberrypi.com/software and put the microSD card in the PC.
2. Choose **Raspberry Pi 5**, **Raspberry Pi OS (64-bit)** (the one with the desktop) and the card.
3. When it asks about OS customisation, choose **Edit settings**:
   - hostname `wardrobe`
   - a username and password (write them down)
   - your Wi-Fi name and password, and your country
   - on the **Services** tab, turn on **SSH** with password login
4. Write the card. When it finishes, take the card out and put it back in: Windows shows a drive called **bootfs**.
5. Update the repository on the PC (`git pull` in `Documents\Wardrobe2.0`) and copy the whole `device` folder onto **bootfs**. Eject the card.

## 2. Put it together
1. Stick the Active Cooler on the Pi and plug its little fan cable into the **FAN** socket.
2. Screw the Pi onto the back of the screen with the screws in the box.
3. Ribbon cable: the narrow end goes in one of the Pi 5's two small **CAM/DISP** sockets, the wide end in the screen. Lift the dark latch, push the cable in straight with the contacts facing the right way, close the latch.
4. Screen power: the small red/black cable goes from the screen to the Pi's pins, red on **pin 4 (5 V)** and black on **pin 6 (GND)**.
5. Put the card in the Pi and connect the 27 W power supply. Only the Pi gets power; the screen takes its power from the Pi.

## 3. First start
1. The first start takes a few minutes and ends on the Raspberry Pi desktop. If the picture is sideways, carry on, it gets fixed in step 3 below.
2. On the PC, open **Terminal** (or PowerShell) and connect to the Pi with the username from step 1.3:
   ```
   ssh yourname@wardrobe.local
   ```
   (Or plug a keyboard into the Pi and open the Terminal on its desktop.)
3. Run the setup, then restart:
   ```
   bash /boot/firmware/device/install.sh
   sudo reboot
   ```
4. The Pi now starts straight into the app. Type the app password once on the on-screen keyboard (or a USB keyboard): it stays logged in for a year.

## 4. On the wall
Mount it near a socket with good Wi-Fi, and leave a little air behind the Pi for the fan. After 3 minutes without a touch the app shows its ambient screen: a black screen with the clock, the weather and today's outfit, which moves a little every minute so nothing burns in, while the 3D mirror stops drawing. A tap brings the app back as it was. After 30 minutes the screen turns off, and the next touch wakes it.

## Ambient screen and diagnostics
- **Ambient screen**: how soon it comes (or Off) is in the app, **Settings > Wall screen**, and **Show it now** previews it. When the screen itself turns off is `BLANK_MINUTES` below.
- **Diagnostics**: tap the page title (for example "Good morning" on Today) 5 times quickly. It shows the graphics chip and whether it really draws (if it says "the processor", set `GPU_BOOST=1` and restart), frames per second, the 3D mirror's use of graphics memory, the storage used and the offline cache. **Test the 3D speed** turns the avatar once: 50–60 frames a second is smooth. **Force refresh offline cache** loads the newest version of the app from the server (use it if an update doesn't show), **Reset avatar camera** turns him back to the front.
- **Touch**: chip rows and photo strips scroll by dragging. Some touch screens on a mini-PC act like a mouse; dragging works with those too.
- **On the iPad**: the ambient screen works the same. Set **Settings > Display & Brightness > Auto-Lock** to Never while it's on the wall and plugged in, or the iPad switches its screen off by itself.

## Changing settings
Settings live in `~/.config/wardrobe-kiosk/kiosk.conf` on the Pi (over SSH: `nano ~/.config/wardrobe-kiosk/kiosk.conf`), then `sudo reboot`:
- `BLANK_MINUTES`: minutes before the screen turns off (0 = never; 30 by default, the app's ambient screen comes before that)
- `ROTATION`: `normal`, `90`, `180` or `270` if the picture is the wrong way round
- `NIGHTLY_RESTART_HOUR`: the hour the browser restarts every night to stay fresh
- `GPU_BOOST`: `1` (default) makes Chromium draw with the graphics chip, so the 3D mirror runs smoothly. Set `0` if the screen flickers or shows stripes
- `EXTRA_FLAGS`: extra Chromium switches, for trying things out
- `URL`: the page it opens

`wardrobe-kiosk restart` restarts the browser without restarting the Pi. To get the normal desktop back, run `rm ~/.config/labwc/autostart` and restart.

If something looks wrong, the kiosk writes what it did to `~/.config/wardrobe-kiosk/kiosk.log` (start, screen, every browser restart) and the browser's own messages to `browser.log` next to it.

## On a mini-PC
Any x86_64 mini-PC with Debian or Ubuntu (with a desktop) and a touch monitor works. Copy the `device` folder onto it, open a terminal in that folder and run `bash install.sh`, then restart. The script installs the same things (Chromium; on Ubuntu that's the snap, which the kiosk handles), starts the kiosk at login through the desktop's autostart (`~/.config/autostart/wardrobe-kiosk.desktop`; delete it to stop) and turns on auto login where the desktop uses LightDM. With GNOME (Ubuntu) turn on **Settings > Users > Automatic Login** once by hand; the kiosk turns GNOME's screen lock off itself. On an X11 desktop the kiosk stops X11's own screen blanking and turns the screen off after `BLANK_MINUTES` instead, like on the Pi. There's no on-screen keyboard on X11: type the app password once with a USB keyboard.

## Files
- `install.sh`: run once on the Pi (64-bit ARM) or a mini-PC (x86_64). Checks the computer, installs Chromium and the screen tools from the system's own packages, turns on auto login, and starts the kiosk at login instead of the desktop. Safe to run again, also while the kiosk is running. `bash install.sh --lint` also installs `shellcheck` (from the system's packages) and checks both scripts first.
- `kiosk.sh`: installed as `~/.local/bin/wardrobe-kiosk`. Works on Wayland (the Pi) and X11. Waits for Wi-Fi, opens the app full screen (telling it it's the wall screen with `?kiosk=1`) (no address bar, no pinch zoom, no swipe-back, no "Restore pages?" after a power cut, no "Chromium is out of date" or translate bars), uses the graphics chip for the 3D mirror, turns the screen off when idle, starts the on-screen keyboard and reopens the browser 2 seconds after it closes or crashes. Only one runs at a time.
- `kiosk.conf`: the default settings above.
