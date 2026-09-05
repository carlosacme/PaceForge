import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isChatPushType,
  notificationPushType,
  filterDeliveredChatNotifications,
  describeDeliveredNotifications,
} from "./chatPushNotifications.js";

test("solo athlete_chat y coach_chat son chat", () => {
  assert.equal(isChatPushType("athlete_chat"), true);
  assert.equal(isChatPushType("coach_chat"), true);
  assert.equal(isChatPushType("coach_workout_completed"), false);
  assert.equal(isChatPushType("athlete_workout_reminder"), false);
  assert.equal(isChatPushType(""), false);
  assert.equal(isChatPushType(undefined), false);
});

test("lee type desde data, con fallback al top-level", () => {
  assert.equal(notificationPushType({ data: { type: "athlete_chat" } }), "athlete_chat");
  assert.equal(notificationPushType({ type: "coach_chat" }), "coach_chat");
  assert.equal(notificationPushType({ data: { title: "Hola" } }), "");
  assert.equal(notificationPushType(null), "");
});

test("deja solo las de chat y no toca entrenos ni racha", () => {
  const delivered = [
    { id: "1", data: { type: "athlete_chat" } },
    { id: "2", data: { type: "coach_workout_completed" } },
    { id: "3", data: { type: "coach_chat", athlete_id: "abc" } },
    { id: "4", data: { type: "athlete_streak" } },
    { id: "5", data: {} },
  ];
  const chat = filterDeliveredChatNotifications(delivered);
  assert.deepEqual(chat.map((n) => n.id), ["1", "3"]);
});

test("lista vacia o invalida no rompe", () => {
  assert.deepEqual(filterDeliveredChatNotifications([]), []);
  assert.deepEqual(filterDeliveredChatNotifications(null), []);
  assert.deepEqual(filterDeliveredChatNotifications(undefined), []);
});

test("extras de bandeja FCM (sin data.type) no coinciden con athlete_chat", () => {
  const tray = [
    {
      id: 0,
      tag: null,
      data: { "android.title": "Nuevo mensaje", "android.text": "Hola", "android.showWhen": true },
    },
  ];
  assert.equal(notificationPushType(tray[0]), "");
  assert.deepEqual(filterDeliveredChatNotifications(tray), []);
  assert.deepEqual(describeDeliveredNotifications(tray)[0].dataKeys, [
    "android.title",
    "android.text",
    "android.showWhen",
  ]);
});
