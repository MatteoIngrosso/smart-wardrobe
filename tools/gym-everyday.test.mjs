// Gym clothes in Everyday outfits, on a real wardrobe backup (not in the repo):
//   WARDROBE_BACKUP=<backup.json> node --test tools/gym-everyday.test.mjs
// Skipped without one. The checks themselves are in gym-everyday.eval.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), backup = process.env.WARDROBE_BACKUP;
test("gym clothes in Everyday outfits", { skip: !backup || !existsSync(backup) ? "set WARDROBE_BACKUP to a backup .json" : false, timeout: 900000 }, () => {
  const out = execFileSync(process.execPath, [join(here, "audit-sim.mjs"), backup, "--runs", "0", "--eval", join(here, "gym-everyday.eval.js")], { encoding: "utf8", maxBuffer: 1 << 24 });
  const lines = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));
  for (const l of lines) console.log(l);
  assert.ok(lines.length >= 12, "all checks ran");
  assert.deepEqual(lines.filter((l) => l.startsWith("FAIL")), []);
});
