// Données FICTIVES pour le développement local. Refuse de s'exécuter hors localhost.
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, requireEnv } from "./env";

loadEnv();
const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const dbUrl = requireEnv("SUPABASE_DB_URL");
if (!/127\.0\.0\.1|localhost/.test(url) || !/127\.0\.0\.1|localhost/.test(dbUrl)) {
  throw new Error("seed-dev : environnement non local, arrêt.");
}

export const DEV_PASSWORD = "Fictif-Demo-2026!";
export const CABINET_A = "a0000000-0000-4000-8000-00000000000a";
export const CABINET_B = "b0000000-0000-4000-8000-00000000000b";
export const DEV_USERS = [
  { email: "dentiste@cabinet-a.test", name: "Dr Fictif (dentiste)", role: "dentiste", cabinet: CABINET_A },
  { email: "assistant@cabinet-a.test", name: "Assistant Fictif", role: "assistant", cabinet: CABINET_A },
  { email: "admin@cabinet-a.test", name: "Admin Fictif", role: "admin", cabinet: CABINET_A },
  { email: "dentiste@cabinet-b.test", name: "Dr Autre Cabinet", role: "dentiste", cabinet: CABINET_B },
] as const;

export async function seed(): Promise<void> {
  const admin = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  try {
    await db.query(
      `insert into public.cabinets (id, name) values ($1, 'Cabinet A (fictif)'), ($2, 'Cabinet B (fictif)')
       on conflict (id) do nothing`,
      [CABINET_A, CABINET_B],
    );
    for (const u of DEV_USERS) {
      const existing = await db.query("select id from auth.users where email = $1", [u.email]);
      let id: string = existing.rows[0]?.id;
      if (!id) {
        const { data, error } = await admin.auth.admin.createUser({
          email: u.email, password: DEV_PASSWORD, email_confirm: true,
        });
        if (error) throw error;
        id = data.user.id;
      }
      await db.query(
        `insert into public.members (user_id, cabinet_id, full_name, role) values ($1, $2, $3, $4)
         on conflict (user_id) do update set status = 'active', role = excluded.role`,
        [id, u.cabinet, u.name, u.role],
      );
    }
    const patients: [string, string, string, string, string | null, string | null][] = [
      ["11111111-1111-4111-8111-111111111111", CABINET_A, "DUPONT", "Jean", "0600000001", "1980-01-15"],
      ["11111111-1111-4111-8111-111111111112", CABINET_A, "DUPONT", "Jeanne", "0600000002", "1982-03-20"],
      ["11111111-1111-4111-8111-111111111113", CABINET_A, "MARTIN", "Sara", null, null],
      ["22222222-2222-4222-8222-222222222221", CABINET_B, "AUTRE", "Patient", "0700000001", null],
    ];
    for (const [id, cab, ln, fn, phone, bd] of patients) {
      await db.query(
        `with n as (update public.cabinets set next_file_number = next_file_number + 1 where id = $2
                    and not exists (select 1 from public.patients where id = $1)
                    returning next_file_number - 1 as n)
         insert into public.patients (id, cabinet_id, file_number, last_name, first_name, phone, birth_date)
         select $1, $2, 'P-' || lpad(n::text, 5, '0'), $3, $4, $5, $6 from n
         on conflict (id) do nothing`,
        [id, cab, ln, fn, phone, bd],
      );
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("seed-dev.ts")) {
  seed().then(() => console.log("Données fictives prêtes."), (e) => { console.error(e); process.exit(1); });
}
