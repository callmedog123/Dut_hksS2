import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_DOCS = Object.freeze([
  "README.md",
  "docs/architecture.md",
  "docs/data-contract.md",
  "docs/permissions-and-privacy.md",
  "docs/manual-browser-checklist.md"
]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml"
]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const DEBUG_ARTIFACT_EXTENSIONS = new Set([
  ".crx",
  ".har",
  ".heapsnapshot",
  ".log",
  ".trace",
  ".zip"
]);
const BILIBILI_MATCH = "https://search.bilibili.com/*";

function readJson(root, relativePath, failures) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, relativePath), "utf8")
    );
  } catch (error) {
    failures.push(`${relativePath} must exist and contain valid JSON.`);
    return null;
  }
}

function walkFiles(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).replaceAll("\\", "/")
      });
    }
  }
  return files;
}

function requireSnippet(text, snippet, file, failures) {
  if (!text.includes(snippet)) {
    failures.push(`${file} must document ${snippet}.`);
  }
}

export function validateRelease(root = process.cwd()) {
  const failures = [];
  const manifest = readJson(root, "manifest.json", failures);
  const packageJson = readJson(root, "package.json", failures);

  for (const relativePath of REQUIRED_DOCS) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      failures.push(`required release document is missing: ${relativePath}`);
    }
  }

  if (manifest !== null && packageJson !== null) {
    if (manifest.version !== packageJson.version) {
      failures.push("manifest.json and package.json versions must match.");
    }
    if (manifest.minimum_chrome_version !== "114") {
      failures.push("minimum_chrome_version must remain 114 for the frozen P0.");
    }
    if (JSON.stringify(manifest.permissions) !== JSON.stringify(["sidePanel"])) {
      failures.push("release permissions must contain only sidePanel.");
    }
    if (
      JSON.stringify(manifest.host_permissions) !==
      JSON.stringify([BILIBILI_MATCH])
    ) {
      failures.push(`release host_permissions must contain only ${BILIBILI_MATCH}.`);
    }
    if (packageJson.scripts?.test !== "node --test") {
      failures.push("package.json default test must be the full node --test entry.");
    }
    for (const dependencyGroup of ["dependencies", "devDependencies"]) {
      if (Object.keys(packageJson[dependencyGroup] ?? {}).length > 0) {
        failures.push(`${dependencyGroup} must remain empty for the dependency-free P0.`);
      }
    }
  }

  const readableDocs = new Map();
  for (const relativePath of REQUIRED_DOCS) {
    const absolutePath = path.join(root, relativePath);
    if (fs.existsSync(absolutePath)) {
      readableDocs.set(relativePath, fs.readFileSync(absolutePath, "utf8"));
    }
  }

  const readme = readableDocs.get("README.md") ?? "";
  for (const snippet of [
    "Chrome 114+",
    "chrome-extension://<扩展 ID>/demo/index.html",
    "`sidePanel`",
    BILIBILI_MATCH,
    "npm test",
    "docs/architecture.md",
    "docs/data-contract.md",
    "docs/permissions-and-privacy.md",
    "docs/manual-browser-checklist.md"
  ]) {
    requireSnippet(readme, snippet, "README.md", failures);
  }

  const privacy = readableDocs.get("docs/permissions-and-privacy.md") ?? "";
  for (const snippet of [
    "`permissions: [\"sidePanel\"]`",
    "`host_permissions: [\"https://search.bilibili.com/*\"]`",
    "清空业务数据",
    "Settings",
    "不保存什么"
  ]) {
    requireSnippet(
      privacy,
      snippet,
      "docs/permissions-and-privacy.md",
      failures
    );
  }

  const files = walkFiles(root);
  for (const { absolutePath, relativePath } of files) {
    const basename = path.basename(relativePath);
    const extension = path.extname(basename).toLowerCase();
    if (/^\.env(?:\.|$)/u.test(basename)) {
      failures.push(`environment file must not be committed: ${relativePath}`);
    }
    if (DEBUG_ARTIFACT_EXTENSIONS.has(extension)) {
      failures.push(`debug/release artifact requires explicit approval: ${relativePath}`);
    }
    if (!TEXT_EXTENSIONS.has(extension)) {
      continue;
    }

    const text = fs.readFileSync(absolutePath, "utf8");
    if (
      /[A-Za-z]:[\\/](?:Users|Documents|Desktop|Program Files|桌面)[^\r\n]*/iu.test(
        text
      ) ||
      /\/(?:Users|home)\/[A-Za-z0-9._-]+\//u.test(text)
    ) {
      failures.push(`absolute development-machine path found: ${relativePath}`);
    }
    if (
      /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password)\s*[:=]\s*["'][^"']{4,}/iu.test(
        text
      ) ||
      /(?:sk-[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/u.test(
        text
      )
    ) {
      failures.push(`possible credential found: ${relativePath}`);
    }
  }

  return failures;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const failures = validateRelease();
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Release validation failed: ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.info(
      "Release validation passed. Documentation, permissions, package scripts and repository text are consistent."
    );
  }
}

