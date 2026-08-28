import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];
const BILIBILI_MATCH = "https://search.bilibili.com/*";
const CONTENT_SCRIPT_ENTRY = "content/contentScript.js";
const CONTENT_MODULE_RESOURCES = [
  "content/bilibiliRuntime.js",
  "content/siteRuntime.js",
  "content/adapters/bilibiliSearchAdapter.js",
  "content/candidateBinding.js",
  "content/eventCollector/click.js",
  "content/eventCollector/hover.js",
  "content/visibility.js",
  "shared/messages.js",
  "shared/types.js",
  "shared/url.js"
];

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
    JSON.stringify([BILIBILI_MATCH]),
  `host_permissions must contain only ${BILIBILI_MATCH}`
);
check(
  !("optional_permissions" in manifest) &&
    !("optional_host_permissions" in manifest),
  "optional permissions must be absent"
);
check(
  JSON.stringify(manifest.content_scripts) ===
    JSON.stringify([
      {
        matches: [BILIBILI_MATCH],
        js: [CONTENT_SCRIPT_ENTRY],
        run_at: "document_idle"
      }
    ]),
  "content_scripts must contain one exact Bilibili isolated entry"
);
check(
  JSON.stringify(manifest.web_accessible_resources) ===
    JSON.stringify([
      {
        resources: CONTENT_MODULE_RESOURCES,
        matches: [BILIBILI_MATCH]
      }
    ]),
  "web_accessible_resources must expose only the required Bilibili modules"
);

const declaredPatterns = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? []),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap(
    (entry) => entry.matches ?? []
  )
];
check(
  declaredPatterns.every((pattern) => pattern === BILIBILI_MATCH),
  "all declared URL patterns must be the exact approved Bilibili search match"
);

const requiredPaths = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  "shared/messages.js",
  "content/demoRuntime.js",
  CONTENT_SCRIPT_ENTRY,
  ...CONTENT_MODULE_RESOURCES,
  "sidepanel/app.js",
  "demo/index.html",
  "demo/app.js"
];

const contentEntryPath = path.join(root, CONTENT_SCRIPT_ENTRY);
if (fs.existsSync(contentEntryPath)) {
  const contentEntry = fs.readFileSync(contentEntryPath, "utf8");
  check(
    contentEntry.includes(
      'chrome.runtime.getURL("content/bilibiliRuntime.js")'
    ) &&
      contentEntry.includes("import(runtimeModuleUrl)") &&
      contentEntry.includes("startBilibiliRuntime"),
    "content script entry must load and start the Bilibili ES Module Runtime"
  );
}

const bilibiliRuntimePath = path.join(root, "content/bilibiliRuntime.js");
if (fs.existsSync(bilibiliRuntimePath)) {
  const runtimeSource = fs.readFileSync(bilibiliRuntimePath, "utf8");
  for (const requiredImport of [
    "./adapters/bilibiliSearchAdapter.js",
    "./siteRuntime.js"
  ]) {
    check(
      runtimeSource.includes(requiredImport),
      `Bilibili Runtime must reuse ${requiredImport}`
    );
  }
  check(
    !/\.\/eventCollector\/|\.\/visibility\.js/u.test(runtimeSource),
    "Bilibili Runtime must delegate collectors to the shared Site Runtime"
  );
  check(
    !/localStorage|indexedDB|chrome\.storage/iu.test(runtimeSource),
    "Bilibili Runtime must not access browser storage directly"
  );
}

const siteRuntimePath = path.join(root, "content/siteRuntime.js");
if (fs.existsSync(siteRuntimePath)) {
  const runtimeSource = fs.readFileSync(siteRuntimePath, "utf8");
  for (const requiredImport of [
    "./eventCollector/click.js",
    "./eventCollector/hover.js",
    "./visibility.js"
  ]) {
    check(
      runtimeSource.includes(requiredImport),
      `Site Runtime must reuse ${requiredImport}`
    );
  }
  check(
    runtimeSource.includes("options.createAdapter"),
    "Site Runtime must receive its Site Adapter through the shared interface"
  );
  check(
    !/bilibiliSearchAdapter|search\.bilibili\.com|bili-video-card/iu.test(
      runtimeSource
    ),
    "Site Runtime must not contain Bilibili imports, URLs, or selectors"
  );
  check(
    !/localStorage|indexedDB|chrome\.storage/iu.test(runtimeSource),
    "Site Runtime must not access browser storage directly"
  );
}

const demoAppPath = path.join(root, "demo/app.js");
if (fs.existsSync(demoAppPath)) {
  const demoApp = fs.readFileSync(demoAppPath, "utf8");
  check(
    demoApp.includes('../content/demoRuntime.js'),
    "demo/app.js must import the local Demo Runtime"
  );
}

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
