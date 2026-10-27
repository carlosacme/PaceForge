import test from "node:test";
import assert from "node:assert/strict";
import { TERMS_VERSION, signupUserData } from "./signupConsent.js";

test("el registro guarda la aceptación de términos sin el correo", () => {
  const data = signupUserData({
    fullName: " Ana ",
    role: "athlete",
    coachId: null,
    now: new Date("2026-10-26T15:00:00.000Z"),
  });
  assert.equal(data.full_name, "Ana");
  assert.equal(data.role, "athlete");
  assert.equal(data.coach_id, null);
  assert.equal(data.terms_accepted_at, "2026-10-26T15:00:00.000Z");
  assert.equal(data.terms_version, TERMS_VERSION);
  assert.equal(data.terms_version, "2026-10");
  assert.equal("email" in data, false);
});
