import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validatorPath = path.resolve("scripts/validate-build.js");

function createBuildFixture(t, hostPermissions) {
  const root = path.join(
    tmpdir(),
    `the-unclicked-build-${process.pid}-${Date.now()}-${Math.random()}`
  );
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const manifest = {
    manifest_version: 3,
    permissions: ["sidePanel"],
    host_permissions: hostPermissions,
    background: { service_worker: "background/serviceWorker.js" },
    side_panel: { default_path: "sidepanel/index.html" }
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
    "sidepanel/app.js",
    "demo/index.html",
    "demo/app.js"
  ]) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "", "utf8");
  }

  return root;
}

test("build validation accepts only the approved Bilibili search permission", (t) => {
  const root = createBuildFixture(t, ["https://search.bilibili.com/*"]);
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
});

test("build validation rejects any additional host permission", (t) => {
  const root = createBuildFixture(t, [
    "https://search.bilibili.com/*",
    "https://www.bilibili.com/*"
  ]);
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
