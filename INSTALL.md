# Installing VA EME on a Mac

The app opens **app.vaeme.com** in its own window. Everything inside it (chat, tasks, files) updates by itself whenever the site is updated. You only reinstall if the team is told there is a new *app* version.

## Which file do I download?

Open the latest release: https://github.com/jrchbgpr/vaeme-desktop/releases

- **Apple Silicon** (M1, M2, M3, M4 Macs): `VA-EME-…-arm64.dmg`
- **Intel Macs**: `VA-EME-…-x64.dmg`

Not sure? Apple menu → About This Mac. If it says "Chip: Apple M…" use arm64. If it says "Processor: Intel" use x64.

## Install

1. Open the downloaded `.dmg`.
2. Drag **VA EME** onto the **Applications** folder.
3. Open **Applications** and double-click **VA EME**.

## The "unknown developer" warning (first time only)

The app is not signed with an Apple account, so macOS asks you to approve it once:

1. Double-click VA EME. A message says it can't be opened. Click **Done** (or OK).
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the message about "VA EME" and click **Open Anyway**.
4. Enter your Mac password, then click **Open**.

You only do this once. After that it opens normally.

### If macOS says the app is "damaged"

Open **Terminal** and paste this line, then press Return:

```
xattr -cr "/Applications/VA EME.app"
```

Then open the app again.

## Notifications

When the app asks to show notifications, click **Allow**. Also check **System Settings → Notifications → VA EME** is turned on.

## Closing the window

Closing the window does **not** quit the app. It keeps running in the menu bar (top right) so alerts keep arriving. To fully quit: menu bar icon → **Quit VA EME**, or press **Cmd+Q**.

## Updating the app

When a new app version is released, VA EME shows a message with a download link, or choose **VA EME → Check for Updates…** in the menu bar. Download the new `.dmg` and drag it over the old one in Applications (choose **Replace**). Your login and settings are kept.
