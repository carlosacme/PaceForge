import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IOS_ACCOUNT_NO_ACCESS, IOS_FEATURE_UNAVAILABLE, isIosApp } from "./lib/platform";

const platformState = vi.hoisted(() => ({ name: "web" }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => platformState.name,
    isNativePlatform: () => platformState.name === "ios" || platformState.name === "android",
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
}));

vi.mock("./lib/supabase", () => {
  const plan = {
    id: "p1",
    title: "Plan prueba",
    description: "Desc",
    price_cop: 120000,
    duration_weeks: 8,
    sessions_per_week: 4,
    level: "Intermedio",
    is_active: true,
    is_approved: true,
    coach_user_id: "other-coach",
    coach_name: "Coach",
    preview_workouts: [],
    plan_sessions: [],
  };
  const athletes = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    name: `Atleta ${i + 1}`,
    coach_id: "coach-1",
    weekly_km: 30,
    email: `a${i + 1}@example.com`,
  }));

  function resultFor(table, op) {
    if (op === "insert") return { data: { id: "purchase-1" }, error: null };
    if (op === "update" || op === "delete") return { data: null, error: null };
    if (table === "plan_marketplace") return { data: [plan], error: null };
    if (table === "athletes") return { data: athletes, error: null };
    return { data: [], error: null };
  }

  function chain(table) {
    let op = "select";
    const b = {
      select() { return b; },
      insert() { op = "insert"; return b; },
      update() { op = "update"; return b; },
      delete() { op = "delete"; return b; },
      eq() { return b; },
      neq() { return b; },
      in() { return b; },
      order() { return b; },
      limit() { return b; },
      ilike() { return b; },
      gte() { return b; },
      lte() { return b; },
      range() { return b; },
      maybeSingle() {
        if (table === "ai_generations") return Promise.resolve({ data: { count: 100 }, error: null });
        if (op === "insert") return Promise.resolve({ data: { id: "purchase-1" }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (op === "insert") return Promise.resolve({ data: { id: "purchase-1" }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve(resultFor(table, op)).then(resolve, reject);
      },
    };
    return b;
  }

  return {
    supabase: {
      from: (table) => chain(table),
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } }, error: null }),
        getUser: () => Promise.resolve({ data: { user: { id: "coach-1", email: "coach@example.com" } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  };
});

import PlanPicker from "./components/PlanPicker";
import AthletePaymentsView from "./components/AthleteHome/AthletePaymentsView";
import AthleteFormaFatigaPanel from "./components/AthleteHome/AthleteFormaFatigaPanel";
import AuthLanding from "./components/AuthLanding";
import Dashboard from "./components/Dashboard";
import MarketplaceHub from "./components/MarketplaceHub";
import CoachChrome from "./components/CoachChrome";
import Builder from "./components/Builder";
import Plan2Weeks from "./components/Plan2Weeks";
import AdminMarketplacePanel from "./components/AdminMarketplacePanel";
import { useAthleteSoloPayments } from "./components/AthleteHome/useAthleteSoloPayments";
import { useCoachNavigation } from "./hooks/useCoachNavigation";
import { useCoachAthletes } from "./hooks/useCoachAthletes";
import { styles } from "./components/shared/appShared";

const COMMERCE = /wompi|pagar ahora|suscribirse|renovar|ver planes|ir a pagos|actualiza al plan|plan premium|prueba gratis|comprar|\bCOP\b|\$\s?\d|checkout\.wompi/i;

const navigatedTo = [];
let currentHref = "http://localhost:3000/";

function installLocation() {
  const fake = {
    assign(url) { fake.href = String(url); },
    replace(url) { fake.href = String(url); },
    reload() {},
    toString() { return currentHref; },
  };
  Object.defineProperty(fake, "href", {
    configurable: true,
    get() { return currentHref; },
    set(value) {
      currentHref = String(value);
      navigatedTo.push(currentHref);
    },
  });
  for (const key of ["search", "pathname", "hash", "origin", "host", "hostname", "protocol", "port"]) {
    Object.defineProperty(fake, key, {
      configurable: true,
      get() {
        try { return new URL(currentHref)[key]; } catch { return ""; }
      },
    });
  }
  Object.defineProperty(window, "location", { configurable: true, value: fake });
}

function assertNoCommerce() {
  const text = document.body.textContent || "";
  expect(text).not.toMatch(COMMERCE);
  expect(document.body.innerHTML).not.toMatch(/checkout\.wompi\.co/i);
  expect(document.body.querySelector('a[href*="wompi"]')).toBeNull();
}

function setPlatform(name) {
  platformState.name = name;
}

function checkoutFetch() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      public_key: "pub",
      currency: "COP",
      amount_in_cents: 10000000,
      reference: "ref-1",
      signature: "sig",
      redirect_url: "https://www.runningapexflow.com/",
    }),
  }));
}

