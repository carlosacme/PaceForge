import { test } from "node:test";
import assert from "node:assert/strict";
import { readyServiceWorker } from "./readyServiceWorker.js";

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test("primera visita: SW que tarda más que el tope no registra", async () => {
  const fakeReg = { scope: "/slow" };
  const sw = { ready: delay(200, fakeReg) };
  const t0 = Date.now();
  const reg = await readyServiceWorker(80, sw);
  const elapsed = Date.now() - t0;
  assert.equal(reg, null);
  assert.ok(elapsed < 180, `debía cortar ~80ms, tardó ${elapsed}ms`);
});

test("siguiente carga: SW ya ready entrega el registro", async () => {
  const fakeReg = { scope: "/ready" };
  const sw = { ready: Promise.resolve(fakeReg) };
  const reg = await readyServiceWorker(80, sw);
  assert.equal(reg, fakeReg);
});

test("ready que rechaza no cuelga: null", async () => {
  const sw = { ready: Promise.reject(new Error("sw failed")) };
  const reg = await readyServiceWorker(80, sw);
  assert.equal(reg, null);
});

test("sin serviceWorker: null", async () => {
  assert.equal(await readyServiceWorker(80, undefined), null);
});
