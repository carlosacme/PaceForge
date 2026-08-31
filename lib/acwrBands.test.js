import { test } from "node:test";
import assert from "node:assert/strict";
import { acwrBandFromRatio, acwrGaugePercent, COLOR_AMBER, COLOR_GREEN, COLOR_YELLOW, COLOR_RED, COLOR_GRAY } from "./acwrBands.js";

test("bandas ACWR: 0.8-1.3 seguro, 1.3-1.5 precaución, >1.5 sobrecarga", () => {
  assert.equal(acwrBandFromRatio(null).key, "none");
  assert.equal(acwrBandFromRatio(null).color, COLOR_GRAY);
  assert.equal(acwrBandFromRatio(0.79).label, "Desentrenado");
  assert.equal(acwrBandFromRatio(0.79).color, COLOR_AMBER);
  assert.equal(acwrBandFromRatio(0.8).label, "Óptimo");
  assert.equal(acwrBandFromRatio(0.8).color, COLOR_GREEN);
  assert.equal(acwrBandFromRatio(1.3).label, "Óptimo");
  assert.equal(acwrBandFromRatio(1.31).label, "Precaución");
  assert.equal(acwrBandFromRatio(1.31).color, COLOR_YELLOW);
  assert.equal(acwrBandFromRatio(1.5).label, "Precaución");
  assert.equal(acwrBandFromRatio(1.51).label, "Sobreentrenado");
  assert.equal(acwrBandFromRatio(1.51).color, COLOR_RED);
});

test("el atleta no necesita el número: el label cubre las 4 bandas", () => {
  const labels = [0.5, 1.0, 1.4, 1.7].map((r) => acwrBandFromRatio(r).label);
  assert.deepEqual(labels, ["Desentrenado", "Óptimo", "Precaución", "Sobreentrenado"]);
});

test("gauge 0–2: 1.5 cae en 75%", () => {
  assert.equal(acwrGaugePercent(0.8), 40);
  assert.equal(acwrGaugePercent(1.3), 65);
  assert.equal(acwrGaugePercent(1.5), 75);
  assert.equal(acwrGaugePercent(2), 100);
  assert.equal(acwrGaugePercent(3), 100);
});
