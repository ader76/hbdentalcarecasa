"use client";
// Dossier patient : identité, fiches classées par date, corrections tracées, historique.
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { PatientPicker, type PickedPatient } from "@/components/PatientPicker";
import { ServerStatusBadge } from "@/components/StatusBadge";
import { SecureImage } from "@/components/SecureImage";
import { supabase, friendlyError } from "@/lib/supabase/client";
import { fetchDocumentImages, type PageImage } from "@/lib/api";
import { ACTION_LABELS, useMemberNames } from "@/lib/useMembers";
import { formatDate, formatDateTime } from "@/lib/text";

interface Patient {
  id: string; last_name: string; first_name: string; phone: string | null; birth_date: string | null;
  file_number: string; created_at: string; updated_at: string; status: string;
}
interface Doc {
  id: string; document_date: string; note: string | null; page_count: number; sync_status: "receiving" | "synced";
  version: number; status: "active" | "archived"; created_at: string; created_by: string; device_label: string | null;
}
interface Audit {
  id: number; action: string; user_id: string | null; created_at: string; old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null; result: string; entity_id: string | null;
}

function Thumbs({ docId }: { docId: string }) {
  const [imgs, setImgs] = useState<PageImage[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { fetchDocumentImages(docId, true).then(setImgs, () => setErr(true)); }, [docId]);
  if (err) return <p className="text-sm text-red-700">Miniatures indisponibles.</p>;
  if (!imgs) return <p className="text-sm text-slate-500">Chargement des miniatures…</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {imgs.map((p) => (
        <Link key={p.id} href={`/document?id=${docId}&page=${p.pageNumber}`} className="relative block w-20 overflow-hidden rounded border border-slate-300 bg-white">
          <SecureImage src={p.thumbUrl} alt={`Page ${p.pageNumber}`} className="aspect-[3/4] w-full object-contain" />
          <span className="absolute left-0.5 top-0.5 rounded bg-teal-800 px-1 text-xs text-white">{p.pageNumber}</span>
        </Link>
      ))}
    </div>
  );
}

function MoveDialog({ doc, patientId, onDone, onCancel }: { doc: Doc; patientId: string; onDone: () => void; onCancel: () => void }) {
  const [target, setTarget] = useState<PickedPatient | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    const { error } = await supabase().rpc("move_document", { p_id: doc.id, p_new_patient_id: target.id, p_reason: reason });
    setBusy(false);
    if (error) setError(friendlyError(error)); else onDone();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center" role="dialog" aria-label="Déplacer la fiche">
      <div className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-auto">
        <h2 className="h2">Déplacer la fiche du {formatDate(doc.document_date)}</h2>
        {!target ? (
          <>
            <p className="text-sm text-slate-600">Choisissez le bon patient :</p>
            <PatientPicker onPick={setTarget} excludeId={patientId} />
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p>Nouveau patient : <strong data-testid="move-target">{target.label}</strong>{" "}
              <button type="button" className="text-sm underline" onClick={() => setTarget(null)}>changer</button></p>
            <label className="block"><span className="text-sm font-medium">Motif de la correction *</span>
              <input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-1" placeholder="ex. fiche rattachée au mauvais patient" /></label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <p className="text-sm text-slate-600">La correction est enregistrée dans l&apos;historique des deux patients.</p>
            <button className="btn-primary w-full" disabled={busy || reason.trim().length < 3}>Confirmer le déplacement</button>
          </form>
        )}
        <button className="btn-secondary w-full" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function EditIdentity({ p, onDone, onCancel }: { p: Patient; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ last: p.last_name, first: p.first_name, phone: p.phone ?? "", birth: p.birth_date ?? "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase().rpc("update_patient", {
      p_id: p.id, p_last_name: f.last, p_first_name: f.first, p_phone: f.phone || null, p_birth_date: f.birth || null,
    });
    if (error) setError(friendlyError(error)); else onDone();
  }
  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="text-sm">Nom</span><input className="input" required value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></label>
        <label><span className="text-sm">Prénom</span><input className="input" required value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></label>
        <label><span className="text-sm">Téléphone</span><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label><span className="text-sm">Date de naissance</span><input type="date" className="input" value={f.birth} onChange={(e) => setF({ ...f, birth: e.target.value })} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2"><button className="btn-primary">Enregistrer</button><button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}

