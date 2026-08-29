import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validatorPath = path.resolve("scripts/validate-build.js");
const BILIBILI_MATCH = "https://search.bilibili.com/*";
const ZHIHU_CONTENT_MATCH = "https://www.zhihu.com/search*";
const ZHIHU_RESOURCE_MATCH = "https://www.zhihu.com/*";
const SHARED_RESOURCES = [
  "content/candidateBinding.js",
  "content/eventCollector/click.js",
  "content/eventCollector/hover.js",
  "content/visibility.js",
  "shared/messages.js",
  "shared/types.js",
  "shared/url.js"
];
const BILIBILI_RESOURCES = [
  "content/bilibiliRuntime.js",
  "content/siteRuntime.js",
  "content/adapters/bilibiliSearchAdapter.js",
  ...SHARED_RESOURCES
];
const ZHIHU_RESOURCES = [
  "content/zhihuRuntime.js",
  "content/siteRuntime.js",
  "content/adapters/zhihuSearchAdapter.js",
  ...SHARED_RESOURCES
];

function createBuildFixture(t, overrides = {}) {
  const root = path.join(
    tmpdir(),
    `the-unclicked-build-${process.pid}-${Date.now()}-${Math.random()}`
  );
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const manifest = {
    manifest_version: 3,
    permissions: ["sidePanel"],
    host_permissions: [BILIBILI_MATCH],
    content_scripts: [
      {
        matches: [BILIBILI_MATCH],
        js: ["content/contentScript.js"],
        run_at: "document_idle"
      },
      {
        matches: [ZHIHU_CONTENT_MATCH],
        js: ["content/zhihuContentScript.js"],
        run_at: "document_idle"
      }
    ],
    web_accessible_resources: [
      {
        resources: BILIBILI_RESOURCES,
        matches: [BILIBILI_MATCH]
      },
      {
        resources: ZHIHU_RESOURCES,
        matches: [ZHIHU_RESOURCE_MATCH]
      }
    ],
    background: { service_worker: "background/serviceWorker.js" },
    side_panel: { default_path: "sidepanel/index.html" },
    ...overrides
  };
  writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify(manifest),
    "utf8"
  );

  for (const relativePath of [
    "background/serviceWorker.js",
    "sidepanel/index.html",
    "shared/messages.js",
    "content/demoRuntime.js",
    "content/contentScript.js",
    "content/zhihuContentScript.js",
    ...BILIBILI_RESOURCES,
    ...ZHIHU_RESOURCES,
    "sidepanel/app.js",
    "demo/index.html",
    "demo/app.js"
  ]) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "", "utf8");
  }
  writeFileSync(
    path.join(root, "demo/app.js"),
    'import "../content/demoRuntime.js";',
    "utf8"
  );
  writeFileSync(
    path.join(root, "content/contentScript.js"),
    'const runtimeModuleUrl = chrome.runtime.getURL("content/bilibiliRuntime.js"); import(runtimeModuleUrl).then(({ startBilibiliRuntime }) => startBilibiliRuntime());',
    "utf8"
  );
  writeFileSync(
    path.join(root, "content/zhihuContentScript.js"),
    'const runtimeModuleUrl = chrome.runtime.getURL("content/zhihuRuntime.js"); import(runtimeModuleUrl).then(({ startZhihuRuntime }) => startZhihuRuntime());',
    "utf8"
  );
  writeFileSync(
    path.join(root, "content/zhihuRuntime.js"),
    [
      'import "./adapters/zhihuSearchAdapter.js";',
      'import "./siteRuntime.js";'
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    path.join(root, "content/bilibiliRuntime.js"),
    [
      'import "./adapters/bilibiliSearchAdapter.js";',
      'import "./siteRuntime.js";'
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    path.join(root, "content/siteRuntime.js"),
    [
      'import "./eventCollector/click.js";',
      'import "./eventCollector/hover.js";',
      'import "./visibility.js";',
      "const adapter = options.createAdapter();"
    ].join("\n"),
    "utf8"
  );

  return root;
}

test("build validation accepts Bilibili plus the approved Zhihu search scope", (t) => {
  const root = createBuildFixture(t);
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
});

test("build validation rejects any additional host permission", (t) => {
  const root = createBuildFixture(t, {
    host_permissions: [BILIBILI_MATCH, "https://www.bilibili.com/*"]
  });
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /host_permissions must contain only https:\/\/search\.bilibili\.com\/\*/u
  );
});

test("build validation rejects broad content script matches", (t) => {
  const root = createBuildFixture(t, {
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["content/contentScript.js"],
        run_at: "document_idle"
      }
    ]
  });
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact Bilibili and approved Zhihu search entries/u);
});

test("build validation rejects an unapproved third content script entry", (t) => {
  const root = createBuildFixture(t, {
    content_scripts: [
      {
        matches: [BILIBILI_MATCH],
        js: ["content/contentScript.js"],
        run_at: "document_idle"
      },
      {
        matches: [ZHIHU_CONTENT_MATCH],
        js: ["content/zhihuContentScript.js"],
        run_at: "document_idle"
      },
      {
        matches: ["https://example.com/*"],
        js: ["content/zhihuContentScript.js"],
        run_at: "document_idle"
      }
    ]
  });
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact Bilibili and approved Zhihu search entries/u);
});

test("build validation rejects a Zhihu host permission", (t) => {
  const root = createBuildFixture(t, {
    host_permissions: [BILIBILI_MATCH, ZHIHU_RESOURCE_MATCH]
  });
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /host_permissions must contain only/u);
});

test("build validation rejects a broad Zhihu web-accessible scope", (t) => {
  const root = createBuildFixture(t, {
    web_accessible_resources: [
      { resources: BILIBILI_RESOURCES, matches: [BILIBILI_MATCH] },
      { resources: ZHIHU_RESOURCES, matches: ["<all_urls>"] }
    ]
  });
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /approved site runtime modules/u);
});

test("build validation rejects collectors left in the Bilibili wrapper", (t) => {
  const root = createBuildFixture(t);
  writeFileSync(
    path.join(root, "content/bilibiliRuntime.js"),
    [
      'import "./adapters/bilibiliSearchAdapter.js";',
      'import "./siteRuntime.js";',
      'import "./eventCollector/click.js";'
    ].join("\n"),
    "utf8"
  );

  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /delegate collectors to the shared Site Runtime/u);
});

test("build validation rejects site DOM knowledge in Site Runtime", (t) => {
  const root = createBuildFixture(t);
  writeFileSync(
    path.join(root, "content/siteRuntime.js"),
    [
      'import "./eventCollector/click.js";',
      'import "./eventCollector/hover.js";',
      'import "./visibility.js";',
      'import "./adapters/bilibiliSearchAdapter.js";',
      "const adapter = options.createAdapter();"
    ].join("\n"),
    "utf8"
  );

  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not contain site Adapter imports/u);
});
