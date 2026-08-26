import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

check(manifest.manifest_version === 3, "manifest_version must be 3");
check(
  JSON.stringify(manifest.permissions) === JSON.stringify(["sidePanel"]),
  "permissions must contain only sidePanel"
);
check(
  JSON.stringify(manifest.host_permissions) ===
    JSON.stringify(["https://search.bilibili.com/*"]),
  "host_permissions must contain only https://search.bilibili.com/*"
);
check(!("content_scripts" in manifest), "content_scripts must be absent");

const requiredPaths = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  "shared/messages.js",
  "sidepanel/app.js",
  "demo/index.html",
  "demo/app.js"
];

const sidePanelHtmlPath = manifest.side_panel?.default_path;
if (
  typeof sidePanelHtmlPath === "string" &&
  fs.existsSync(path.join(root, sidePanelHtmlPath))
) {
  const sidePanelHtml = fs.readFileSync(
    path.join(root, sidePanelHtmlPath),
    "utf8"
  );
  if (sidePanelHtml.includes("styles.css")) {
    requiredPaths.push("sidepanel/styles.css");
  }
}

for (const requiredPath of requiredPaths) {
  check(
    typeof requiredPath === "string" &&
      fs.existsSync(path.join(root, requiredPath)),
    `required extension file is missing: ${String(requiredPath)}`
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Build validation failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.info(
    "Build validation passed. The repository root is the unpacked extension directory."
  );
}
