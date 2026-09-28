import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { loadEnv } from "../../scripts/env";

loadEnv();
export const PASSWORD = "Fictif-Demo-2026!";
export const fixture = (n: number) => `test-results/fixtures/page${n}.jpg`;

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByTestId("scan-button")).toBeVisible();
}

export async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  try { return (await c.query(q, params)).rows as T[]; } finally { await c.end(); }
}

/** Choisit un patient existant depuis l'écran de scan. */
export async function pickPatient(page: Page, query: string, name: RegExp): Promise<void> {
  await page.getByTestId("patient-search").fill(query);
  await page.getByTestId("patient-result").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("selected-patient")).toBeVisible();
}

export async function addPage(page: Page, n: number): Promise<void> {
  const before = await page.getByTestId("page-thumb").count();
  await page.getByTestId("capture-input").setInputFiles(fixture(n));
  await expect(page.getByTestId("page-thumb")).toHaveCount(before + 1);
}
