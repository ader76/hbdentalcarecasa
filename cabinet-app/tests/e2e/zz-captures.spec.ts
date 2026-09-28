// Captures d'écran de la documentation (données fictives). Exécution : CAPTURES=1 npx playwright test zz-captures
import { expect, test } from "@playwright/test";
import { addPage, login, pickPatient } from "./helpers";

test.skip(!process.env.CAPTURES, "captures de documentation uniquement sur demande");

test("captures", async ({ page, isMobile }) => {
  await login(page, "dentiste@cabinet-a.test");
  if (isMobile) {
    await page.screenshot({ path: "docs/captures/mobile-1-accueil.png" });
    await page.getByTestId("scan-button").click();
    await page.getByTestId("patient-search").fill("dupont");
    await expect(page.getByTestId("patient-result")).toHaveCount(2);
    await page.screenshot({ path: "docs/captures/mobile-2-patient.png" });
    await page.getByTestId("patient-result").first().click();
    await addPage(page, 1);
    await addPage(page, 2);
    await page.screenshot({ path: "docs/captures/mobile-3-pages.png" });
    await page.getByTestId("save-sync").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "synced");
    await page.screenshot({ path: "docs/captures/mobile-4-synchronisee.png" });
  } else {
    await page.goto("/scan");
    await pickPatient(page, "martin", /MARTIN/);
    await addPage(page, 3);
    await page.getByTestId("save-sync").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "synced");
    await page.goto("/dashboard");
    await expect(page.getByTestId("imported-today")).toContainText("MARTIN");
    await page.screenshot({ path: "docs/captures/windows-1-tableau-de-bord.png" });
    await page.getByTestId("imported-today").getByRole("link", { name: /MARTIN/ }).first().click();
    await expect(page.getByTestId("viewer-image")).toHaveAttribute("src", /^blob:/);
    await page.screenshot({ path: "docs/captures/windows-2-lecteur.png" });
  }
});
