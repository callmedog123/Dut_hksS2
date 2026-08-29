import assert from "node:assert/strict";
import {
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateRelease } from "../../scripts/validate-release.js";

const BILIBILI_MATCH = "https://search.bilibili.com/*";
const ZHIHU_CONTENT_MATCH = "https://www.zhihu.com/search*";

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function createReleaseFixture(t, overrides = {}) {
  const root = path.join(
    tmpdir(),
    `the-unclicked-release-${process.pid}-${Date.now()}-${Math.random()}`
  );
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  write(
    root,
    "manifest.json",
    JSON.stringify({
      manifest_version: 3,
      version: "0.1.0",
      minimum_chrome_version: "114",
      permissions: ["sidePanel"],
      host_permissions: [BILIBILI_MATCH],
      ...(overrides.manifest ?? {})
    })
  );
  write(
    root,
    "package.json",
    JSON.stringify({
      version: "0.1.0",
      scripts: { test: "node --test" },
      ...(overrides.packageJson ?? {})
    })
  );
  write(
    root,
    "README.md",
    [
      "Chrome 114+",
      "chrome-extension://<扩展 ID>/demo/index.html",
      "`sidePanel`",
      BILIBILI_MATCH,
      ZHIHU_CONTENT_MATCH,
      "npm test",
      "docs/architecture.md",
      "docs/data-contract.md",
      "docs/permissions-and-privacy.md",
      "docs/manual-browser-checklist.md"
    ].join("\n")
  );
  write(root, "docs/architecture.md", "# Architecture\n");
  write(root, "docs/data-contract.md", "# Data contract\n");
  write(
    root,
    "docs/permissions-and-privacy.md",
    [
      '`permissions: ["sidePanel"]`',
      '`host_permissions: ["https://search.bilibili.com/*"]`',
      ZHIHU_CONTENT_MATCH,
      "清空业务数据",
      "Settings",
      "不保存什么"
    ].join("\n")
  );
  write(root, "docs/manual-browser-checklist.md", "# Checklist\n");
  return root;
}

test("release validation accepts a complete, permission-aligned fixture", (t) => {
  const root = createReleaseFixture(t);
  assert.deepEqual(validateRelease(root), []);
});

test("release validation requires npm test to run the full suite", (t) => {
  const root = createReleaseFixture(t, {
    packageJson: { scripts: { test: "node --test tests/messages.test.js" } }
  });
  assert.ok(
    validateRelease(root).some((failure) => /default test/u.test(failure))
  );
});

test("release validation rejects a second host permission", (t) => {
  const root = createReleaseFixture(t, {
    manifest: {
      host_permissions: [BILIBILI_MATCH, "https://www.bilibili.com/*"]
    }
  });
  assert.ok(
    validateRelease(root).some((failure) => /host_permissions/u.test(failure))
  );
});

test("release validation detects environment, credential and machine-path leaks", (t) => {
  const root = createReleaseFixture(t);
  write(root, ".env.local", "placeholder only");
  write(
    root,
    "debug.txt",
    `${["api", "key"].join("_")} = "example-secret-value"`
  );
  write(
    root,
    "notes.txt",
    `Opened from ${["C:", "Users", "example", "Desktop", "workspace"].join("/")}`
  );

  const failures = validateRelease(root);
  assert.ok(failures.some((failure) => /environment file/u.test(failure)));
  assert.ok(failures.some((failure) => /possible credential/u.test(failure)));
  assert.ok(failures.some((failure) => /absolute development-machine path/u.test(failure)));
});
