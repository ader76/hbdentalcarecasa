import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fakeSheet } from "../helpers/images";

export default async function globalSetup(): Promise<void> {
  execSync("npx supabase db reset", { stdio: "ignore" });
  execSync("npx tsx scripts/seed-dev.ts", { stdio: "ignore" });
  mkdirSync("test-results/fixtures", { recursive: true });
  for (let i = 1; i <= 4; i++) writeFileSync(`test-results/fixtures/page${i}.jpg`, await fakeSheet(`page ${i}`));
  writeFileSync("test-results/fixtures/corrompue.jpg", Buffer.from("pas une image"));
}
