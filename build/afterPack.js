// Unsigned Mac builds: re-sign the app "ad hoc" (no Apple account needed) after packaging.
// Without this, Apple Silicon Macs can refuse the app as "damaged" because editing Electron's
// files (icon, Info.plist) breaks its built-in signature.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
