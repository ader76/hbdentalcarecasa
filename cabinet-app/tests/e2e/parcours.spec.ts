// Parcours réels dans le navigateur (Chromium headless, profils « téléphone Android » et « ordinateur Windows »).
import { expect, test } from "@playwright/test";
import { addPage, login, pickPatient, sql } from "./helpers";

test.describe("parcours mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "profil téléphone uniquement");

  test("créer un patient, photographier 2 pages, corriger, enregistrer : « Synchronisée et vérifiée »", async ({ page }) => {
    const started = Date.now();
    await login(page, "dentiste@cabinet-a.test");
    await page.getByTestId("scan-button").click();

    // homonymes affichés avec de quoi les distinguer
    await page.getByTestId("patient-search").fill("dupont");
    await expect(page.getByTestId("patient-result")).toHaveCount(2);

    await page.getByTestId("new-patient").click();
    await page.getByLabel("Nom *", { exact: true }).fill("Mobile");
    await page.getByLabel("Prénom *").fill("Fictif");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByTestId("selected-patient")).toContainText("MOBILE Fictif");

    await addPage(page, 1);
    await addPage(page, 2);
    await addPage(page, 3);

    // vérifier / tourner la page 1
    await page.getByTestId("page-thumb").nth(0).click();
    await page.getByRole("button", { name: "⟳ Tourner" }).click();
    await page.getByRole("button", { name: "Fermer" }).click();
    // supprimer la page 3 (mauvaise photo)
    await page.getByTestId("page-thumb").nth(2).click();
    await page.getByRole("button", { name: "🗑 Supprimer la page" }).click();
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect(page.getByTestId("page-thumb")).toHaveCount(2);

    await page.getByLabel("Note (facultative)").fill("Contrôle fictif");
    await page.getByTestId("save-sync").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "synced");
    await expect(page.getByTestId("sync-status")).toHaveText(/Synchronisée et vérifiée/);
    const elapsed = (Date.now() - started) / 1000;
    test.info().annotations.push({ type: "durée", description: `${elapsed.toFixed(1)} s du login à la confirmation` });

    const rows = await sql<{ page_count: number; sync_status: string; n: string; note: string; w: number; h: number }>(
      `select d.page_count, d.sync_status, d.note, (select count(*) from pages p where p.document_id = d.id) as n,
              (select width from pages p where p.document_id = d.id and page_number = 1) as w,
              (select height from pages p where p.document_id = d.id and page_number = 1) as h
       from documents d join patients pa on pa.id = d.patient_id where pa.last_name = 'MOBILE'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ page_count: 2, sync_status: "synced", n: "2", note: "Contrôle fictif" });
    expect(rows[0].w).toBeGreaterThan(rows[0].h); // la rotation a bien été appliquée (page couchée)

    await page.getByTestId("next-sheet").click();
    await expect(page.getByTestId("patient-search")).toBeVisible();
  });

  test("hors connexion : la fiche attend, survit à un rechargement, puis part au retour du réseau", async ({ page, context }) => {
    await login(page, "dentiste@cabinet-a.test");
    // attendre que le service worker contrôle la page (ouverture hors ligne)
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await page.getByTestId("scan-button").click();
    await pickPatient(page, "martin", /MARTIN/);
    await context.setOffline(true);
    await addPage(page, 1);
    await page.getByTestId("save-sync").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "pending");
    await expect(page.getByTestId("sync-status")).toContainText("hors connexion");

    // fermeture / réouverture de l'application sans réseau
    await page.goto("/");
    await expect(page.getByTestId("queue-item").first()).toBeVisible();
    await expect(page.getByTestId("queue-item").first().getByTestId("sync-status")).toHaveAttribute("data-status", "pending");
    expect(await sql("select 1 from documents d join patients p on p.id = d.patient_id where p.last_name = 'MARTIN'")).toHaveLength(0);

    await context.setOffline(false);
    await expect(page.getByTestId("queue-item").first().getByTestId("sync-status")).toHaveAttribute("data-status", "synced", { timeout: 40_000 });
    const rows = await sql<{ sync_status: string }>("select d.sync_status from documents d join patients p on p.id = d.patient_id where p.last_name = 'MARTIN'");
    expect(rows).toEqual([{ sync_status: "synced" }]);
  });

  test("coupure pendant l'envoi : échec affiché, « Réessayer » termine sans doublon", async ({ page }) => {
    await login(page, "assistant@cabinet-a.test");
    await page.getByTestId("scan-button").click();
    await pickPatient(page, "dupont jeanne", /Jeanne/);
    await addPage(page, 1);
    await addPage(page, 2);

    let aborted = false;
    await page.route("**/api/pages**", async (route) => {
      // la 2e page est reçue par le serveur mais la réponse est perdue (pire cas)
      if (!aborted && route.request().url().includes("pageNumber=2")) {
        aborted = true;
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await page.getByTestId("save-sync").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("sync-status")).toHaveText(/Échec, appuyer pour réessayer/);

    await page.getByTestId("sync-status").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "synced");
    const rows = await sql<{ n: string; page_count: number }>(
      `select d.page_count, (select count(*) from pages p where p.document_id = d.id) as n
       from documents d where d.patient_id = '11111111-1111-4111-8111-111111111112'`);
    expect(rows).toEqual([{ page_count: 2, n: "2" }]);
  });

  test("photo illisible : refusée localement avec un message clair", async ({ page }) => {
    await login(page, "dentiste@cabinet-a.test");
    await page.getByTestId("scan-button").click();
    await pickPatient(page, "martin", /MARTIN/);
    await page.getByTestId("capture-input").setInputFiles("test-results/fixtures/corrompue.jpg");
    await expect(page.getByTestId("scan-error")).toContainText(/illisible|pas une image/);
    await expect(page.getByTestId("page-thumb")).toHaveCount(0);
    await expect(page.getByTestId("save-sync")).toBeDisabled();
  });

  test("brouillon conservé si l'application est fermée pendant la capture", async ({ page }) => {
    await login(page, "dentiste@cabinet-a.test");
    await page.getByTestId("scan-button").click();
    await pickPatient(page, "dupont jean", /DUPONT Jean ·|P-00001/);
    await addPage(page, 3);
    await page.goto("/");
    await page.getByText("Fiche en cours non enregistrée").click();
    await expect(page.getByTestId("page-thumb")).toHaveCount(1);
    await page.getByText("Abandonner cette fiche").click();
  });
});

test.describe("poste Windows", () => {
  test.skip(({ isMobile }) => !!isMobile, "profil ordinateur uniquement");

  test("tableau de bord, dossier patient, lecteur (zoom, rotation, navigation), correction tracée", async ({ page }) => {
    // prépare une fiche de 2 pages rattachée par erreur à DUPONT Jean
    await login(page, "dentiste@cabinet-a.test");
    await page.getByTestId("scan-button").click();
    await pickPatient(page, "0600000001", /DUPONT/);
    await addPage(page, 1);
    await addPage(page, 2);
    await page.getByTestId("save-sync").click();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "synced");

    await page.goto("/dashboard");
    const today = page.getByTestId("imported-today");
    await expect(today).toContainText("DUPONT Jean");
    await today.getByRole("link", { name: /DUPONT Jean/ }).first().click();

    await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 / 2");
    await expect(page.getByTestId("viewer-image")).toBeVisible();
    await page.getByRole("button", { name: "Zoomer", exact: true }).click();
    await expect(page.getByText("125 %")).toBeVisible();
    await page.getByRole("button", { name: "Tourner à droite" }).click();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("page-indicator")).toHaveText("Page 2 / 2");
    // l'image affichée est chargée depuis la mémoire (lien signé téléchargé sans cache disque)
    await expect(page.getByTestId("viewer-image")).toHaveAttribute("src", /^blob:/);

    // correction : déplacer la fiche vers DUPONT Jeanne
    await page.getByRole("link", { name: /DUPONT Jean/ }).click();
    await expect(page.getByTestId("patient-name")).toHaveText("DUPONT Jean");
    await page.getByTestId("move-document").first().click();
    await page.getByRole("dialog").getByTestId("patient-search").fill("jeanne");
    await page.getByRole("dialog").getByTestId("patient-result").first().click();
    await page.getByLabel("Motif de la correction *").fill("mauvais dossier (test)");
    await page.getByRole("button", { name: "Confirmer le déplacement" }).click();
    await expect(page.getByText(/Fiche déplacée/)).toBeVisible();
    await expect(page.getByTestId("patient-history")).toContainText("Fiche retirée de ce patient");
    await expect(page.getByTestId("patient-history")).toContainText("mauvais dossier (test)");

    await page.goto("/journal");
    await expect(page.getByRole("table")).toContainText("Fiche déplacée vers ce patient");
  });

  test("l'assistant ne peut ni déplacer une fiche ni consulter le journal", async ({ page }) => {
    await login(page, "assistant@cabinet-a.test");
    await page.goto("/patient?id=11111111-1111-4111-8111-111111111112");
    await expect(page.getByTestId("patient-name")).toBeVisible();
    await expect(page.getByTestId("move-document")).toHaveCount(0);
    await page.goto("/journal");
    await expect(page.getByText(/réservée aux rôles/)).toBeVisible();
  });

  test("un autre cabinet ne voit pas le dossier", async ({ page }) => {
    await login(page, "dentiste@cabinet-b.test");
    await page.goto("/patient?id=11111111-1111-4111-8111-111111111111");
    await expect(page.getByText("Patient introuvable ou non autorisé.")).toBeVisible();
  });
});
