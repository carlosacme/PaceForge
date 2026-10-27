import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyPosthogUser,
  posthogInitOptions,
  stripPersonalFromPosthogEvent,
} from "./posthogPrivacy.js";

test("identify solo recibe el id de usuario", () => {
  const calls = [];
  const client = {
    identify: (...args) => calls.push(args),
  };
  identifyPosthogUser(client, "user-1");
  assert.deepEqual(calls, [["user-1"]]);
  assert.equal(calls[0].length, 1);
});

test("identify vacío no llama al cliente", () => {
  const calls = [];
  identifyPosthogUser({ identify: (...args) => calls.push(args) }, "  ");
  identifyPosthogUser(null, "user-1");
  assert.deepEqual(calls, []);
});

test("ningún evento conserva correo ni nombre", () => {
  const cleaned = stripPersonalFromPosthogEvent({
    event: "$identify",
    properties: {
      distinct_id: "user-1",
      $current_url: "https://www.runningapexflow.com/",
      email: "atleta@example.com",
      name: "Ana",
      token: "coach@example.com",
      $set: { email: "atleta@example.com", full_name: "Ana", role: "athlete" },
    },
  });
  assert.equal(cleaned.properties.distinct_id, "user-1");
  assert.equal(cleaned.properties.$current_url, "https://www.runningapexflow.com/");
  assert.equal(cleaned.properties.email, undefined);
  assert.equal(cleaned.properties.name, undefined);
  assert.equal(cleaned.properties.token, undefined);
  assert.deepEqual(cleaned.properties.$set, { role: "athlete" });
  assert.equal(JSON.stringify(cleaned).includes("atleta@example.com"), false);
  assert.equal(JSON.stringify(cleaned).includes("coach@example.com"), false);
});

test("la config de arranque no declara propiedades personales y filtra el correo", () => {
  const options = posthogInitOptions();
  assert.equal(options.person_profiles, "identified_only");
  assert.equal(JSON.stringify(options).includes("email"), false);
  const event = options.before_send({
    event: "$pageview",
    properties: { email: "a@b.co", path: "/login" },
  });
  assert.deepEqual(event.properties, { path: "/login" });
});
