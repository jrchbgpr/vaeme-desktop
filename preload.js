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

// The site shows alerts through registration.showNotification() (service worker). Electron doesn't
// support that, so route it to the regular Notification API, which Electron shows natively.
// Clicking an alert brings the window forward and asks the site to open the right place,
// using the same "vaeme:open" message its service worker normally sends.
webFrame.executeJavaScript(`(() => {
  const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
  if (!proto || proto.__vaemePatched) return;
  proto.__vaemePatched = true;
  proto.showNotification = function (title, options) {
    options = options || {};
    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        n.close();
        if (window.vaemeDesktop) window.vaemeDesktop.focus();
        const url = options.data && options.data.url;
        if (url && navigator.serviceWorker) {
          navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "vaeme:open", url } }));
        }
      };
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  };
})();`);
