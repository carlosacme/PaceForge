import React, { Suspense } from "react";
import AdminPanel from "./Admin";
import Dashboard from "./Dashboard";
import InstallAppButton from "./InstallAppButton";
import InviteModal from "./InviteModal";
import PlanPicker from "./PlanPicker";
import PushInviteBanner from "./PushInviteBanner";
import {
  PLATFORM_ADMIN_USER_ID,
  coachTrialDaysRemainingFromStart,
  styles,
} from "./shared/appShared";

const Athletes = React.lazy(() => import("./Athletes"));
const CoachSettings = React.lazy(() => import("./CoachSettings"));
const WorkoutLibrary = React.lazy(() => import("./WorkoutLibrary"));
const MarketplaceHub = React.lazy(() => import("./MarketplaceHub"));
const ChallengesHub = React.lazy(() => import("./ChallengesHub"));
const Plan2Weeks = React.lazy(() => import("./Plan2Weeks"));
const Builder = React.lazy(() => import("./Builder"));
const EvaluationView = React.lazy(() => import("./EvaluationView"));
const GpxRacePlan = React.lazy(() => import("./GpxRacePlan"));

/**
 * Shell visual del coach: sidebar, main (switch de vistas), bottom nav,
 * banners trial/push, InviteModal + PlanPicker montados aquí.
 *
 * No declara `view` — lo recibe de App vía `useCoachNavigation` para que
 * bridge/push puedan llamar `setView` en el mismo árbol de hooks.
 */
