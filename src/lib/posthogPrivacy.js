const EMAIL_KEYS = /^(email|e-mail|correo|name|full_name|\$name|\$email)$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripValue(key, value) {
  if (EMAIL_KEYS.test(String(key))) return undefined;
  if (typeof value === "string" && EMAIL_VALUE.test(value.trim())) return undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return stripPropertyBag(value);
  }
  return value;
}

export function stripPropertyBag(properties) {
  if (!properties || typeof properties !== "object") return properties;
  const out = {};
  for (const [key, value] of Object.entries(properties)) {
    const next = stripValue(key, value);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

/** Quita correo, nombre y otros identificadores personales de un evento de PostHog. */
export function stripPersonalFromPosthogEvent(event) {
  if (!event || typeof event !== "object") return event;
  const next = { ...event };
  if (next.properties) next.properties = stripPropertyBag(next.properties);
  return next;
}

/**
 * identify solo con el id. No acepta propiedades: el correo no debe viajar ni como $set.
 */
export function identifyPosthogUser(client, userId) {
  if (!client || typeof client.identify !== "function") return;
  const id = userId == null ? "" : String(userId).trim();
  if (!id) return;
  client.identify(id);
}

export function posthogInitOptions() {
  return {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    before_send: stripPersonalFromPosthogEvent,
  };
}
