import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCS = ["public/privacy.html", "public/terms.html"];

test("la política y los términos no dejan marcadores por definir", () => {
  for (const rel of DOCS) {
    const html = readFileSync(join(process.cwd(), rel), "utf8");
    const placeholder = ["POR", "DEFINIR"].join(" ");
    assert.equal(html.includes(placeholder), false, rel);
    assert.equal(/class\s*=\s*["']todo["']/.test(html), false, `${rel} class=todo`);
    assert.equal(html.includes("mark.todo"), false, `${rel} mark.todo`);
  }
});
