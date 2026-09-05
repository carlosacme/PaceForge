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

test("deja solo tags chat: y no toca FCM auto-tag ni el aggregate", () => {
  const delivered = [
    { id: "1", tag: "chat:85:aaa", data: { "android.title": "Hola" } },
    { id: "2", tag: "FCM-Notification:77824858", data: { "android.title": "Entreno" } },
    { id: "3", tag: "chat:85:bbb", data: { "android.title": "Otro" } },
    { id: "4", tag: "0|com.runningapexflow.app|g:Aggregate_NormalNotificationSection", data: {} },
    { id: "5", tag: null, data: { type: "athlete_chat" } },
  ];
  const chat = filterDeliveredChatNotifications(delivered);
  assert.deepEqual(chat.map((n) => n.id), ["1", "3"]);
});

test("lista vacia o invalida no rompe", () => {
  assert.deepEqual(filterDeliveredChatNotifications([]), []);
  assert.deepEqual(filterDeliveredChatNotifications(null), []);
  assert.deepEqual(filterDeliveredChatNotifications(undefined), []);
});

test("bandeja FCM sin tag chat: no coincide aunque data.type viniera (no viene)", () => {
  const tray = [
    {
      id: 0,
      tag: "FCM-Notification:77824858",
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
