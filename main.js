// VA EME desktop shell: a thin Electron wrapper around the live web app.
// Everything inside the window (chat, tasks, files...) is the website, so Lovable publishes reach
// everyone without a new installer. Only things in THIS file need a shell update.
const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, shell, dialog, ipcMain, session, net } = require("electron");
const fs = require("fs");
const path = require("path");

const APP_URL = "https://app.vaeme.pro/app";
const APP_ORIGIN = new URL(APP_URL).origin;
const RELEASES_API = "https://api.github.com/repos/jrchbgpr/vaeme-desktop/releases?per_page=5";
const RELEASES_PAGE = "https://github.com/jrchbgpr/vaeme-desktop/releases";

const MIN_WIDTH = 900; // stays above the app's 768px phone-layout breakpoint
const MIN_HEIGHT = 740; // keeps the left menu from getting squashed
const DEFAULT_SIZE = { width: 1280, height: 800 };

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
// Windows needs an app id so notifications show up under the right name.
if (IS_WIN) app.setAppUserModelId("com.vaeme.desktop");

let win = null;
let tray = null;
let quitting = false;

// ---------- tiny settings file (window size/position, launch-at-login choice) ----------
const settingsFile = () => path.join(app.getPath("userData"), "shell-settings.json");
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; }
}
function writeSettings(patch) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch })); } catch { /* ignore */ }
}

// ---------- log file ----------
function log(line) {
  try {
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "vaeme.log");
    try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + ".old"); } catch { /* none yet */ }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

// ---------- only one copy of the app ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => showWindow());

