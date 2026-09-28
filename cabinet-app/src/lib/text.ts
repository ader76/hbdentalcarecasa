// Normalisation identique à private.normalize() côté base : minuscules, sans accents.
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export interface PatientLike {
  last_name: string;
  first_name: string;
  phone?: string | null;
  file_number?: string | null;
}

/** Recherche locale (hors connexion) : tous les mots doivent correspondre. */
export function matchesPatient(p: PatientLike, query: string): boolean {
  const hay = `${normalize(p.last_name)} ${normalize(p.first_name)} ${(p.phone ?? "").replace(/\D/g, "")} ${normalize(p.file_number ?? "")}`;
  return normalize(query).split(/\s+/).filter(Boolean).every((t) => {
    if (hay.includes(t)) return true;
    const digits = t.replace(/\D/g, "");
    return digits.length > 0 && hay.includes(digits);
  });
}

/** Date locale de l'appareil au format AAAA-MM-JJ (pas d'UTC : évite le décalage de minuit). */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function patientLabel(p: PatientLike): string {
  return `${p.last_name} ${p.first_name}${p.file_number ? ` · ${p.file_number}` : ""}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}
