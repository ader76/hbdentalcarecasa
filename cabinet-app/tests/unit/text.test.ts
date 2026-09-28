import { describe, expect, it } from "vitest";
import { localIsoDate, matchesPatient, normalize } from "@/lib/text";

describe("recherche locale", () => {
  const p = { last_name: "DUPONT", first_name: "Jérôme", phone: "06 12 34 56 78", file_number: "P-00012" };
  it("ignore accents et casse", () => {
    expect(normalize("JÉRÔME")).toBe("jerome");
    expect(matchesPatient(p, "dupont jerome")).toBe(true);
  });
  it("trouve par téléphone quel que soit le format", () => {
    expect(matchesPatient(p, "0612345678")).toBe(true);
    expect(matchesPatient(p, "06.12.34")).toBe(true);
  });
  it("trouve par numéro de dossier", () => {
    expect(matchesPatient(p, "p-00012")).toBe(true);
  });
  it("exige tous les mots (pas de faux positif sur un homonyme)", () => {
    expect(matchesPatient({ ...p, first_name: "Jeanne" }, "dupont jerome")).toBe(false);
  });
});

describe("date locale", () => {
  it("utilise le jour local, jamais le jour UTC (fiches prises juste après minuit)", () => {
    expect(localIsoDate(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
    expect(localIsoDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});
