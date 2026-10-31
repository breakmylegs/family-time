# Setting up the kiosk tablet

The kiosk is your child's own screen: an old Amazon Fire tablet running Fully Kiosk Browser, showing Family time's kiosk page from your home server. It only works on your home Wi-Fi.

You need: the tablet, a Fully Kiosk PLUS licence (a one-off payment, needed for kiosk mode and the camera), and your server's LAN address (the `LAN_IP` in `deploy/.state/network.env`).

## 1. Install Fully Kiosk Browser

Fire tablets don't have Google Play.

1. On the tablet, open Settings, then Security and privacy, and turn on Apps from unknown sources for the Silk browser.
2. In Silk, go to `fully-kiosk.com`, download the APK for Fire tablets, and install it.
3. Open Fully Kiosk. Buy and enter the PLUS licence from its settings (Other Settings, then Fully Kiosk PLUS).

## 2. Point it at the kiosk

1. In Fully's settings, Web Content Settings, set the Start URL to `http://LAN_IP:8180` (your server's address, for example `http://192.168.1.10:8180`).
2. Turn on Enable JavaScript Interface (Advanced Web Settings). The kiosk uses it to turn the screen off at bedtime.
3. Under Motion Detection, turn on Enable Visual Motion Detection and Turn Screen On on Motion.
4. Under Device Management, turn on Keep Screen On. At bedtime the kiosk turns the screen off itself, through the JavaScript Interface from step 2.
5. Allow the camera when the kiosk first asks, so "I did it" can take a photo.

## 3. Pair it

1. On your phone, open Family time, go to Settings, then Kiosk, and tap Set up the kiosk.
2. Type the six numbers on the tablet. They work once, for ten minutes.
3. The tablet shows your child's home. It stays set up after restarts.

If the tablet is lost or handed on, tap Remove this tablet next to it in Settings. It stops working at once.

## 4. Lock it down

1. In Fully's settings, Kiosk Mode, turn on Enable Kiosk Mode and set a kiosk PIN only you know.
2. **The Home button delay.** On Fire tablets, the Home button can leave kiosk mode for a moment before Fully takes it back. First set Fully as the home app (Fully's Kiosk Mode settings offer this). Then turn off Fire's own launcher with ADB from a computer, once:

   ```bash
   adb shell pm disable-user --user 0 com.amazon.firelauncher
   ```

   This needs Developer options and USB debugging turned on in the tablet's settings. To undo it: `adb shell pm enable com.amazon.firelauncher`.

## 5. Firewall it (on your router)

This is a change on your router, so make it yourself when you are ready; nothing in Family time changes the router.

1. Give the tablet a fixed address on your router (a DHCP reservation for its MAC address).
2. Allow the tablet to reach only the server's LAN address on port 8180 (and DNS on port 53 to the server, if AdGuard is your home DNS). Block everything else from the tablet, including the internet.
3. Optionally, allow only the tablet's address to reach the server on port 8180.

The kiosk works without the firewall; the rule just makes sure the tablet can't be used for anything else.

## If something is wrong

- **"Set up this kiosk" appears again**: the kiosk was removed in Settings, or the server's data was reset. Make a new code.
- **"Can't connect right now"**: the tablet isn't on the home Wi-Fi, or the server is down. If Family time opens on your phone at home, the server is up and the tablet's Wi-Fi is the thing to check.
- **The screen stays on at night**: turn on Enable JavaScript Interface (step 2.2).
