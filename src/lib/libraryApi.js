import { supabase } from "./supabase";
import { readStructure } from "./workoutStructure";

/** Columnas de listado: sin `structure` (~75 % del payload). */
export const LIBRARY_LIST_COLUMNS =
  "id,coach_id,title,type,workout_type,total_km,distance_km,duration_min,description,created_at,is_fitness_test,folder_id,is_system,category,seed_key,copied_from_id";

export async function loadLibraryFolders(coachIds) {
  const ids = [...new Set((coachIds || []).filter(Boolean))];
  if (!ids.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from("library_folders")
    .select("id,coach_id,name,sort_order,created_at")
    .in("coach_id", ids)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return { data: data || [], error };
}

export async function createLibraryFolder(coachId, name) {
  const trimmed = String(name || "").trim();
  if (!coachId || !trimmed) return { data: null, error: { message: "Nombre vacío" } };
  const { data: existing } = await supabase
    .from("library_folders")
    .select("sort_order")
    .eq("coach_id", coachId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const sort_order = Number(existing?.[0]?.sort_order || 0) + 1;
  return supabase
    .from("library_folders")
    .insert({ coach_id: coachId, name: trimmed, sort_order })
    .select("id,coach_id,name,sort_order,created_at")
    .single();
}

export async function renameLibraryFolder(id, coachId, name) {
  const trimmed = String(name || "").trim();
  if (!id || !coachId || !trimmed) return { error: { message: "Nombre vacío" } };
  return supabase
    .from("library_folders")
    .update({ name: trimmed })
    .eq("id", id)
    .eq("coach_id", coachId);
}

export async function deleteLibraryFolder(id, coachId) {
  if (!id || !coachId) return { error: { message: "Carpeta inválida" } };
  return supabase.from("library_folders").delete().eq("id", id).eq("coach_id", coachId);
}

export async function findOrCreateLibraryFolder(coachId, name) {
  const trimmed = String(name || "").trim();
  if (!coachId || !trimmed) return { data: null, error: null };
  const { data: found, error: findErr } = await supabase
    .from("library_folders")
    .select("id,coach_id,name,sort_order,created_at")
    .eq("coach_id", coachId)
    .ilike("name", trimmed)
    .limit(1);
  if (findErr) return { data: null, error: findErr };
  const hit = (found || []).find((f) => String(f.name).trim().toLowerCase() === trimmed.toLowerCase());
  if (hit) return { data: hit, error: null };
  return createLibraryFolder(coachId, trimmed);
}

export async function fetchLibraryStructuresByIds(ids) {
  const unique = [...new Set((ids || []).filter((id) => id != null && id !== ""))];
  const map = new Map();
  if (!unique.length) return { map, error: null };
  const { data, error } = await supabase
    .from("workout_library")
    .select("id,structure")
    .in("id", unique);
  if (error) return { map, error };
  for (const row of data || []) {
    map.set(row.id, readStructure(row));
  }
  return { map, error: null };
}

export async function hydrateLibraryRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const missing = list.filter((r) => r && r.id != null && !Array.isArray(r.structure)).map((r) => r.id);
  if (!missing.length) return { rows: list, error: null };
  const { map, error } = await fetchLibraryStructuresByIds(missing);
  if (error) return { rows: list, error };
  return {
    rows: list.map((r) => (map.has(r.id) ? { ...r, structure: map.get(r.id) } : r)),
    error: null,
  };
}

export async function moveLibraryWorkoutsToFolder({ ids, folderId, coachId }) {
  const unique = [...new Set((ids || []).filter((id) => id != null && id !== ""))];
  if (!unique.length || !coachId) return { error: { message: "Nada que mover" } };
  return supabase
    .from("workout_library")
    .update({ folder_id: folderId || null })
    .in("id", unique)
    .eq("coach_id", coachId)
    .eq("is_system", false);
}

export async function copySystemWorkoutToLibrary({ source, coachId }) {
  if (!source?.id || !coachId) return { data: null, error: { message: "Copia inválida" } };
  const { data: existing, error: existErr } = await supabase
    .from("workout_library")
    .select("id")
    .eq("coach_id", coachId)
    .eq("copied_from_id", source.id)
    .limit(1);
  if (existErr) return { data: null, error: existErr };
  if (existing?.length) return { data: existing[0], error: null, already: true };

  let folderId = null;
  const category = String(source.category || "").trim();
  if (category) {
    const { data: folder, error: folderErr } = await findOrCreateLibraryFolder(coachId, category);
    if (folderErr) return { data: null, error: folderErr };
    folderId = folder?.id ?? null;
  }

  const { map, error: stErr } = await fetchLibraryStructuresByIds([source.id]);
  if (stErr) return { data: null, error: stErr };
  const structure = map.get(source.id) || (Array.isArray(source.structure) ? source.structure : []);

  const ins = {
    coach_id: coachId,
    title: (source.title && String(source.title).trim()) || "Entreno",
    type: source.type || "easy",
    workout_type: source.workout_type || source.type || "easy",
    total_km: Number.isFinite(Number(source.total_km)) ? Number(source.total_km) : 0,
    distance_km: Number.isFinite(Number(source.distance_km))
      ? Number(source.distance_km)
      : Number.isFinite(Number(source.total_km))
        ? Number(source.total_km)
        : 0,
    duration_min: Number.isFinite(Number(source.duration_min)) ? Math.round(Number(source.duration_min)) : 0,
    description: source.description != null ? String(source.description) : "",
    structure,
    is_fitness_test: source.is_fitness_test === true,
    is_system: false,
    folder_id: folderId,
    copied_from_id: source.id,
    category: category || null,
  };
  const { data, error } = await supabase.from("workout_library").insert(ins).select("id").single();
  return { data, error };
}
