"use client";
// Recherche / sélection / création rapide d'un patient.
// Ne fusionne jamais deux patients : les homonymes sont signalés, l'utilisateur décide.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase, friendlyError } from "@/lib/supabase/client";
import { addPendingPatient, listCachedPatients, type CachedPatient } from "@/lib/queue/db";
import { deviceLabel } from "@/lib/queue/transport";
import { useAuth } from "./AuthProvider";
import { formatDate, localIsoDate, matchesPatient, normalize, uuid } from "@/lib/text";

export interface PickedPatient {
  id: string;
  label: string;
}

function label(p: CachedPatient): string {
  return `${p.last_name} ${p.first_name}${p.file_number ? ` · ${p.file_number}` : " · (création en attente d'envoi)"}`;
}

function PatientRow({ p, onPick }: { p: CachedPatient; onPick: () => void }) {
  return (
    <li>
      <button onClick={onPick} data-testid="patient-result"
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left active:bg-teal-50">
        <span>
          <span className="block text-base font-semibold">{p.last_name} {p.first_name}</span>
          <span className="block text-sm text-slate-600">
            {p.file_number ?? "Nouveau (non envoyé)"}
            {p.birth_date ? ` · né(e) le ${formatDate(p.birth_date)}` : ""}
            {p.phone ? ` · ${p.phone}` : ""}
          </span>
        </span>
        <span aria-hidden className="text-teal-700">›</span>
      </button>
    </li>
  );
}

