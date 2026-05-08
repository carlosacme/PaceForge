import { createClient } from "@supabase/supabase-js";

const PROJECT_URL = "https://xweecyaqjflmhieeouqm.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in environment variables.");
  process.exit(1);
}

const supabase = createClient(PROJECT_URL, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const usersToCreate = [
  {
    email: "acostamerlano87+libre@gmail.com",
    password: "Test2026!",
    name: "Atleta Libre",
    role: "athlete",
    plan_status: null,
    trial_started_at: null,
  },
  {
    email: "acostamerlano87+blocked@gmail.com",
    password: "Test2026!",
    name: "Coach Bloqueado",
    role: "coach",
    plan_status: "blocked",
    trial_started_at: new Date().toISOString(),
  },
  {
    email: "acostamerlano87+otro@gmail.com",
    password: "Test2026!",
    name: "Atleta Otro",
    role: "athlete",
    plan_status: null,
    trial_started_at: null,
  },
];

async function findUserByEmail(email) {
  const pageSize = 200;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: pageSize,
    });

    if (error) {
      throw new Error(`Failed to list users while searching ${email}: ${error.message}`);
    }

    const users = data?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;

    if (users.length < pageSize) return null;
    page += 1;
  }
}

async function createOrGetUser(userInput) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: userInput.email,
    password: userInput.password,
    email_confirm: true,
    user_metadata: {
      name: userInput.name,
    },
  });

  if (!error && data?.user) return data.user;

  const alreadyExists =
    error?.message?.toLowerCase().includes("already been registered") ||
    error?.message?.toLowerCase().includes("already registered") ||
    error?.status === 422;

  if (!alreadyExists) {
    throw new Error(`Failed to create auth user ${userInput.email}: ${error?.message}`);
  }

  const existingUser = await findUserByEmail(userInput.email);
  if (!existingUser) {
    throw new Error(
      `User ${userInput.email} exists but could not be retrieved via listUsers.`
    );
  }

  return existingUser;
}

async function upsertProfile(user, profileInput) {
  const payload = {
    user_id: user.id,
    role: profileInput.role,
    name: profileInput.name,
    email: profileInput.email,
    plan_status: profileInput.plan_status,
    trial_started_at: profileInput.trial_started_at,
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to upsert profile for ${profileInput.email}: ${error.message}`);
  }
}

async function main() {
  const created = [];

  for (const userInput of usersToCreate) {
    const authUser = await createOrGetUser(userInput);
    await upsertProfile(authUser, userInput);

    created.push({
      email: userInput.email,
      id: authUser.id,
      role: userInput.role,
    });
  }

  console.log("Usuarios procesados correctamente:");
  for (const row of created) {
    console.log(`- ${row.email} | ${row.role} | id=${row.id}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