// ---------- window ----------
function savedBounds() {
  const b = readSettings().bounds;
  if (!b || typeof b.width !== "number") return DEFAULT_SIZE;
  const { screen } = require("electron");
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x !== undefined && b.x + 100 > a.x && b.x < a.x + a.width - 100 && b.y + 50 > a.y && b.y < a.y + a.height - 50;
  });
  return visible ? b : { width: b.width, height: b.height };
}

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "VA EME",
    backgroundColor: "#1F2328",
    // Mac: no black title bar. The red/yellow/green buttons sit inside VA EME's own top bar.
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 17 } } : {}),
    // Windows: minimize / maximize / close sit inside VA EME's own top bar (48px tall, like the bar itself).
    ...(process.platform === "win32" ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: 48 } } : {}),
    show: false,
    autoHideMenuBar: true, // Windows: menu appears on Alt
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      autoplayPolicy: "no-user-gesture-required", // message chime plays without a click first
      backgroundThrottling: false,                // keep receiving messages while the window is hidden/behind others
    },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(APP_URL);

  // Let the top bar act as the window's drag handle (the native title bar is gone), keeping controls clickable.
  win.webContents.on("dom-ready", () => {
    if (!(IS_MAC || IS_WIN) || !isAppUrl(win.webContents.getURL())) return;
    win.webContents.insertCSS(`
      .workspace-bar { -webkit-app-region: drag; }
      .workspace-bar :is(button, a, input, select, textarea, label, [role="button"], [role="combobox"], [role="menuitem"], [tabindex]) { -webkit-app-region: no-drag; }
      /* While a dialog, menu or popover is open, the top bar must not swallow clicks beneath it. */
      body:has([role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]) .workspace-bar { -webkit-app-region: no-drag; }
      /* File viewer: a little smaller, starting below the window buttons. */
      .file-viewer { top: ${IS_WIN ? 56 : 44}px !important; right: 24px !important; bottom: 24px !important; left: 24px !important; }
      ${IS_WIN ? ".workspace-bar { padding-right: 150px !important; }" : ""}
      body:not(:has(.workspace-bar))::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: 28px; -webkit-app-region: drag; z-index: 2147483647; pointer-events: auto; }
    `).catch(() => {});
  });

  if (IS_WIN) {
    win.webContents.on("did-finish-load", syncTitleBarOverlay);
    win.webContents.on("did-navigate-in-page", () => setTimeout(syncTitleBarOverlay, 400));
    const timer = setInterval(syncTitleBarOverlay, 2000);
    win.on("closed", () => clearInterval(timer));
  }

  // Problems from inside the site are saved to a log file (Help > Open log folder) so they are easy to report.
  win.webContents.on("console-message", (event, level, message, line, sourceId) => {
    const e = event && typeof event === "object" && "message" in event ? event : { level, message, lineNumber: line, sourceId };
    const lvl = String(e.level);
    if (lvl === "error" || lvl === "warning" || lvl === "3" || lvl === "2") log(`[console ${lvl}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });

  // Remember size and position.
  const save = () => { if (win && !win.isMinimized() && !win.isFullScreen()) writeSettings({ bounds: win.getBounds() }); };
  win.on("resize", save);
  win.on("move", save);

  // Closing hides the window so alerts keep arriving. Quit from the menu to exit completely.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.hide();
    }
  });

  // Links: the VA EME site stays in the window, everything else opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) { win.loadURL(url); } else { openExternal(url); }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return; // our offline page
    if (!isAppUrl(url)) { event.preventDefault(); openExternal(url); }
  });

  // Offline / server unreachable: show a friendly page with a retry button.
  win.webContents.on("did-fail-load", (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */ || !url.startsWith("http")) return;
    console.error(`[load failed] ${code} ${desc} ${url}`);
    // The page shows the technical reason in small text so problems are easy to report.
    win.loadFile(path.join(__dirname, "offline.html"), { query: { code: String(code), desc: String(desc), url: String(url) } });
  });
}

// Windows: the minimize/maximize/close buttons are transparent so VA EME's top bar shows through.
// Only the symbol color changes: it looks at the real pixels behind the buttons and picks dark or light.
let lastSymbol = "";
async function syncTitleBarOverlay() {
  if (!IS_WIN || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !isAppUrl(win.webContents.getURL())) return;
  try {
    const width = win.getContentBounds().width;
    const image = await win.webContents.capturePage({ x: Math.max(0, width - 150), y: 4, width: 140, height: 40 });
    const px = image.toBitmap(); // BGRA
    if (!px.length) return;
    let sum = 0, count = 0;
    for (let i = 0; i + 3 < px.length; i += 4) { sum += 0.114 * px[i] + 0.587 * px[i + 1] + 0.299 * px[i + 2]; count++; }
    const symbolColor = sum / count > 150 ? "#1f2328" : "#ffffff";
    if (symbolColor === lastSymbol) return;
    lastSymbol = symbolColor;
    win.setTitleBarOverlay({ color: "#00000000", symbolColor, height: 48 });
  } catch { /* ignore */ }
}

function isAppUrl(url) {
  try { return new URL(url).origin === APP_ORIGIN; } catch { return false; }
}
function openExternal(url) {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") shell.openExternal(url);
  } catch { /* ignore */ }
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

// ---------- menu bar icon ----------
function createTray() {
  // One-color "Template" image: macOS recolors it for light/dark menu bars (the @2x/@3x files are picked up automatically).
  let icon;
  if (IS_MAC) {
    icon = nativeImage.createFromPath(path.join(__dirname, "assets", "emeTemplate.png"));
    icon.setTemplateImage(true);
  } else {
    // Windows: the full-color logo (tray icons there are colored, not one-tone).
    icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon-256.png")).resize({ width: 32, height: 32 });
  }
  tray = new Tray(icon);
  tray.setToolTip("VA EME");
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open VA EME", click: showWindow },
    { type: "separator" },
    {
      label: "Launch at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); writeSettings({ loginChoice: item.checked }); rebuild(); },
    },
    { label: "Check for updates…", click: () => checkForUpdates(true) },
    { type: "separator" },
    { label: "Quit VA EME", click: () => { quitting = true; app.quit(); } },
  ]));
  rebuild();
  tray.on("click", showWindow);
}

// ---------- app menu (needed for copy/paste/undo shortcuts on Mac) ----------
function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => checkForUpdates(true) },
        { label: "Send Test Notification", click: () => showNativeNotification({ title: "VA EME", body: "Notifications are working." }) },
        { label: "Send Test Notification in 5 Seconds", click: () => setTimeout(() => showNativeNotification({ title: "VA EME", body: "Notifications are working (delayed test)." }), 5000) },
        { label: "Open Log Folder", click: () => shell.openPath(app.getPath("logs")) },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { label: "Quit VA EME", accelerator: "CmdOrCtrl+Q", click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- update check (new SHELL versions only; the website updates itself) ----------
function parseVersion(v) {
  const m = String(v).replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.?(\d+))?/i);
  if (!m) return null;
  const pre = String(v).includes("-");
  return [Number(m[1]), Number(m[2]), Number(m[3]), pre ? Number(m[4] || 0) : Infinity];
}
function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 4; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}
async function checkForUpdates(manual) {
  try {
    const response = await net.fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(String(response.status));
    const releases = (await response.json()).filter((r) => !r.draft);
    const latest = releases.find((r) => isNewer(r.tag_name, app.getVersion()));
    if (latest) {
      const { response: choice } = await dialog.showMessageBox({
        type: "info", buttons: ["Open download page", "Later"], defaultId: 0,
        message: "A new version of the VA EME app is available",
        detail: `You have ${app.getVersion()}. The newest is ${latest.tag_name.replace(/^v/, "")}.\n\nThe VA EME website itself always updates on its own. This is only the app wrapper.`,
      });
      if (choice === 0) shell.openExternal(latest.html_url || RELEASES_PAGE);
    } else if (manual) {
      dialog.showMessageBox({ type: "info", message: "You're up to date", detail: `VA EME app version ${app.getVersion()}.`, buttons: ["OK"] });
    }
  } catch {
    if (manual) dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: "Check your internet connection and try again.", buttons: ["OK"] });
  }
}

// ---------- permissions: notifications, microphone, camera for the VA EME site only ----------
function setupPermissions() {
  const allowed = new Set(["notifications", "media", "clipboard-sanitized-write", "fullscreen"]);
  const fromApp = (contents) => { try { return new URL(contents.getURL()).origin === APP_ORIGIN; } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(allowed.has(permission) && fromApp(contents)));
  const failed = { urls: ["https://*/*"] };
  session.defaultSession.webRequest.onErrorOccurred(failed, (d) => { if (d.error !== "net::ERR_ABORTED") log(`[request failed] ${d.error} ${d.method} ${d.url.slice(0, 200)}`); });
  session.defaultSession.webRequest.onCompleted(failed, (d) => { if (d.statusCode >= 400) log(`[http ${d.statusCode}] ${d.method} ${d.url.slice(0, 200)}`); });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => !!contents && allowed.has(permission) && fromApp(contents));
}

// ---------- messages from the website (preload) ----------
ipcMain.on("vaeme:focus", () => showWindow());
ipcMain.on("vaeme:badge", (_event, count) => {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (process.platform === "darwin" && app.dock) app.dock.setBadge(n ? (n > 99 ? "99+" : String(n)) : "");
  if (IS_WIN && win && !win.isDestroyed() && n === 0) win.setOverlayIcon(null, "");
});
// Windows: the unread count is drawn by the page as a small image and shown on the taskbar icon.
ipcMain.on("vaeme:badge-image", (_event, { count, dataURL }) => {
  if (!IS_WIN || !win || win.isDestroyed()) return;
  try { win.setOverlayIcon(nativeImage.createFromDataURL(String(dataURL)), `${count} unread`); } catch { /* ignore */ }
});

// Native macOS notifications from the main process (more reliable than the web Notification API in Electron).
function showNativeNotification({ title, body, url, silent }) {
  if (!Notification.isSupported()) { log("[notify] notifications not supported"); return; }
  const n = new Notification({ title: String(title || "VA EME"), body: String(body || ""), silent: !!silent });
  n.on("click", () => {
    showWindow();
    if (url && win && !win.isDestroyed()) win.webContents.send("vaeme:open", String(url));
  });
  n.on("failed", (_e, error) => log(`[notify failed] ${error}`));
  n.show();
  log(`[notify] shown: ${title}`);
}
ipcMain.on("vaeme:log", (_event, line) => log(`[site] ${String(line).slice(0, 300)}`));
ipcMain.on("vaeme:notify", (_event, payload) => { if (payload && typeof payload === "object") showNativeNotification(payload); });

// ---------- start ----------
app.whenReady().then(() => {
  setupPermissions();
  createMenu();
  createTray();
  createWindow();

  // Launch at login: on by default the first time, then the person's own choice is respected.
  if (readSettings().loginChoice === undefined) {
    app.setLoginItemSettings({ openAtLogin: true });
    writeSettings({ loginChoice: true });
  }

  setTimeout(() => checkForUpdates(false), 15000);
  app.on("activate", showWindow); // Dock icon click brings the window back
});

app.on("before-quit", () => { quitting = true; });
// Keep running in the menu bar when the window is closed.
app.on("window-all-closed", () => { /* stay alive */ });
