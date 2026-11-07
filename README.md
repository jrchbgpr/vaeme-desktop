# vaeme-desktop

Desktop wrapper (Electron) for VA EME. It opens the live site, https://app.vaeme.com/app, in its own window.

- **Website changes** (published from Lovable) reach everyone on their next refresh. No new installer.
- **Shell changes** (this repo: window size, menu bar icon, notifications bridge, Dock badge, app address, icon) need a new build and a new download.

## What the shell does

- Window: minimum 900 x 600 (stays in the desktop layout), opens at 1280 x 800, remembers size and position.
- Closing the window hides it to the menu bar; Quit (menu or Cmd+Q) exits.
- Launch at login (on the first time; changeable from the menu bar icon).
- Notifications: the site's alert code is routed to native notifications; clicking one opens the right place.
- Dock badge: the site can call `window.vaemeDesktop.setBadge(count)`.
- External links open in the normal browser. Offline page with retry.
- Update check against GitHub releases (new shell versions only).

## Files

| File | Purpose |
| --- | --- |
| `main.js` | The app: window, tray, menu, permissions, update check |
| `preload.js` | Bridge between the site and the shell (badge, notification routing) |
| `offline.html` | Shown when the site can't be reached |
| `build/` | App icon and the ad-hoc signing step |
| `.github/workflows/build-mac.yml` | Builds the `.dmg` files on GitHub |
| `INSTALL.md` | Install sheet for the team |

## Building

Push a tag such as `v0.1.0-test.1` (or run the workflow by hand in the Actions tab). The `.dmg` files appear on the run page and, for tags, on the Releases page.

To run locally: `npm install && npm start`.

## Things to change only with a new build

The app address is `APP_URL` in `main.js`. Changing the domain, window limits, or notification handling means a new shell version.