beforeEach(() => {
  setPlatform("web");
  navigatedTo.length = 0;
  currentHref = "http://localhost:3000/";
  installLocation();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", checkoutFetch());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("isIosApp", () => {
  it("es true solo en el shell ios", () => {
    setPlatform("ios");
    expect(isIosApp()).toBe(true);
    setPlatform("android");
    expect(isIosApp()).toBe(false);
    setPlatform("web");
    expect(isIosApp()).toBe(false);
  });
});

describe("PlanPicker", () => {
  it("en iOS no pinta precios ni Pagar ahora", () => {
    setPlatform("ios");
    render(<PlanPicker open locked onClose={() => {}} notify={() => {}} />);
    assertNoCommerce();
    expect(screen.queryByText("Pagar ahora")).toBeNull();
  });

  it("en android y web muestra el mismo picker de pago", () => {
    setPlatform("web");
    const web = render(<PlanPicker open locked onClose={() => {}} notify={() => {}} />);
    const webText = document.body.textContent;
    expect(screen.getByText("Pagar ahora")).toBeTruthy();
    expect(webText).toMatch(/COP/);
    web.unmount();

    setPlatform("android");
    render(<PlanPicker open locked onClose={() => {}} notify={() => {}} />);
    expect(document.body.textContent).toBe(webText);
    expect(screen.getByText("Pagar ahora")).toBeTruthy();
  });

  it("en web el botón llega a crear el checkout; en iOS no llama a la API", async () => {
    setPlatform("web");
    render(<PlanPicker open onClose={() => {}} notify={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Mensual/ })[0]);
    fireEvent.click(screen.getByText("Pagar ahora"));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const url = fetch.mock.calls[0][0];
    expect(String(url)).toContain("/api/wompi-create-checkout");
    await waitFor(() => {
      expect(navigatedTo.some((href) => href.startsWith("https://checkout.wompi.co/p/"))).toBe(true);
    });

    cleanup();
    fetch.mockClear();
    navigatedTo.length = 0;
    setPlatform("ios");
    render(<PlanPicker open onClose={() => {}} notify={() => {}} />);
    expect(screen.queryByText("Pagar ahora")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigatedTo).toEqual([]);
  });
});

describe("AthletePaymentsView", () => {
  const props = {
    cardStyle: {},
    athleteId: "ath-1",
    athletePlan: "free",
    subscriptionPeriod: null,
    subscriptionExpiresAt: null,
    profileUserId: "u1",
    profileCoachId: null,
    notify: () => {},
  };

  it("en iOS no renderiza suscripción ni COP", () => {
    setPlatform("ios");
    const { container } = render(<AthletePaymentsView {...props} />);
    expect(container.innerHTML).toBe("");
    assertNoCommerce();
  });

  it("en android y web muestra Suscribirse y el precio", () => {
    setPlatform("web");
    const web = render(<AthletePaymentsView {...props} />);
    expect(screen.getAllByText("Suscribirse").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/COP/);
    const webText = document.body.textContent;
    web.unmount();
    setPlatform("android");
    render(<AthletePaymentsView {...props} />);
    expect(document.body.textContent).toBe(webText);
  });
});