export function PatientPicker({ onPick, allowCreate = true, excludeId }: {
  onPick: (p: PickedPatient) => void; allowCreate?: boolean; excludeId?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CachedPatient[]>([]);
  const [cache, setCache] = useState<CachedPatient[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => { listCachedPatients().then(setCache); }, []);

  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const local = () => (q ? cache.filter((p) => matchesPatient(p, q)) : cache).slice(0, 20);
    const t = setTimeout(async () => {
      if (!q || !navigator.onLine) { if (!cancelled) setResults(local()); return; }
      setSearching(true);
      const { data, error } = await supabase().rpc("search_patients", { p_query: q, p_limit: 20 });
      if (cancelled) return;
      setSearching(false);
      if (error || !data) { setResults(local()); return; }
      // Ajoute les patients créés hors connexion (pas encore sur le serveur).
      const pending = cache.filter((p) => p.pending && matchesPatient(p, q));
      setResults([...pending, ...(data as CachedPatient[])]);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, cache]);

  const shown = results.filter((p) => p.id !== excludeId);

  if (creating) {
    return <NewPatientForm initial={query} cache={cache} onCancel={() => setCreating(false)}
      onCreated={(p) => onPick({ id: p.id, label: label(p) })} onPickExisting={(p) => onPick({ id: p.id, label: label(p) })} />;
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium">Rechercher : nom, prénom, téléphone ou n° de dossier</span>
        <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          className="input mt-1" placeholder="ex. Dupont, 0612…, P-00012" data-testid="patient-search" />
      </label>
      {searching && <p className="text-sm text-slate-500">Recherche…</p>}
      <ul className="space-y-2">
        {shown.map((p) => <PatientRow key={p.id} p={p} onPick={() => onPick({ id: p.id, label: label(p) })} />)}
      </ul>
      {query.trim() && !searching && shown.length === 0 && <p className="text-sm text-slate-600">Aucun patient trouvé.</p>}
      {allowCreate && (
        <button className="btn-secondary w-full" onClick={() => setCreating(true)} data-testid="new-patient">+ Nouveau patient</button>
      )}
    </div>
  );
}

function splitQuery(q: string): { last: string; first: string } {
  const parts = q.trim().split(/\s+/).filter((x) => !/\d/.test(x));
  return { last: parts[0] ?? "", first: parts.slice(1).join(" ") };
}

function NewPatientForm({ initial, cache, onCancel, onCreated, onPickExisting }: {
  initial: string; cache: CachedPatient[]; onCancel: () => void;
  onCreated: (p: CachedPatient) => void; onPickExisting: (p: CachedPatient) => void;
}) {
  const init = splitQuery(initial);
  const [lastName, setLastName] = useState(init.last);
  const [firstName, setFirstName] = useState(init.first);
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmedDistinct, setConfirmedDistinct] = useState(false);
  const { member } = useAuth();

  const similar = useMemo(() => {
    const ln = normalize(lastName);
    const fn = normalize(firstName);
    if (ln.length < 2) return [];
    return cache.filter((p) => {
      const pl = normalize(p.last_name);
      const pf = normalize(p.first_name);
      return pl === ln || (pl.startsWith(ln.slice(0, 4)) && (fn === "" || pf.startsWith(fn.slice(0, 3))));
    }).slice(0, 5);
  }, [lastName, firstName, cache]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lastName.trim() || !firstName.trim()) { setError("Nom et prénom sont obligatoires."); return; }
    if (phone && !/^[0-9+() .-]{6,25}$/.test(phone)) { setError("Téléphone invalide."); return; }
    if (similar.length > 0 && !confirmedDistinct) { setConfirmedDistinct(true); return; }
    setBusy(true);
    const id = uuid();
    const payload = { lastName: lastName.trim(), firstName: firstName.trim(), phone: phone.trim() || null, birthDate: birthDate || null };
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase().rpc("create_patient", {
          p_id: id, p_last_name: payload.lastName, p_first_name: payload.firstName,
          p_phone: payload.phone, p_birth_date: payload.birthDate, p_device: deviceLabel(),
        });
        if (!error && data) { onCreated(data as CachedPatient); return; }
        if (error && !/fetch|network/i.test(error.message)) { setError(friendlyError(error)); return; }
      }
      // Hors connexion : création mise en file, envoyée avant la fiche.
      if (!member) { setError("Session expirée : reconnectez-vous."); return; }
      await addPendingPatient({ id, userId: member.user_id, cabinetId: member.cabinet_id, ...payload, createdAt: new Date().toISOString() });
      onCreated({ id, last_name: payload.lastName.toUpperCase(), first_name: payload.firstName, phone: payload.phone,
        birth_date: payload.birthDate, file_number: null, pending: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Nouveau patient">
      <h2 className="h2">Nouveau patient</h2>
      <label className="block"><span className="text-sm font-medium">Nom *</span>
        <input required value={lastName} onChange={(e) => { setLastName(e.target.value); setConfirmedDistinct(false); }} className="input mt-1" autoCapitalize="characters" name="lastName" /></label>
      <label className="block"><span className="text-sm font-medium">Prénom *</span>
        <input required value={firstName} onChange={(e) => { setFirstName(e.target.value); setConfirmedDistinct(false); }} className="input mt-1" name="firstName" /></label>
      <label className="block"><span className="text-sm font-medium">Téléphone (facultatif)</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input mt-1" name="phone" /></label>
      <label className="block"><span className="text-sm font-medium">Date de naissance (facultative)</span>
        <input type="date" value={birthDate} max={localIsoDate()} onChange={(e) => setBirthDate(e.target.value)} className="input mt-1" name="birthDate" /></label>

      {similar.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" role="alert" data-testid="similar-warning">
          <p className="mb-2 text-sm font-medium">Patient(s) au nom proche déjà enregistré(s). Est-ce l&apos;un d&apos;eux ?</p>
          <ul className="space-y-2">
            {similar.map((p) => <PatientRow key={p.id} p={p} onPick={() => onPickExisting(p)} />)}
          </ul>
          {confirmedDistinct && <p className="mt-2 text-sm">Appuyez à nouveau sur « Créer » pour confirmer qu&apos;il s&apos;agit d&apos;un patient différent.</p>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {similar.length > 0 && confirmedDistinct ? "Créer quand même" : "Créer"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
