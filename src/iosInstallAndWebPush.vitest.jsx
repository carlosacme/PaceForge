import React from "react";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstallAppButton from "./components/InstallAppButton";
import InstallPwaBanner from "./components/InstallPwaBanner";
import PushInviteBanner from "./components/PushInviteBanner";

const platform = vi.hoisted(() => ({ name: "web" }));
const fcm = vi.hoisted(() => ({
  getMessaging: vi.fn(() => ({ name: "messaging" })),
  getToken: vi.fn(async () => "web-token"),
  deleteToken: vi.fn(async () => true),
  onMessage: vi.fn(() => () => {}),
  isSupported: vi.fn(async () => true),
}));
const push = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ receive: "prompt" })),
  requestPermissions: vi.fn(async () => ({ receive: "prompt" })),
  register: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
  createChannel: vi.fn(async () => {}),
  removeDeliveredNotifications: vi.fn(async () => {}),
  getDeliveredNotifications: vi.fn(async () => ({ notifications: [] })),
}));
const savedToken = vi.hoisted(() => ({
  registerFcmToken: vi.fn(async () => true),
}));
const notificationApi = vi.hoisted(() => ({
  permission: "default",
  requestPermission: vi.fn(async () => "granted"),
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

vi.mock("firebase/app", () => ({
  initializeApp: () => ({ name: "test-app" }),
}));

vi.mock("firebase/messaging", () => ({
  getMessaging: (...args) => fcm.getMessaging(...args),
  getToken: (...args) => fcm.getToken(...args),
  deleteToken: (...args) => fcm.deleteToken(...args),
  onMessage: (...args) => fcm.onMessage(...args),
  isSupported: (...args) => fcm.isSupported(...args),
}));

vi.mock("./lib/readyServiceWorker.js", () => ({
  readyServiceWorker: vi.fn(async () => ({ scope: "/" })),
}));

vi.mock("./lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

vi.mock("./lib/fcmClient", () => ({
  registerFcmTokenDetailed: vi.fn(),
  readOwnFcmToken: vi.fn(),
  readOwnDeviceTokens: vi.fn(),
  registerFcmToken: (...args) => savedToken.registerFcmToken(...args),
}));

vi.mock("./components/shared/appShared", () => ({
  registerFcmToken: (...args) => savedToken.registerFcmToken(...args),
}));

const { requestNotificationPermission, refreshFcmTokenIfGranted } = await import("./lib/firebaseMessaging.js");
const { useCoachPushDeepLinks } = await import("./hooks/useCoachPushDeepLinks.js");

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile";

function setUa(ua) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

function installPromptEvent() {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = vi.fn();
  event.userChoice = Promise.resolve({ outcome: "dismissed" });
  return event;
}

function coachPushArgs() {
  return {
    session: { user: { id: "user-1" } },
    authLoading: false,
    profile: { role: "coach", user_id: "user-1" },
    athletes: [],
    notify: vi.fn(),
    setView: vi.fn(),
    setSelectedAthlete: vi.fn(),
    setViewRestored: vi.fn(),
    setPendingRegistroWorkoutId: vi.fn(),
  };
}

describe("instalación PWA y push web fuera de la app iOS", () => {
  beforeEach(() => {
    platform.name = "web";
    setUa(ANDROID_UA);
    notificationApi.permission = "default";
    notificationApi.requestPermission.mockClear();
    notificationApi.requestPermission.mockImplementation(async () => {
      notificationApi.permission = "granted";
      return "granted";
    });
    globalThis.Notification = notificationApi;
    fcm.getToken.mockClear();
    fcm.isSupported.mockClear();
    fcm.getMessaging.mockClear();
    push.checkPermissions.mockClear();
    push.requestPermissions.mockClear();
    push.register.mockClear();
    savedToken.registerFcmToken.mockClear();
    localStorage.removeItem("raf_push_invite_dismissed");
    delete window.__deferredInstallPrompt;
    if (typeof window.matchMedia !== "function") {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("en iOS oculta el botón de instalar y el texto de pantalla de inicio", () => {
    platform.name = "ios";
    setUa(IPHONE_UA);
    window.__deferredInstallPrompt = { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: "accepted" }) };
    render(<InstallAppButton />);
    expect(screen.queryByText(/Instalar app en tu teléfono/)).toBeNull();
    expect(screen.queryByText(/pantalla de inicio/i)).toBeNull();
    expect(screen.queryByText(/Añadir a pantalla de inicio/)).toBeNull();
  });

  it("en Android el botón de instalar sigue disponible si hay prompt", async () => {
    platform.name = "android";
    setUa(ANDROID_UA);
    window.__deferredInstallPrompt = { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: "accepted" }) };
    render(<InstallAppButton />);
    await waitFor(() => {
      expect(screen.getByText(/Instalar app en tu teléfono/)).toBeTruthy();
    });
    expect(screen.queryByText(/Añadir a pantalla de inicio/)).toBeNull();
  });

  it("en la web de iPhone siguen el botón y las instrucciones de Safari", () => {
    platform.name = "web";
    setUa(IPHONE_UA);
    render(<InstallAppButton />);
    fireEvent.click(screen.getByText(/Instalar app en tu teléfono/));
    expect(screen.getByText(/Añadir a pantalla de inicio/)).toBeTruthy();
  });

  it("en iOS el banner de instalar no aparece ni guarda el prompt", async () => {
    platform.name = "ios";
    setUa(IPHONE_UA);
    render(<InstallPwaBanner />);
    window.dispatchEvent(installPromptEvent());
    await waitFor(() => {
      expect(screen.queryByText("Instalar RunningApexFlow")).toBeNull();
    });
    expect(screen.queryByText(/pantalla de inicio/i)).toBeNull();
    expect(window.__deferredInstallPrompt).toBeUndefined();
  });

  it("en Android y en la web el banner de instalar sigue saliendo", async () => {
    for (const name of ["android", "web"]) {
      cleanup();
      platform.name = name;
      setUa(name === "android" ? ANDROID_UA : IPHONE_UA);
      delete window.__deferredInstallPrompt;
      render(<InstallPwaBanner />);
      window.dispatchEvent(installPromptEvent());
      await waitFor(() => {
        expect(screen.getByText("Instalar RunningApexFlow")).toBeTruthy();
      });
      expect(screen.getByText(/pantalla de inicio/i)).toBeTruthy();
    }
  });

  it("en iOS no muestra el aviso de activar notificaciones", () => {
    platform.name = "ios";
    render(<PushInviteBanner visible onActivate={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByText("Activa las notificaciones para recibir mensajes")).toBeNull();
    expect(screen.queryByRole("button", { name: "Activar" })).toBeNull();
  });

  it("en Android y en la web el aviso de notificaciones y Activar siguen", () => {
    for (const name of ["android", "web"]) {
      cleanup();
      platform.name = name;
      render(<PushInviteBanner visible onActivate={vi.fn()} onDismiss={vi.fn()} />);
      expect(screen.getByText("Activa las notificaciones para recibir mensajes")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Activar" })).toBeTruthy();
    }
  });

  it("en iOS no llama a requestPermission, Messaging ni getToken", async () => {
    platform.name = "ios";
    await expect(requestNotificationPermission()).resolves.toBeNull();
    await expect(refreshFcmTokenIfGranted()).resolves.toBeNull();
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
    expect(fcm.isSupported).not.toHaveBeenCalled();
    expect(fcm.getMessaging).not.toHaveBeenCalled();
    expect(fcm.getToken).not.toHaveBeenCalled();
  });

  it("en Android y en la web el permiso y getToken siguen ejecutándose", async () => {
    for (const name of ["android", "web"]) {
      platform.name = name;
      notificationApi.permission = "default";
      notificationApi.requestPermission.mockClear();
      fcm.getToken.mockClear();
      fcm.isSupported.mockClear();
      const token = await requestNotificationPermission();
      expect(token).toBe("web-token");
      expect(notificationApi.requestPermission).toHaveBeenCalled();
      expect(fcm.getToken).toHaveBeenCalled();
      notificationApi.permission = "granted";
      fcm.getToken.mockClear();
      await expect(refreshFcmTokenIfGranted()).resolves.toBe("web-token");
      expect(fcm.getToken).toHaveBeenCalled();
    }
  });

  it("en iOS el coach no ofrece el aviso ni registra push web o nativo", async () => {
    platform.name = "ios";
    const { result } = renderHook(() => useCoachPushDeepLinks(coachPushArgs()));
    await waitFor(() => {
      expect(result.current.showPushInvite).toBe(false);
    });
    await result.current.syncFcmTokenToProfile();
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
    expect(fcm.getToken).not.toHaveBeenCalled();
    expect(fcm.isSupported).not.toHaveBeenCalled();
    expect(push.requestPermissions).not.toHaveBeenCalled();
    expect(push.checkPermissions).not.toHaveBeenCalled();
    expect(push.register).not.toHaveBeenCalled();
  });

  it("en Android el coach sigue pidiendo el permiso nativo y puede mostrar el aviso", async () => {
    platform.name = "android";
    const { result } = renderHook(() => useCoachPushDeepLinks(coachPushArgs()));
    await waitFor(() => {
      expect(push.requestPermissions).toHaveBeenCalled();
      expect(result.current.showPushInvite).toBe(true);
    });
    expect(fcm.getToken).not.toHaveBeenCalled();
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
  });

  it("en la web el coach sigue pidiendo permiso del navegador y getToken", async () => {
    platform.name = "web";
    const { result } = renderHook(() => useCoachPushDeepLinks(coachPushArgs()));
    await waitFor(() => {
      expect(result.current.showPushInvite).toBe(true);
    });
    await result.current.syncFcmTokenToProfile();
    expect(notificationApi.requestPermission).toHaveBeenCalled();
    expect(fcm.getToken).toHaveBeenCalled();
    expect(savedToken.registerFcmToken).toHaveBeenCalledWith("web-token");
    expect(push.requestPermissions).not.toHaveBeenCalled();
  });
});
