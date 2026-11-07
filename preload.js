// Runs inside the VA EME page before it loads. Two jobs:
// 1) give the website a small bridge (window.vaemeDesktop) for the Dock badge and focusing the window;
// 2) make the site's existing notification code work in Electron, which has no browser push service.
const { contextBridge, ipcRenderer, webFrame } = require("electron");


// Unread count. Mac shows it on the Dock icon; Windows shows a small red badge on the taskbar icon.
function setBadge(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  ipcRenderer.send("vaeme:badge", n);
  if (process.platform !== "win32" || n === 0) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const g = canvas.getContext("2d");
    g.fillStyle = "#e5322d";
    g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffffff";
    g.font = "bold 20px Segoe UI, Arial, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(n > 99 ? "99+" : String(n), 16, 17, 28);
    ipcRenderer.send("vaeme:badge-image", { count: n, dataURL: canvas.toDataURL("image/png") });
  } catch { /* ignore */ }
}

contextBridge.exposeInMainWorld("vaemeDesktop", {
  isDesktop: true,
  platform: process.platform,
  // The website can call window.vaemeDesktop.setBadge(unreadCount) to update the Dock icon.
  setBadge: (count) => setBadge(count),
  focus: () => ipcRenderer.send("vaeme:focus"),
});

// The site shows alerts through registration.showNotification() (service worker) and checks
// Notification.permission. Electron has no browser push service, so: report "granted" (the shell
// already allows notifications for this site only) and hand each alert to the Mac's native notifications.
// Clicking one brings the window forward and sends the site the same "vaeme:open" message its service worker would.
ipcRenderer.on("vaeme:open", (_event, url) => {
  webFrame.executeJavaScript(
    `navigator.serviceWorker && navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "vaeme:open", url: ${JSON.stringify(String(url))} } }));`,
  ).catch(() => {});
});

contextBridge.exposeInMainWorld("__vaemeNotify", (payload) => ipcRenderer.send("vaeme:notify", payload));
contextBridge.exposeInMainWorld("__vaemeBadge", (n) => setBadge(n));
contextBridge.exposeInMainWorld("__vaemeLog", (line) => ipcRenderer.send("vaeme:log", line));

webFrame.executeJavaScript(`(() => {
  const notify = window.__vaemeNotify;
  const logLine = window.__vaemeLog;
  const badge = window.__vaemeBadge;
  try { delete window.__vaemeBadge; } catch (e) {}
  // Windows has no built-in app badge in Electron: route the site's navigator.setAppBadge() to the taskbar.
  if (${JSON.stringify(process.platform==='win32')} && typeof navigator !== "undefined") {
    navigator.setAppBadge = (n) => { badge(n === undefined ? 1 : n); return Promise.resolve(); };
    navigator.clearAppBadge = () => { badge(0); return Promise.resolve(); };
  }
  try { delete window.__vaemeNotify; delete window.__vaemeLog; } catch (e) {}
  if (typeof Notification !== "undefined") {
    try { Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true }); } catch (e) {}
    Notification.requestPermission = (cb) => { if (typeof cb === "function") cb("granted"); return Promise.resolve("granted"); };
  }
  const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
  if (!proto || proto.__vaemePatched) return;
  proto.__vaemePatched = true;
  proto.showNotification = function (title, options) {
    options = options || {};
    try {
      logLine("alert requested: " + String(title));
      notify({ title: String(title || ""), body: String(options.body || ""), silent: !!options.silent, url: options.data && options.data.url });
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  };
})();`);