export default function CoachChrome({
  notification,
  session,
  profile,
  notify,
  // nav
  view,
  setView,
  coachNavItems,
  goCoachView,
  selectAthletesTab,
  selectTrainingTab,
  // invite
  inviteModalOpen,
  setInviteModalOpen,
  inviteCoachPublicCode,
  // plan picker / trial
  coachPlanPickerVoluntary,
  setCoachPlanPickerVoluntary,
  // athletes shell
  athletes,
  setAthletes,
  loadingAthletes,
  selectedAthlete,
  setSelectedAthlete,
  workoutsRefresh,
  bumpWorkoutsRefresh,
  pendingRegistroWorkoutId,
  setPendingRegistroWorkoutId,
  showAddAthleteForm,
  setShowAddAthleteForm,
  newAthlete,
  updateNewAthleteField,
  planLimitWarning,
  setPlanLimitWarning,
  staffParentCoachId,
  saveNewAthlete,
  cancelAddAthleteForm,
  handleDeleteAthlete,
  onAthleteWorkoutsDoneSync,
  onAthleteFcSync,
  // builder / library bridge
  aiPrompt,
  setAiPrompt,
  aiWorkout,
  setAiWorkout,
  aiLoading,
  setAiLoading,
  libraryRefresh,
  bumpLibraryRefresh,
  useLibraryWorkout,
  // push banner
  showPushInvite,
  syncFcmTokenToProfile,
  refreshNativePushPermission,
  dismissPushInvite,
  // auth
  handleSignOut,
}) {
  const S = styles;
  const sessionUserId = session?.user?.id ?? "";
  const isProfilesAdmin = profile?.role === "admin";
  const coachPlanBlockedUi =
    profile?.role === "coach" && profile?.plan_status === "blocked" && !isProfilesAdmin;
  const showCoachPlanPickerScreen =
    profile?.role === "coach" && !isProfilesAdmin && (coachPlanBlockedUi || coachPlanPickerVoluntary);

  const trialBannerDays =
    profile?.role === "coach" ? coachTrialDaysRemainingFromStart(profile) : null;
  const showTrialBanner =
    profile?.role === "coach" &&
    profile?.plan_status === "trial" &&
    trialBannerDays != null &&
    trialBannerDays > 0 &&
    !coachPlanBlockedUi;

  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><p>Cargando...</p></div>}>
      <div style={S.root}>
        {notification && <div style={S.notification}>✓ {notification}</div>}
        <InviteModal
          open={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          coachUserId={session?.user?.id}
          coachPublicCode={inviteCoachPublicCode}
          notify={notify}
        />

        <aside className="pf-sidebar-desktop" style={S.sidebar}>
          <div style={S.logo}>
            <img src="/pwa-192.png" alt="RunningApexFlow" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            <div>
              <div style={S.logoTitle}>
                RUNNING<span style={{ color: "#ff8a3d" }}>APEX</span>FLOW
              </div>
              <div style={S.logoSub}>Plataforma de Coach</div>
            </div>
          </div>
          <nav style={{ flex: 1, paddingTop: 8 }}>
            {coachNavItems.map((item) => {
              const active =
                view === item.id ||
                (item.id === "athletes" && (view === "evaluation" || view === "challenges")) ||
                (item.id === "training" && (view === "plan12" || view === "builder" || view === "carrera_gpx"));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goCoachView(item.id)}
                  style={{ ...S.navBtn, ...(active ? S.navBtnActive : {}) }}
                >
                  <span style={{ fontSize: "1.15em", color: item.color, width: 22, textAlign: "center" }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div style={S.sidebarFooter}>
            <div style={{ fontSize: ".82em", color: "#64748b", fontWeight: 600 }}>
              👤 {profile?.name || session?.user?.email?.split("@")[0] || "Coach"}
            </div>
            <div style={{ fontSize: ".7em", color: "#94a3b8", marginTop: 4 }}>
              {athletes.length} atletas · {athletes.reduce((a, b) => a + b.weekly_km, 0)} km
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              style={{
                marginTop: 10,
                width: "100%",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "9px 10px",
                color: "#dc2626",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
                fontWeight: 700,
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </aside>

        <main
          className="pf-main-mobile-pad"
          style={{ flex: 1, overflowY: "auto", background: "#f8fafc", position: "relative" }}
        >
          <div style={{ padding: "12px 16px 0" }}>
            <InstallAppButton />
          </div>
          <PushInviteBanner
            visible={showPushInvite}
            onActivate={async () => {
              if (typeof localStorage !== "undefined") localStorage.removeItem("raf_push_invite_dismissed");
              await syncFcmTokenToProfile();
              await refreshNativePushPermission();
            }}
            onDismiss={dismissPushInvite}
          />
          {showTrialBanner ? (
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 25,
                margin: "0 0 0",
                padding: "12px 16px",
                background: "linear-gradient(90deg, rgba(255,138,61,.22), rgba(251,191,36,.16))",
                borderBottom: "1px solid rgba(255,138,61,.45)",
                color: "#92400e",
                fontSize: ".82em",
                fontWeight: 700,
                boxShadow: "0 2px 8px rgba(15,23,42,.06)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>
                ⏳ Período de prueba: {trialBannerDays} día{trialBannerDays === 1 ? "" : "s"} restantes
              </span>
              <button
                type="button"
                onClick={() => {
                  setCoachPlanPickerVoluntary(true);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(180,83,9,.45)",
                  background: "#fff",
                  color: "#b45309",
                  fontWeight: 800,
                  fontSize: ".78em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Ver planes
              </button>
            </div>
          ) : null}
          {loadingAthletes ? (
            <div style={S.page}>
              <h1 style={S.pageTitle}>Cargando atletas...</h1>
            </div>
          ) : (
            <>
              {view === "dashboard" && (
                <Dashboard
                  athletes={athletes}
                  coachUserId={session?.user?.id ?? null}
                  onSelect={(a) => {
                    setSelectedAthlete(a);
                    setView("athletes");
                    setShowAddAthleteForm(false);
                  }}
                  onRequestAddAthlete={() => setInviteModalOpen(true)}
                  showAddAthleteForm={showAddAthleteForm}
                  planLimitWarning={planLimitWarning}
                  onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
                  onDismissPlanLimitWarning={() => setPlanLimitWarning("")}
                  newAthlete={newAthlete}
                  onChangeNewAthleteField={updateNewAthleteField}
                  onSaveNewAthlete={saveNewAthlete}
                  onCancelAddAthlete={cancelAddAthleteForm}
                />
              )}
              {(view === "athletes" || view === "evaluation" || view === "challenges") && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 16px 10px" }}>
                    <button type="button" onClick={() => selectAthletesTab("lista")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "athletes" ? "rgba(59,130,246,.12)" : "#fff", color: view === "athletes" ? "#1d4ed8" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>👥 Lista atletas</button>
                    <button type="button" onClick={() => selectAthletesTab("evaluacion")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "evaluation" ? "rgba(14,165,233,.12)" : "#fff", color: view === "evaluation" ? "#0369a1" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📊 Evaluación</button>
                    <button type="button" onClick={() => selectAthletesTab("retos")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "challenges" ? "rgba(168,85,247,.12)" : "#fff", color: view === "challenges" ? "#7e22ce" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🏆 Retos</button>
                  </div>
                  {view === "athletes" && (
                    <Suspense fallback={<div style={{ padding: 24, color: "#64748b" }}>Cargando atletas…</div>}>
                      <Athletes
                        athletes={athletes}
                        selected={selectedAthlete}
                        onSelect={setSelectedAthlete}
                        workoutsRefresh={workoutsRefresh}
                        openRegistroWorkoutId={pendingRegistroWorkoutId}
                        onRegistroOpened={() => setPendingRegistroWorkoutId(null)}
                        onAthleteWorkoutsDoneSync={onAthleteWorkoutsDoneSync}
                        onAthleteFcSync={onAthleteFcSync}
                        coachDisplayName={
                          profile?.name ||
                          session?.user?.user_metadata?.full_name ||
                          (session?.user?.email ? session.user.email.split("@")[0] : null) ||
                          "Coach"
                        }
                        onDeleteAthlete={handleDeleteAthlete}
                        notify={notify}
                        onOpenInviteModal={() => setInviteModalOpen(true)}
                      />
                    </Suspense>
                  )}
                  {view === "evaluation" && (
                    <Suspense fallback={<div style={{ padding: 24, color: "#64748b" }}>Cargando evaluación…</div>}>
                      <EvaluationView athletes={athletes} currentUserId={session?.user?.id ?? null} notify={notify} />
                    </Suspense>
                  )}
                  {view === "challenges" && (
                    <ChallengesHub
                      profileRole={profile?.role ?? ""}
                      currentUserId={sessionUserId || null}
                      athleteId={null}
                      workouts={[]}
                      coachAthletes={athletes}
                      notify={notify}
                      styles={styles}
                    />
                  )}
                </>
              )}
              {view === "settings" && (
                <CoachSettings
                  coachUserId={session?.user?.id ?? null}
                  sessionEmail={session?.user?.email ?? ""}
                  profileName={profile?.name ?? ""}
                  athletes={athletes}
                  setAthletes={setAthletes}
                  notify={notify}
                  onSignOut={handleSignOut}
                  styles={styles}
                  isStaff={Boolean(profile?.is_staff || staffParentCoachId)}
                />
              )}
              {view === "admin" && isProfilesAdmin && (
                <AdminPanel notify={notify} adminUserId={PLATFORM_ADMIN_USER_ID} />
              )}
              {(view === "plan12" || view === "builder" || view === "carrera_gpx" || view === "training") && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 16px 10px" }}>
                    <button type="button" onClick={() => selectTrainingTab("plan_2_semanas")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: (view === "plan12" || view === "training") ? "rgba(139,92,246,.12)" : "#fff", color: (view === "plan12" || view === "training") ? "#6d28d9" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◇ Plan 2 Semanas</button>
                    <button type="button" onClick={() => selectTrainingTab("crear_workout")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "builder" ? "rgba(234,88,12,.12)" : "#fff", color: view === "builder" ? "#c2410c" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◎ Crear Workout con IA</button>
                    <button type="button" onClick={() => selectTrainingTab("carrera_gpx")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "carrera_gpx" ? "rgba(220,38,38,.12)" : "#fff", color: view === "carrera_gpx" ? "#b91c1c" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>⛰ Carrera GPX</button>
                  </div>
                  {(view === "plan12" || view === "training") && (
                    <Plan2Weeks
                      athletes={athletes}
                      notify={notify}
                      coachUserId={session?.user?.id ?? null}
                      coachPlan={String(profile?.subscription_plan || "Basico")}
                      profileRole={profile?.role ?? ""}
                      onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
                      onPlanAssigned={bumpWorkoutsRefresh}
                    />
                  )}
                  {view === "builder" && (
                    <Builder
                      athletes={athletes}
                      aiPrompt={aiPrompt}
                      setAiPrompt={setAiPrompt}
                      aiWorkout={aiWorkout}
                      setAiWorkout={setAiWorkout}
                      aiLoading={aiLoading}
                      setAiLoading={setAiLoading}
                      notify={notify}
                      coachUserId={session?.user?.id ?? null}
                      coachPlan={String(profile?.subscription_plan || "Basico")}
                      profileRole={profile?.role ?? ""}
                      onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
                      onWorkoutAssigned={bumpWorkoutsRefresh}
                      onSavedToLibrary={bumpLibraryRefresh}
                    />
                  )}
                  {view === "carrera_gpx" && (
                    <GpxRacePlan
                      athletes={athletes}
                      coachUserId={session?.user?.id ?? null}
                      notify={notify}
                      onSavedToLibrary={bumpLibraryRefresh}
                      onWorkoutAssigned={bumpWorkoutsRefresh}
                    />
                  )}
                </>
              )}
              {view === "library" && (
                <WorkoutLibrary
                  coachUserId={sessionUserId || null}
                  libraryRefresh={libraryRefresh}
                  athletes={athletes}
                  profileRole={profile?.role ?? ""}
                  adminLibraryOwnerId={PLATFORM_ADMIN_USER_ID}
                  parentCoachId={staffParentCoachId || null}
                  onUseWorkout={useLibraryWorkout}
                  onCopiedGlobalToLibrary={bumpLibraryRefresh}
                  onOpenAdminMarketplaceDraft={() => setView("admin")}
                  onAfterLibraryImportSuccess={() => {
                    setView("library");
                    try {
                      if (typeof window !== "undefined") localStorage.setItem("raf_lastView", "library");
                    } catch {
                      /* ignore */
                    }
                    bumpLibraryRefresh();
                  }}
                  notify={notify}
                  styles={styles}
                />
              )}
              {view === "marketplace" && (
                <MarketplaceHub
                  profileRole={profile?.role ?? ""}
                  currentUserId={sessionUserId || null}
                  coachUserId={sessionUserId || null}
                  notify={notify}
                  styles={styles}
                />
              )}
            </>
          )}
        </main>

        <nav className="pf-bottom-nav" aria-label="Navegación principal">
          {coachNavItems.map((item) => {
            const active =
              view === item.id ||
              (item.id === "athletes" && (view === "evaluation" || view === "challenges")) ||
              (item.id === "training" && (view === "plan12" || view === "builder" || view === "carrera_gpx"));
            return (
              <button
                key={`m-${item.id}`}
                type="button"
                onClick={() => goCoachView(item.id)}
                style={{
                  color: active ? "#c2410c" : "#64748b",
                  background: active ? "rgba(255,138,61, 0.14)" : "transparent",
                  fontWeight: active ? 800 : 600,
                }}
              >
                <span className="pf-bnav-icon" style={{ color: item.color }}>
                  {item.icon}
                </span>
                <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>{item.shortLabel || item.label}</span>
              </button>
            );
          })}
        </nav>

        <PlanPicker
          open={showCoachPlanPickerScreen}
          locked={coachPlanBlockedUi}
          onClose={() => setCoachPlanPickerVoluntary(false)}
          notify={notify}
        />
      </div>
    </Suspense>
  );
}
