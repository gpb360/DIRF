// @ts-check
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} folder @returns {string[]} */
function scripts(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? scripts(path) : /\.(?:c|m)?js$/.test(entry.name) ? [path] : [];
  });
}
const files = ["src", "scripts", "skills", "workflows", "tests"].flatMap((folder) => scripts(join(root, folder)));
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "pipe", windowsHide: true });
console.log(`JavaScript syntax passed: ${files.length} files`);