function PatientView() {
  const id = useSearchParams().get("id") ?? "";
  const { can } = useAuth();
  const names = useMemberNames();
  const [patient, setPatient] = useState<Patient | null | undefined>(undefined);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [history, setHistory] = useState<Audit[]>([]);
  const [moving, setMoving] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState<Doc | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const canCorrect = can("dentiste", "admin");

  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data: p }, { data: d }] = await Promise.all([
      sb.from("patients").select("*").eq("id", id).maybeSingle(),
      sb.from("documents").select("*").eq("patient_id", id).order("document_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setPatient(p as Patient | null);
    setDocs((d ?? []) as Doc[]);
    if (canCorrect) {
      const { data: h } = await sb.from("audit_log").select("id,action,user_id,created_at,old_value,new_value,result,entity_id")
        .eq("patient_id", id).neq("action", "page.receive").order("created_at", { ascending: false }).limit(100);
      setHistory((h ?? []) as Audit[]);
    }
  }, [id, canCorrect]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : l'état n'est mis à jour qu'après la réponse réseau
  useEffect(() => { if (id) void load(); }, [id, load]);

  async function archive() {
    if (!archiving) return;
    const { error } = await supabase().rpc("archive_document", { p_id: archiving.id, p_reason: reason });
    if (error) { setMsg(friendlyError(error)); return; }
    setArchiving(null); setReason(""); setMsg("Fiche archivée."); void load();
  }

  if (patient === undefined) return <p className="text-slate-500">Chargement…</p>;
  if (patient === null) return <p>Patient introuvable ou non autorisé.</p>;

  const byDate = docs.reduce<Record<string, Doc[]>>((acc, d) => { (acc[d.document_date] ??= []).push(d); return acc; }, {});

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="h1" data-testid="patient-name">{patient.last_name} {patient.first_name}</h1>
            <p className="text-slate-600">Dossier {patient.file_number}
              {patient.birth_date ? ` · né(e) le ${formatDate(patient.birth_date)}` : ""}{patient.phone ? ` · ${patient.phone}` : ""}</p>
            <p className="text-xs text-slate-500">Créé le {formatDateTime(patient.created_at)} · modifié le {formatDateTime(patient.updated_at)}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/scan" className="btn-primary">📷 Scanner</Link>
            <button className="btn-secondary" onClick={() => setEditing(true)}>Modifier l&apos;identité</button>
          </div>
        </div>
      </section>
      {editing && <EditIdentity p={patient} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); void load(); }} />}
      {msg && <p className="rounded bg-emerald-50 p-2 text-sm" role="status">{msg}</p>}

      <section className="space-y-4">
        <h2 className="h2">Fiches ({docs.length})</h2>
        {docs.length === 0 && <p className="text-sm text-slate-500">Aucune fiche.</p>}
        {Object.entries(byDate).map(([date, list]) => (
          <div key={date} className="space-y-2">
            <h3 className="font-semibold text-slate-700">{formatDate(date)}</h3>
            {list.map((d) => (
              <article key={d.id} className={`card space-y-2 ${d.status === "archived" ? "opacity-60" : ""}`} data-testid="patient-document">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    {d.page_count} page{d.page_count > 1 ? "s" : ""} · ajoutée le {formatDateTime(d.created_at)} par {names.get(d.created_by) ?? "—"}
                    {d.device_label ? ` (${d.device_label})` : ""} · version {d.version}
                    {d.status === "archived" ? " · ARCHIVÉE" : ""}
                  </p>
                  <ServerStatusBadge status={d.sync_status} />
                </div>
                {d.note && <p className="text-sm italic text-slate-700">« {d.note} »</p>}
                <Thumbs docId={d.id} />
                <div className="flex flex-wrap gap-2">
                  <Link href={`/document?id=${d.id}`} className="btn-secondary">Ouvrir</Link>
                  {canCorrect && d.status === "active" && (
                    <>
                      <button className="btn-secondary" onClick={() => setMoving(d)} data-testid="move-document">Déplacer vers un autre patient</button>
                      <button className="btn-danger" onClick={() => { setArchiving(d); setReason(""); }}>Archiver</button>
                    </>
                  )}
                </div>
                {archiving?.id === d.id && (
                  <div className="rounded-lg bg-red-50 p-3 text-sm space-y-2">
                    <p>L&apos;archivage masque la fiche sans l&apos;effacer (restauration possible par un administrateur).</p>
                    <input className="input" placeholder="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button className="btn-danger" disabled={reason.trim().length < 3} onClick={archive}>Archiver</button>
                      <button className="btn-secondary" onClick={() => setArchiving(null)}>Annuler</button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        ))}
      </section>

      {canCorrect && (
        <section className="space-y-2">
          <h2 className="h2">Historique des modifications</h2>
          <ul className="card divide-y divide-slate-100 text-sm" data-testid="patient-history">
            {history.length === 0 && <li className="py-2 text-slate-500">Aucune entrée.</li>}
            {history.map((h) => (
              <li key={h.id} className="py-2">
                <span className="text-slate-500">{formatDateTime(h.created_at)}</span> · <strong>{ACTION_LABELS[h.action] ?? h.action}</strong>
                {" "}· {names.get(h.user_id ?? "") ?? "—"}
                {typeof h.new_value?.reason === "string" && <span> · motif : « {h.new_value.reason} »</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {moving && <MoveDialog doc={moving} patientId={patient.id} onCancel={() => setMoving(null)}
        onDone={() => { setMoving(null); setMsg("Fiche déplacée. La correction est tracée dans l'historique."); void load(); }} />}
    </div>
  );
}

export default function Page() {
  return <AppShell><Suspense><PatientView /></Suspense></AppShell>;
}
