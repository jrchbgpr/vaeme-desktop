// Runs inside the VA EME page before it loads. Two jobs:
// 1) give the website a small bridge (window.vaemeDesktop) for the Dock badge and focusing the window;
// 2) make the site's existing notification code work in Electron, which has no browser push service.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("vaemeDesktop", {
  isDesktop: true,
  platform: process.platform,
  // The website can call window.vaemeDesktop.setBadge(unreadCount) to update the Dock icon.
  setBadge: (count) => ipcRenderer.send("vaeme:badge", count),
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

webFrame.executeJavaScript(`(() => {
  const notify = window.__vaemeNotify;
  try { delete window.__vaemeNotify; } catch (e) {}
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
      notify({ title: String(title || ""), body: String(options.body || ""), silent: !!options.silent, url: options.data && options.data.url });
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  };
})();`);
