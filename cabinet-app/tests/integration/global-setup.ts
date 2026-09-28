// Prépare la pile locale : base remise à zéro + données fictives + serveur Next (build de production).
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { loadEnv } from "../../scripts/env";

let server: ChildProcess | null = null;
export const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

async function up(url: string): Promise<boolean> {
  try { return (await fetch(url)).status < 500; } catch { return false; }
}

export async function setup(): Promise<void> {
  loadEnv();
  if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("tests : pile locale requise");
  if (!process.env.SKIP_RESET) execSync("npx supabase db reset", { stdio: "ignore" });
  execSync("npx tsx scripts/seed-dev.ts", { stdio: "ignore" });
  if (!(await up(`${BASE_URL}/login`))) {
    server = spawn("npx", ["next", "start", "-p", "3100", "-H", "127.0.0.1"], { stdio: "ignore", env: { ...process.env }, detached: true });
    for (let i = 0; i < 60 && !(await up(`${BASE_URL}/login`)); i++) await new Promise((r) => setTimeout(r, 500));
  }
}

export async function teardown(): Promise<void> {
  // tue tout le groupe de processus (npx + serveur Next), sinon un serveur périmé resterait actif
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
}