describe("useAthleteSoloPayments", () => {
  it("en iOS startCheckout no llama al checkout", async () => {
    setPlatform("ios");
    const { result } = renderHook(() => useAthleteSoloPayments({ athleteId: "ath-1", notify: () => {} }));
    await act(async () => {
      await result.current.startCheckout("monthly");
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(navigatedTo).toEqual([]);
  });

  it("en android startCheckout sí pide el checkout", async () => {
    setPlatform("android");
    const { result } = renderHook(() => useAthleteSoloPayments({ athleteId: "ath-1", notify: () => {} }));
    await act(async () => {
      await result.current.startCheckout("monthly");
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0][0])).toContain("/api/wompi-create-checkout");
    expect(navigatedTo.some((href) => href.startsWith("https://checkout.wompi.co/p/"))).toBe(true);
  });
});

describe("AthleteFormaFatigaPanel", () => {
  it("en iOS el paywall es el aviso neutro", () => {
    setPlatform("ios");
    render(<AthleteFormaFatigaPanel cardStyle={{}} workouts={[]} hasPremiumAccess={false} onGoToPagos={() => {}} />);
    expect(screen.getByText(IOS_FEATURE_UNAVAILABLE)).toBeTruthy();
    assertNoCommerce();
    expect(screen.queryByText("Ir a Pagos para suscribirme")).toBeNull();
  });

  it("en web y android conserva el CTA de pago", () => {
    setPlatform("web");
    const web = render(<AthleteFormaFatigaPanel cardStyle={{}} workouts={[]} hasPremiumAccess={false} onGoToPagos={() => {}} />);
    expect(screen.getByText("Ir a Pagos para suscribirme")).toBeTruthy();
    const webText = document.body.textContent;
    web.unmount();
    setPlatform("android");
    render(<AthleteFormaFatigaPanel cardStyle={{}} workouts={[]} hasPremiumAccess={false} onGoToPagos={() => {}} />);
    expect(document.body.textContent).toBe(webText);
  });
});

describe("AuthLanding", () => {
  it("en iOS oculta la prueba gratis y el plan premium", () => {
    setPlatform("ios");
    render(<AuthLanding notify={() => {}} resolveCoachIdByCode={() => {}} onLoginSuccess={() => {}} onAthleteProfileDraft={() => {}} />);
    expect(screen.queryByText("7 días de prueba gratis")).toBeNull();
    expect(screen.queryByText("Plan Premium disponible")).toBeNull();
    assertNoCommerce();
    expect(screen.getByText("Coach")).toBeTruthy();
    expect(screen.getByText("Atleta")).toBeTruthy();
  });

  it("en web y android muestra el marketing de planes", () => {
    setPlatform("web");
    const web = render(<AuthLanding notify={() => {}} resolveCoachIdByCode={() => {}} onLoginSuccess={() => {}} onAthleteProfileDraft={() => {}} />);
    expect(screen.getByText("7 días de prueba gratis")).toBeTruthy();
    expect(screen.getByText("Plan Premium disponible")).toBeTruthy();
    const webText = document.body.textContent;
    web.unmount();
    setPlatform("android");
    render(<AuthLanding notify={() => {}} resolveCoachIdByCode={() => {}} onLoginSuccess={() => {}} onAthleteProfileDraft={() => {}} />);
    expect(document.body.textContent).toBe(webText);
  });
});

describe("Dashboard límite de atletas", () => {
  const warning = "Has alcanzado el límite de tu plan. Actualiza al plan Pro para agregar más atletas.";
  const props = {
    athletes: [{ id: 1, name: "Ana", avatar: "🏃", status: "on-track", workouts_done: 0, workouts_total: 1, next_race: "" }],
    coachUserId: null,
    onSelect: () => {},
    onRequestAddAthlete: () => {},
    showAddAthleteForm: false,
    planLimitWarning: warning,
    onGoToPlans: () => {},
    onDismissPlanLimitWarning: () => {},
    newAthlete: {},
    onChangeNewAthleteField: () => {},
    onSaveNewAthlete: () => {},
    onCancelAddAthlete: () => {},
    notify: () => {},
  };

  it("en iOS sustituye el aviso de upgrade", () => {
    setPlatform("ios");
    render(<Dashboard {...props} />);
    expect(screen.getByText(IOS_FEATURE_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText("Ver Planes")).toBeNull();
    assertNoCommerce();
  });

  it("en web y android deja el aviso y Ver Planes", () => {
    setPlatform("web");
    const web = render(<Dashboard {...props} />);
    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.getByText("Ver Planes")).toBeTruthy();
    const webText = document.body.textContent;
    web.unmount();
    setPlatform("android");
    render(<Dashboard {...props} />);
    expect(document.body.textContent).toBe(webText);
  });
});

describe("MarketplaceHub", () => {
  const props = {
    profileRole: "athlete",
    currentUserId: "athlete-1",
    notify: () => {},
    styles,
  };

  it("en iOS no hay precio ni Comprar", async () => {
    setPlatform("ios");
    render(<MarketplaceHub {...props} />);
    expect(await screen.findByText("Plan prueba")).toBeTruthy();
    fireEvent.click(screen.getByText("Ver plan"));
    assertNoCommerce();
    expect(screen.queryByText(/Comprar/)).toBeNull();
    expect(navigatedTo).toEqual([]);
  });

  it("en web y android el plan muestra COP y se puede comprar", async () => {
    setPlatform("web");
    const web = render(<MarketplaceHub {...props} />);
    expect(await screen.findByText("Plan prueba")).toBeTruthy();
    expect(document.body.textContent).toMatch(/COP/);
    fireEvent.click(screen.getByText("Ver plan"));
    expect(screen.getByText(/Comprar/)).toBeTruthy();
    const webText = document.body.textContent;
    fireEvent.click(screen.getByText(/Comprar/));
    await waitFor(() => {
      expect(navigatedTo.some((href) => href.startsWith("https://checkout.wompi.co/p/"))).toBe(true);
    });
    web.unmount();

    setPlatform("android");
    render(<MarketplaceHub {...props} />);
    expect(await screen.findByText("Plan prueba")).toBeTruthy();
    fireEvent.click(screen.getByText("Ver plan"));
    expect(document.body.textContent).toBe(webText);
  });
});

function chromeProps(overrides = {}) {
  const noop = () => {};
  return {
    notification: null,
    session: { user: { id: "coach-1", email: "coach@example.com" } },
    profile: { id: "p1", user_id: "coach-1", role: "coach", plan_status: "blocked", name: "Coach" },
    notify: noop,
    view: "dashboard",
    setView: noop,
    coachNavItems: [{ id: "dashboard", icon: "▤", label: "Panel", shortLabel: "Inicio", color: "#ff8a3d" }],
    goCoachView: noop,
    selectAthletesTab: noop,
    selectTrainingTab: noop,
    inviteModalOpen: false,
    setInviteModalOpen: noop,
    inviteCoachPublicCode: "ABC",
    coachPlanPickerVoluntary: false,
    setCoachPlanPickerVoluntary: noop,
    athletes: [{ id: 1, name: "Ana" }],
    setAthletes: noop,
    loadingAthletes: true,
    selectedAthlete: null,
    setSelectedAthlete: noop,
    workoutsRefresh: 0,
    bumpWorkoutsRefresh: noop,
    pendingRegistroWorkoutId: null,
    setPendingRegistroWorkoutId: noop,
    showAddAthleteForm: false,
    setShowAddAthleteForm: noop,
    newAthlete: {},
    updateNewAthleteField: noop,
    planLimitWarning: "",
    setPlanLimitWarning: noop,
    staffParentCoachId: null,
    saveNewAthlete: noop,
    loadAthletes: noop,
    cancelAddAthleteForm: noop,
    handleDeleteAthlete: noop,
    onAthleteWorkoutsDoneSync: noop,
    onAthleteFcSync: noop,
    aiPrompt: "",
    setAiPrompt: noop,
    aiWorkout: null,
    setAiWorkout: noop,
    aiLoading: false,
    setAiLoading: noop,
    libraryRefresh: 0,
    bumpLibraryRefresh: noop,
    useLibraryWorkout: noop,
    showPushInvite: false,
    syncFcmTokenToProfile: noop,
    refreshNativePushPermission: noop,
    dismissPushInvite: noop,
    handleSignOut: noop,
    signingOut: false,
    ...overrides,
  };
}

describe("CoachChrome", () => {
  it("un coach bloqueado en iOS ve la pantalla neutra y cerrar sesión", () => {
    setPlatform("ios");
    const onSignOut = vi.fn();
    render(<CoachChrome {...chromeProps({ handleSignOut: onSignOut })} />);
    expect(screen.getByText(IOS_ACCOUNT_NO_ACCESS)).toBeTruthy();
    assertNoCommerce();
    fireEvent.click(screen.getByText("Cerrar sesión"));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("un coach bloqueado en web y android ve Pagar ahora", () => {
    setPlatform("web");
    const web = render(<CoachChrome {...chromeProps()} />);
    expect(screen.getByText("Pagar ahora")).toBeTruthy();
    expect(document.body.textContent).toMatch(/COP/);
    const webText = document.body.textContent;
    web.unmount();
    setPlatform("android");
    render(<CoachChrome {...chromeProps()} />);
    expect(document.body.textContent).toBe(webText);
  });

  it("el trial en iOS no ofrece Ver planes; en android sí, igual que la web", () => {
    const profile = {
      id: "p1",
      user_id: "coach-1",
      role: "coach",
      plan_status: "trial",
      trial_started_at: new Date().toISOString(),
      name: "Coach",
    };
    setPlatform("ios");
    const ios = render(<CoachChrome {...chromeProps({ profile })} />);
    expect(screen.queryByText("Ver planes")).toBeNull();
    expect(document.body.textContent).toMatch(/Período de prueba/);
    assertNoCommerce();
    ios.unmount();

    setPlatform("web");
    const web = render(<CoachChrome {...chromeProps({ profile })} />);
    expect(screen.getByText("Ver planes")).toBeTruthy();
    const webText = document.body.textContent;
    web.unmount();
    setPlatform("android");
    render(<CoachChrome {...chromeProps({ profile })} />);
    expect(document.body.textContent).toBe(webText);
  });
});

describe("límite de generaciones IA", () => {
  const athlete = { id: 1, name: "Ana", weekly_km: 40, goal: "10k", pace: "5:00" };

  it("Builder en iOS no ofrece actualizar a Pro", async () => {
    setPlatform("ios");
    render(
      <Builder
        athletes={[athlete]}
        aiPrompt="tempo 8 km"
        setAiPrompt={() => {}}
        aiWorkout={null}
        setAiWorkout={() => {}}
        aiLoading={false}
        setAiLoading={() => {}}
        notify={() => {}}
        coachUserId="coach-1"
        coachPlan="Basico"
        profileRole="coach"
        onGoToPlans={() => {}}
      />,
    );
    expect(await screen.findByText("100 / 100 generaciones usadas este mes")).toBeTruthy();
    fireEvent.click(screen.getByText("⚡ GENERAR WORKOUT"));
    expect(await screen.findByText(IOS_FEATURE_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText("Ver Planes")).toBeNull();
    assertNoCommerce();
  });

  it("Builder en web y android muestra Ver Planes", async () => {
    setPlatform("web");
    const web = render(
      <Builder
        athletes={[athlete]}
        aiPrompt="tempo 8 km"
        setAiPrompt={() => {}}
        aiWorkout={null}
        setAiWorkout={() => {}}
        aiLoading={false}
        setAiLoading={() => {}}
        notify={() => {}}
        coachUserId="coach-1"
        coachPlan="Basico"
        profileRole="coach"
        onGoToPlans={() => {}}
      />,
    );
    expect(await screen.findByText("100 / 100 generaciones usadas este mes")).toBeTruthy();
    fireEvent.click(screen.getByText("⚡ GENERAR WORKOUT"));
    expect(await screen.findByText(/Actualiza al plan Pro/)).toBeTruthy();
    expect(screen.getByText("Ver Planes")).toBeTruthy();
    const webText = document.body.textContent;
    web.unmount();

    setPlatform("android");
    render(
      <Builder
        athletes={[athlete]}
        aiPrompt="tempo 8 km"
        setAiPrompt={() => {}}
        aiWorkout={null}
        setAiWorkout={() => {}}
        aiLoading={false}
        setAiLoading={() => {}}
        notify={() => {}}
        coachUserId="coach-1"
        coachPlan="Basico"
        profileRole="coach"
        onGoToPlans={() => {}}
      />,
    );
    expect(await screen.findByText("100 / 100 generaciones usadas este mes")).toBeTruthy();
    fireEvent.click(screen.getByText("⚡ GENERAR WORKOUT"));
    expect(await screen.findByText(/Actualiza al plan Pro/)).toBeTruthy();
    expect(document.body.textContent).toBe(webText);
  });

  it("Plan2Weeks en iOS no ofrece actualizar a Pro", async () => {
    setPlatform("ios");
    render(
      <Plan2Weeks
        athletes={[athlete]}
        notify={() => {}}
        coachUserId="coach-1"
        coachPlan="Basico"
        profileRole="coach"
        onGoToPlans={() => {}}
      />,
    );
    expect(await screen.findByText("100 / 100 generaciones usadas este mes")).toBeTruthy();
    const time = screen.getByPlaceholderText("3:45:00");
    fireEvent.change(time, { target: { value: "3:00:00" } });
    fireEvent.click(screen.getByText("⚡ Generar Plan con IA"));
    expect(await screen.findByText(IOS_FEATURE_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText("Ver Planes")).toBeNull();
    assertNoCommerce();
  });
});

describe("useCoachNavigation", () => {
  it("en iOS quita Marketplace y no restaura esa vista", async () => {
    localStorage.setItem("raf_lastView", "marketplace");
    setPlatform("ios");
    const { result } = renderHook(() => useCoachNavigation({
      session: { user: { id: "coach-1" } },
      profile: { role: "coach" },
    }));
    await waitFor(() => expect(result.current.viewRestored).toBe(true));
    expect(result.current.view).toBe("dashboard");
    expect(result.current.coachNavItems.some((item) => item.id === "marketplace")).toBe(false);
  });

  it("en web conserva Marketplace", async () => {
    setPlatform("web");
    const { result } = renderHook(() => useCoachNavigation({
      session: { user: { id: "coach-1" } },
      profile: { role: "coach" },
    }));
    await waitFor(() => expect(result.current.viewRestored).toBe(true));
    expect(result.current.coachNavItems.some((item) => item.id === "marketplace")).toBe(true);
  });
});

describe("useCoachAthletes", () => {
  it("en iOS el tope de 15 atletas no pide upgrade", async () => {
    setPlatform("ios");
    const notify = vi.fn();
    const { result } = renderHook(() => useCoachAthletes({
      session: { user: { id: "coach-1" } },
      authLoading: false,
      notify,
      profile: { role: "coach", subscription_plan: "Basico" },
    }));
    await waitFor(() => expect(result.current.athletes.length).toBe(15));
    act(() => {
      result.current.updateNewAthleteField("name", "Nuevo");
      result.current.updateNewAthleteField("email", "nuevo@example.com");
      result.current.updateNewAthleteField("goal", "10k");
      result.current.updateNewAthleteField("pace", "5:00");
      result.current.updateNewAthleteField("weekly_km", "40");
    });
    await act(async () => {
      await result.current.saveNewAthlete();
    });
    expect(result.current.planLimitWarning).toBe(IOS_FEATURE_UNAVAILABLE);
    expect(notify).toHaveBeenCalledWith(IOS_FEATURE_UNAVAILABLE);
  });

  it("en web el tope pide actualizar a Pro", async () => {
    setPlatform("web");
    const notify = vi.fn();
    const { result } = renderHook(() => useCoachAthletes({
      session: { user: { id: "coach-1" } },
      authLoading: false,
      notify,
      profile: { role: "coach", subscription_plan: "Basico" },
    }));
    await waitFor(() => expect(result.current.athletes.length).toBe(15));
    act(() => {
      result.current.updateNewAthleteField("name", "Nuevo");
      result.current.updateNewAthleteField("email", "nuevo@example.com");
      result.current.updateNewAthleteField("goal", "10k");
      result.current.updateNewAthleteField("pace", "5:00");
      result.current.updateNewAthleteField("weekly_km", "40");
    });
    await act(async () => {
      await result.current.saveNewAthlete();
    });
    expect(result.current.planLimitWarning).toMatch(/Actualiza al plan Pro/);
  });
});

describe("AdminMarketplacePanel", () => {
  it("en iOS no muestra precios ni Wompi", async () => {
    setPlatform("ios");
    render(<AdminMarketplacePanel notify={() => {}} styles={styles} />);
    expect(await screen.findByText(IOS_FEATURE_UNAVAILABLE)).toBeTruthy();
    assertNoCommerce();
  });

  it("en web sigue mostrando el precio del plan", async () => {
    setPlatform("web");
    render(<AdminMarketplacePanel notify={() => {}} styles={styles} />);
    expect(await screen.findByText(/COP/)).toBeTruthy();
  });
});
