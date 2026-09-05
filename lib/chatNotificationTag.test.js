import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_TRAY_TAG_PREFIX,
  isChatPushType,
  isChatTrayTag,
  androidChatNotificationTag,
} from "./chatNotificationTag.js";

test("solo athlete_chat y coach_chat llevan tag de chat", () => {
  assert.equal(isChatPushType("athlete_chat"), true);
  assert.equal(isChatPushType("coach_chat"), true);
  assert.equal(isChatPushType("athlete_calendar"), false);
  assert.equal(androidChatNotificationTag({ type: "athlete_calendar" }), null);
  assert.equal(androidChatNotificationTag({}), null);
});

test("tag unico por mensaje, prefijo chat:, no el tag compartido", () => {
  const a = androidChatNotificationTag(
    { type: "athlete_chat", athlete_id: "85" },
    () => 1,
    () => 0.123456,
  );
  const b = androidChatNotificationTag(
    { type: "athlete_chat", athlete_id: "85" },
    () => 2,
    () => 0.654321,
  );
  assert.ok(a.startsWith(`${CHAT_TRAY_TAG_PREFIX}85:`));
  assert.ok(b.startsWith(`${CHAT_TRAY_TAG_PREFIX}85:`));
  assert.notEqual(a, b);
  assert.notEqual(a, "chat");
  assert.notEqual(a, "athlete_chat");
});

test("message_id gana sobre el aleatorio", () => {
  assert.equal(
    androidChatNotificationTag({ type: "coach_chat", athlete_id: "85", message_id: "m1" }),
    "chat:85:m1",
  );
});

test("isChatTrayTag no acepta el auto-tag de FCM ni el aggregate del sistema", () => {
  assert.equal(isChatTrayTag("chat:85:abc"), true);
  assert.equal(isChatTrayTag("FCM-Notification:77824858"), false);
  assert.equal(isChatTrayTag("0|com.runningapexflow.app|g:Aggregate_NormalNotificationSection"), false);
  assert.equal(isChatTrayTag(null), false);
});
