import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "./paths.js";
import { deriveSlug, storeHome, storeProjectDir } from "./state.js";

function git(path, args) {
  try {
    return execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return null; }
}

// Diagnostics are read-only and never include environment values or credentials.
export function installationDiagnostics(targetPath = process.cwd()) {
  const installation = realpathSync(ROOT);
  const target = resolve(targetPath);
  const slug = deriveSlug(target);
  const status = git(installation, ["status", "--porcelain"]);
  return {
    node: process.version,
    executable: process.execPath,
    cli: realpathSync(join(installation, "src", "cli.js")),
    installation,
    version: JSON.parse(readFileSync(join(installation, "package.json"), "utf8")).version,
    revision: git(installation, ["rev-parse", "HEAD"]),
    dirty: status === null ? null : status.length > 0,
    target,
    project_slug: slug,
    store_home: storeHome(),
    project_store: storeProjectDir(slug),
  };
}
