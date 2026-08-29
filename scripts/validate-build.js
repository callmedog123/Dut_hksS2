import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];
const BILIBILI_MATCH = "https://search.bilibili.com/*";
const ZHIHU_CONTENT_MATCH = "https://www.zhihu.com/search*";
const ZHIHU_RESOURCE_MATCH = "https://www.zhihu.com/*";
const DOUYIN_CONTENT_MATCH = "https://www.douyin.com/search/*";
const DOUYIN_RESOURCE_MATCH = "https://www.douyin.com/*";
const BILIBILI_CONTENT_SCRIPT_ENTRY = "content/contentScript.js";
const ZHIHU_CONTENT_SCRIPT_ENTRY = "content/zhihuContentScript.js";
const DOUYIN_CONTENT_SCRIPT_ENTRY = "content/douyinContentScript.js";
const SHARED_CONTENT_MODULE_RESOURCES = [
  "content/candidateBinding.js",
  "content/eventCollector/click.js",
  "content/eventCollector/hover.js",
  "content/visibility.js",
  "shared/messages.js",
  "shared/types.js",
  "shared/url.js"
];
const BILIBILI_CONTENT_MODULE_RESOURCES = [
  "content/bilibiliRuntime.js",
  "content/siteRuntime.js",
  "content/adapters/bilibiliSearchAdapter.js",
  ...SHARED_CONTENT_MODULE_RESOURCES
];
const ZHIHU_CONTENT_MODULE_RESOURCES = [
  "content/zhihuRuntime.js",
  "content/siteRuntime.js",
  "content/adapters/zhihuSearchAdapter.js",
  ...SHARED_CONTENT_MODULE_RESOURCES
];
const DOUYIN_CONTENT_MODULE_RESOURCES = [
  "content/douyinRuntime.js",
  "content/siteRuntime.js",
  "content/adapters/douyinSearchAdapter.js",
  ...SHARED_CONTENT_MODULE_RESOURCES
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
        js: [BILIBILI_CONTENT_SCRIPT_ENTRY],
        run_at: "document_idle"
      },
      {
        matches: [ZHIHU_CONTENT_MATCH],
        js: [ZHIHU_CONTENT_SCRIPT_ENTRY],
        run_at: "document_idle"
      },
      {
        matches: [DOUYIN_CONTENT_MATCH],
        js: [DOUYIN_CONTENT_SCRIPT_ENTRY],
        run_at: "document_idle"
      }
    ]),
  "content_scripts must contain exact approved Bilibili, Zhihu, and Douyin search entries"
);
check(
  JSON.stringify(manifest.web_accessible_resources) ===
    JSON.stringify([
      {
        resources: BILIBILI_CONTENT_MODULE_RESOURCES,
        matches: [BILIBILI_MATCH]
      },
      {
        resources: ZHIHU_CONTENT_MODULE_RESOURCES,
        matches: [ZHIHU_RESOURCE_MATCH]
      },
      {
        resources: DOUYIN_CONTENT_MODULE_RESOURCES,
        matches: [DOUYIN_RESOURCE_MATCH]
      }
    ]),
  "web_accessible_resources must expose only approved site runtime modules"
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
  declaredPatterns.every((pattern) =>
    [
      BILIBILI_MATCH,
      ZHIHU_CONTENT_MATCH,
      ZHIHU_RESOURCE_MATCH,
      DOUYIN_CONTENT_MATCH,
      DOUYIN_RESOURCE_MATCH
    ].includes(pattern)
  ),
  "all declared URL patterns must remain within approved Bilibili/Zhihu/Douyin scopes"
);

const requiredPaths = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  "shared/messages.js",
  "content/demoRuntime.js",
  BILIBILI_CONTENT_SCRIPT_ENTRY,
  ZHIHU_CONTENT_SCRIPT_ENTRY,
  DOUYIN_CONTENT_SCRIPT_ENTRY,
  ...BILIBILI_CONTENT_MODULE_RESOURCES,
  ...ZHIHU_CONTENT_MODULE_RESOURCES,
  ...DOUYIN_CONTENT_MODULE_RESOURCES,
  "sidepanel/app.js",
  "demo/index.html",
  "demo/app.js"
];

const contentEntryPath = path.join(root, BILIBILI_CONTENT_SCRIPT_ENTRY);
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

const douyinContentEntryPath = path.join(root, DOUYIN_CONTENT_SCRIPT_ENTRY);
if (fs.existsSync(douyinContentEntryPath)) {
  const contentEntry = fs.readFileSync(douyinContentEntryPath, "utf8");
  check(
    contentEntry.includes('chrome.runtime.getURL("content/douyinRuntime.js")') &&
      contentEntry.includes("import(runtimeModuleUrl)") &&
      contentEntry.includes("startDouyinRuntime"),
    "Douyin content script entry must load the approved ES Module Runtime"
  );
}

const zhihuContentEntryPath = path.join(root, ZHIHU_CONTENT_SCRIPT_ENTRY);
if (fs.existsSync(zhihuContentEntryPath)) {
  const contentEntry = fs.readFileSync(zhihuContentEntryPath, "utf8");
  check(
    contentEntry.includes('chrome.runtime.getURL("content/zhihuRuntime.js")') &&
      contentEntry.includes("import(runtimeModuleUrl)") &&
      contentEntry.includes("startZhihuRuntime"),
    "Zhihu content script entry must load the approved ES Module Runtime"
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

const zhihuRuntimePath = path.join(root, "content/zhihuRuntime.js");
if (fs.existsSync(zhihuRuntimePath)) {
  const runtimeSource = fs.readFileSync(zhihuRuntimePath, "utf8");
  for (const requiredImport of [
    "./adapters/zhihuSearchAdapter.js",
    "./siteRuntime.js"
  ]) {
    check(
      runtimeSource.includes(requiredImport),
      `Zhihu Runtime must reuse ${requiredImport}`
    );
  }
  check(
    !/\.\/eventCollector\/|\.\/visibility\.js/u.test(runtimeSource),
    "Zhihu Runtime must delegate collectors to the shared Site Runtime"
  );
  check(
    !/localStorage|indexedDB|chrome\.storage/iu.test(runtimeSource),
    "Zhihu Runtime must not access browser storage directly"
  );
}

const douyinRuntimePath = path.join(root, "content/douyinRuntime.js");
if (fs.existsSync(douyinRuntimePath)) {
  const runtimeSource = fs.readFileSync(douyinRuntimePath, "utf8");
  for (const requiredImport of [
    "./adapters/douyinSearchAdapter.js",
    "./siteRuntime.js"
  ]) {
    check(
      runtimeSource.includes(requiredImport),
      `Douyin Runtime must reuse ${requiredImport}`
    );
  }
  check(
    !/\.\/eventCollector\/|\.\/visibility\.js/u.test(runtimeSource),
    "Douyin Runtime must delegate collectors to the shared Site Runtime"
  );
  check(
    !/localStorage|indexedDB|chrome\.storage/iu.test(runtimeSource),
    "Douyin Runtime must not access browser storage directly"
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
    !/bilibiliSearchAdapter|search\.bilibili\.com|bili-video-card|zhihuSearchAdapter|www\.zhihu\.com|ContentItem-title|douyinSearchAdapter|www\.douyin\.com|waterfall_item_/iu.test(
      runtimeSource
    ),
    "Site Runtime must not contain site Adapter imports, URLs, or selectors"
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
