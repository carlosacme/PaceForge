import React, { useState, useMemo, useCallback } from "react";
import { supabase } from "./lib/supabase";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh";
import { useCoachPushDeepLinks } from "./hooks/useCoachPushDeepLinks";
import { useBuilderLibraryBridge } from "./hooks/useBuilderLibraryBridge";
import { useCoachAthletes } from "./hooks/useCoachAthletes";
import { useCoachNavigation } from "./hooks/useCoachNavigation";
import CoachChrome from "./components/CoachChrome";
import {
  unregisterOwnDeviceToken,
} from "./components/shared/appShared";
import { clearFcmToken } from "./firebase.js";
import { Capacitor } from "@capacitor/core";
import { clearNativePush } from "./lib/nativePush";

/**
 * Sesion coach: hooks + shell. App lo carga con React.lazy para que un
 * atleta no descargue Dashboard / Firebase / navegacion de coach.
 */
export default function CoachApp({
  session,
  profile,
  notify,
  notification,
  authLoading,
}) {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [coachPlanPickerVoluntary, setCoachPlanPickerVoluntary] = useState(false);

  const {
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
    loadAthletes,
    saveNewAthlete,
    cancelAddAthleteForm,
    handleDeleteAthlete,
    onAthleteWorkoutsDoneSync,
    onAthleteFcSync,
    clearSelectedOnSignOut,
  } = useCoachAthletes({ session, authLoading, notify, profile });

  const closeAddAthleteForm = useCallback(() => {
    setShowAddAthleteForm(false);
  }, [setShowAddAthleteForm]);

  const {
    view,
    setView,
    setViewRestored,
    coachNavItems,
    goCoachView,
    selectAthletesTab,
    selectTrainingTab,
  } = useCoachNavigation({
    session,
    profile,
    onCloseAddAthleteForm: closeAddAthleteForm,
  });

  const {
    aiPrompt,
    setAiPrompt,
    aiWorkout,
    setAiWorkout,
    aiLoading,
    setAiLoading,
    libraryRefresh,
    bumpLibraryRefresh,
    useLibraryWorkout,
  } = useBuilderLibraryBridge({ setView, notify });

  const {
    syncFcmTokenToProfile,
    showPushInvite,
    dismissPushInvite,
    refreshNativePushPermission,
    setNativePushPermission,
  } = useCoachPushDeepLinks({
    session,
    authLoading,
    profile,
    athletes,
    notify,
    setView,
    setSelectedAthlete,
    setViewRestored,
    setPendingRegistroWorkoutId,
  });

  const coachCodeFromId = useCallback((userId) => String(userId || "").replace(/-/g, "").slice(0, 8).toUpperCase(), []);

  const inviteCoachPublicCode = useMemo(() => {
    const raw = String(profile?.coach_id || "").trim();
    if (raw && !raw.includes("-")) return raw.toUpperCase();
    return coachCodeFromId(session?.user?.id);
  }, [profile?.coach_id, session?.user?.id, coachCodeFromId]);

  useAppResumeRefresh(() => {
    void loadAthletes({ silent: true });
    bumpWorkoutsRefresh();
  }, Boolean(session?.user?.id));

  const handleSignOut = async () => {
    if (typeof window !== "undefined" && window.posthog) window.posthog.reset();
    try {
      await unregisterOwnDeviceToken();
      const uid = session?.user?.id;
      if (uid) {
        const { data: cleared, error: fcmErr } = await supabase
          .from("profiles")
          .update({ fcm_token: null })
          .eq("user_id", uid)
          .select("user_id");
        if (fcmErr) {
          console.warn("[FCM] no se pudo limpiar fcm_token en logout:", fcmErr.message);
        } else if (!(cleared || []).length) {
          console.warn("[FCM] fcm_token no se actualizó (0 filas) en logout");
        }
      }
      if (Capacitor.isNativePlatform()) await clearNativePush();
      else await clearFcmToken();
      setNativePushPermission(null);
    } catch (e) {
      console.warn("[FCM] limpieza en logout:", e);
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error al cerrar sesión:", error);
      alert(`Error al cerrar sesión: ${error.message}`);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("raf_lastView");
      localStorage.removeItem("raf_tab_atletas");
      localStorage.removeItem("raf_tab_entrenamientos");
      localStorage.removeItem("raf_tab_biblioteca");
      localStorage.removeItem("raf_tab_crear_workout");
      localStorage.removeItem("raf_athlete_tab");
      localStorage.removeItem("raf_athlete_eval_open");
      localStorage.removeItem("raf_athlete_profile_tab");
      localStorage.removeItem("raf_athlete_progress_tab");
      localStorage.removeItem("raf_admin_tab");
      localStorage.removeItem("raf_plan2_athlete");
      localStorage.removeItem("raf_admin_plan_draft");
      localStorage.removeItem("raf_push_invite_dismissed");
    }
    setView("dashboard");
    clearSelectedOnSignOut();
  };

  return (
    <CoachChrome
      notification={notification}
      session={session}
      profile={profile}
      notify={notify}
      view={view}
      setView={setView}
      coachNavItems={coachNavItems}
      goCoachView={goCoachView}
      selectAthletesTab={selectAthletesTab}
      selectTrainingTab={selectTrainingTab}
      inviteModalOpen={inviteModalOpen}
      setInviteModalOpen={setInviteModalOpen}
      inviteCoachPublicCode={inviteCoachPublicCode}
      coachPlanPickerVoluntary={coachPlanPickerVoluntary}
      setCoachPlanPickerVoluntary={setCoachPlanPickerVoluntary}
      athletes={athletes}
      setAthletes={setAthletes}
      loadingAthletes={loadingAthletes}
      selectedAthlete={selectedAthlete}
      setSelectedAthlete={setSelectedAthlete}
      workoutsRefresh={workoutsRefresh}
      bumpWorkoutsRefresh={bumpWorkoutsRefresh}
      pendingRegistroWorkoutId={pendingRegistroWorkoutId}
      setPendingRegistroWorkoutId={setPendingRegistroWorkoutId}
      showAddAthleteForm={showAddAthleteForm}
      setShowAddAthleteForm={setShowAddAthleteForm}
      newAthlete={newAthlete}
      updateNewAthleteField={updateNewAthleteField}
      planLimitWarning={planLimitWarning}
      setPlanLimitWarning={setPlanLimitWarning}
      staffParentCoachId={staffParentCoachId}
      saveNewAthlete={saveNewAthlete}
      loadAthletes={loadAthletes}
      cancelAddAthleteForm={cancelAddAthleteForm}
      handleDeleteAthlete={handleDeleteAthlete}
      onAthleteWorkoutsDoneSync={onAthleteWorkoutsDoneSync}
      onAthleteFcSync={onAthleteFcSync}
      aiPrompt={aiPrompt}
      setAiPrompt={setAiPrompt}
      aiWorkout={aiWorkout}
      setAiWorkout={setAiWorkout}
      aiLoading={aiLoading}
      setAiLoading={setAiLoading}
      libraryRefresh={libraryRefresh}
      bumpLibraryRefresh={bumpLibraryRefresh}
      useLibraryWorkout={useLibraryWorkout}
      showPushInvite={showPushInvite}
      syncFcmTokenToProfile={syncFcmTokenToProfile}
      refreshNativePushPermission={refreshNativePushPermission}
      dismissPushInvite={dismissPushInvite}
      handleSignOut={handleSignOut}
    />
  );
}
