/**
 * Windows Vitest workaround: lowercase drive letters in cwd make Vitest load
 * two module instances (`d:` vs `D:`), so describe() throws reading `.config`.
 * Canonicalize cwd before spawning Vitest.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cwd = fs.realpathSync.native(root);
const args = ["vitest", ...process.argv.slice(2), "--pool=forks"];
const result = spawnSync("npx", args, { cwd, stdio: "inherit", shell: true, env: process.env });
process.exit(result.status ?? 1);
