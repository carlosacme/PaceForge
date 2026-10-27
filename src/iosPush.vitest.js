import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ name: "web" }));
const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ receive: "prompt" })),
  requestPermissions: vi.fn(async () => ({ receive: "granted" })),
  register: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
  createChannel: vi.fn(async () => {}),
}));
const webPush = vi.hoisted(() => ({
  requestNotificationPermission: vi.fn(async () => "web-token"),
  registerFcmToken: vi.fn(async () => {}),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => platform.name,
    isNativePlatform: () => platform.name === "ios" || platform.name === "android",
  },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: push,
}));

vi.mock("./lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

vi.mock("./lib/fcmClient", () => ({
  registerFcmTokenDetailed: vi.fn(),
  readOwnFcmToken: vi.fn(),
  readOwnDeviceTokens: vi.fn(),
  registerFcmToken: (...args) => webPush.registerFcmToken(...args),
}));

vi.mock("./lib/chatPushNotifications", () => ({
  describeDeliveredNotifications: vi.fn(),
  filterDeliveredChatNotifications: vi.fn(),
  isChatPushType: vi.fn(),
}));

vi.mock("./firebase.js", () => ({
  requestNotificationPermission: (...args) => webPush.requestNotificationPermission(...args),
}));

const { registerNativePush } = await import("./lib/nativePush.js");
const { registerPushAfterLogin } = await import("./lib/registerPushAfterLogin.js");

function resetCalls() {
  push.checkPermissions.mockClear();
  push.requestPermissions.mockClear();
  push.register.mockClear();
  push.addListener.mockClear();
  push.createChannel.mockClear();
  webPush.requestNotificationPermission.mockClear();
  webPush.registerFcmToken.mockClear();
}

describe("push en iOS", () => {
  beforeEach(() => {
    platform.name = "web";
    resetCalls();
  });

  it("en iOS registerNativePush no pide permiso ni registra el token", async () => {
    platform.name = "ios";
    const notify = vi.fn();
    await expect(registerNativePush({ notify })).resolves.toBe(false);
    expect(push.checkPermissions).not.toHaveBeenCalled();
    expect(push.requestPermissions).not.toHaveBeenCalled();
    expect(push.register).not.toHaveBeenCalled();
    expect(push.addListener).not.toHaveBeenCalled();
    expect(push.createChannel).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("en iOS registerPushAfterLogin sale sin pedir permiso ni token", async () => {
    platform.name = "ios";
    await registerPushAfterLogin(vi.fn());
    expect(push.checkPermissions).not.toHaveBeenCalled();
    expect(push.requestPermissions).not.toHaveBeenCalled();
    expect(push.register).not.toHaveBeenCalled();
    expect(webPush.requestNotificationPermission).not.toHaveBeenCalled();
    expect(webPush.registerFcmToken).not.toHaveBeenCalled();
  });

  it("en Android registerNativePush sigue pidiendo permiso y registrando", async () => {
    platform.name = "android";
    await expect(registerNativePush()).resolves.toBe(true);
    expect(push.checkPermissions).toHaveBeenCalled();
    expect(push.requestPermissions).toHaveBeenCalled();
    expect(push.register).toHaveBeenCalled();
  });

  it("en web registerNativePush no toca el plugin y el login sigue por FCM web", async () => {
    platform.name = "web";
    await expect(registerNativePush()).resolves.toBe(false);
    expect(push.register).not.toHaveBeenCalled();
    await registerPushAfterLogin(vi.fn());
    expect(webPush.requestNotificationPermission).toHaveBeenCalled();
    expect(webPush.registerFcmToken).toHaveBeenCalledWith("web-token");
    expect(push.register).not.toHaveBeenCalled();
  });
});
