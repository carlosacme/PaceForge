import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xweecyaqjflmhieeouqm.supabase.co";
const supabaseKey = "sb_publishable_U0qsx3hYW9F3VN5u7BGozQ_Jbr52XhQ";

export const supabase = createClient(supabaseUrl, supabaseKey);
