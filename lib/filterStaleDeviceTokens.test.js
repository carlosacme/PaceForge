import { test } from "node:test";
import assert from "node:assert/strict";
import { filterStaleDeviceTokens } from "./filterStaleDeviceTokens.js";

const now = Date.parse("2026-09-05T18:00:00Z");
const daysAgo = (d) => new Date(now - d * 86400 * 1000).toISOString();

const tok = (tail, platform, ageDays) => ({
  token: `tok-${tail}`,
  platform,
  last_seen_at: ageDays == null ? null : daysAgo(ageDays),
});

test("el único token de una plataforma se conserva aunque sea viejo", () => {
  const rows = [tok("old", "android", 40)];
  const out = filterStaleDeviceTokens(rows, now);
  assert.equal(out.length, 1);
  assert.equal(out[0].token, "tok-old");
});

test("android fresco + android >21 días: se omite el viejo", () => {
  const rows = [tok("new", "android", 0), tok("old", "android", 30)];
  const out = filterStaleDeviceTokens(rows, now);
  assert.deepEqual(out.map((r) => r.token), ["tok-new"]);
});

test("web no tumba android ni al revés", () => {
  const rows = [tok("phone", "android", 0), tok("browser", "web", 40)];
  const out = filterStaleDeviceTokens(rows, now);
  assert.equal(out.length, 2);
});

test("sin hermano ≤7 días no se omite el de 30 días", () => {
  const rows = [tok("mid", "android", 10), tok("old", "android", 30)];
  const out = filterStaleDeviceTokens(rows, now);
  assert.equal(out.length, 2);
});

test("token entre 8 y 21 días se sigue enviando", () => {
  const rows = [tok("fresh", "android", 1), tok("mid", "android", 14)];
  const out = filterStaleDeviceTokens(rows, now);
  assert.equal(out.length, 2);
});

test("sin last_seen no se omite", () => {
  const rows = [tok("fresh", "android", 1), tok("unk", "android", null)];
  const out = filterStaleDeviceTokens(rows, now);
  assert.equal(out.length, 2);
});
