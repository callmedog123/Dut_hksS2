import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const htmlSource = readFileSync("demo/index.html", "utf8");
const appSource = readFileSync("demo/app.js", "utf8");
const runtimeSource = readFileSync("content/demoRuntime.js", "utf8");

test("Demo exposes explicit advance/finalize controls and one dynamic candidate template", () => {
  assert.match(htmlSource, /id="advance-scenario-button"/u);
  assert.match(htmlSource, /id="finalize-session-button"/u);
  assert.match(htmlSource, /id="dynamic-candidate-template"/u);
  assert.match(htmlSource, /data-candidate-id="demo-candidate-003"/u);
  assert.match(appSource, /advanceScenario\("demo-candidate-002"\)/u);
  assert.match(appSource, /demoRuntime\.finalizeSession\(\)/u);
  assert.match(appSource, /data-demo-session-id/u);
  assert.match(appSource, /crypto\?\.randomUUID/u);
});

test("Demo renders real working/success/error states and never accesses storage", () => {
  for (const state of ["working", "success", "error"]) {
    assert.match(appSource, new RegExp(`data-state\", \"${state}`, "u"));
  }
  assert.doesNotMatch(
    `${appSource}\n${runtimeSource}`,
    /localStorage|indexedDB|chrome\.storage/iu
  );
  assert.doesNotMatch(
    `${appSource}\n${runtimeSource}`,
    /preventDefault\s*\(/u
  );
});

test("Demo app imports the module Runtime and keeps the page script modular", () => {
  assert.match(
    appSource,
    /from "\.\.\/content\/demoRuntime\.js"/u
  );
  assert.match(
    htmlSource,
    /<script\s+type="module"\s+src="\.\/app\.js"><\/script>/u
  );
});
