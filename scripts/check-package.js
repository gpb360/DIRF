// @ts-check
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublicationBoundary } from "../src/publication-boundary.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this check with npm run check:package");
const output = execFileSync(process.execPath, [npm, "pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024,
});
/** @type {{files: {path: string}[], entryCount: number}[]} */
const packages = JSON.parse(output);
if (packages.length !== 1 || !packages[0].files?.length) throw new Error("npm returned no package manifest");
const errors = validatePublicationBoundary(root, packages[0].files.map((file) => file.path));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`Package boundary passed: ${packages[0].entryCount} files`);
