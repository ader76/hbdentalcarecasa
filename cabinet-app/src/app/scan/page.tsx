"use client";
// Parcours quotidien : patient → photos → vérification → enregistrement → synchronisation.
// Chaque photo est écrite dans la file locale dès sa prise : rien n'est gardé
// uniquement en mémoire.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Area } from "react-easy-crop";
import { AppShell } from "@/components/AppShell";
import { PatientPicker, type PickedPatient } from "@/components/PatientPicker";
import { PageEditor, Thumb } from "@/components/PageEditor";
import { StatusBadge } from "@/components/StatusBadge";
import { useSync } from "@/components/SyncProvider";
import { useAuth } from "@/components/AuthProvider";
import { commitDraft, deleteDoc, getDoc, getPages, saveDraft, type QueueDoc, type QueuePage } from "@/lib/queue/db";
import { normalizeCapture, renderPage, ImageProcessingError } from "@/lib/image/process";
import { MAX_PAGES_PER_DOCUMENT, NOTE_MAX_LENGTH } from "@/lib/constants";
import { localIsoDate, uuid } from "@/lib/text";

type Step = "patient" | "capture" | "done";

function newDraft(p: PickedPatient, owner: { user_id: string; cabinet_id: string }): QueueDoc {
  const now = new Date().toISOString();
  return {
    id: uuid(), userId: owner.user_id, cabinetId: owner.cabinet_id, patientId: p.id, patientLabel: p.label, documentDate: localIsoDate(), note: "",
    pageIds: [], status: "draft", createdAt: now, updatedAt: now, attempts: 0,
    serverCreated: false, uploadedPageIds: [],
  };
}

function Scan() {
  const router = useRouter();
  const params = useSearchParams();
  const { docs, syncNow, online } = useSync();
  const { member } = useAuth();
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [step, setStep] = useState<Step>("patient");
  const [doc, setDoc] = useState<QueueDoc | null>(null);
  const [pages, setPages] = useState<QueuePage[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [changingPatient, setChangingPatient] = useState(false);

  // Reprise d'un brouillon (application fermée pendant la capture).
  useEffect(() => {
    const id = params.get("draft");
    if (!id) return;
    (async () => {
      const d = await getDoc(id);
      if (d && d.status === "draft" && d.userId === member?.user_id) {
        setDoc(d);
        setPages(await getPages(id));
        setStep("capture");
      }
    })();
  }, [params, member?.user_id]);

  const persist = useCallback(async (d: QueueDoc, ps: QueuePage[]) => {
    await saveDraft(d, ps);
    setDoc({ ...d, pageIds: ps.map((p) => p.id) });
    setPages(ps);
  }, []);

  async function pickPatient(p: PickedPatient) {
    if (doc && changingPatient) {
      await persist({ ...doc, patientId: p.id, patientLabel: p.label }, pages);
      setChangingPatient(false);
      return;
    }
    if (!member) return;
    const d = newDraft(p, member);
    await persist(d, []);
    setStep("capture");
  }

  async function processFile(file: File): Promise<QueuePage | null> {
    try {
      const source = await normalizeCapture(file);
      const out = await renderPage(source, []);
      return { id: uuid(), docId: doc!.id, source, ops: [], ...out };
    } catch (e) {
      setError(e instanceof ImageProcessingError ? e.message : "Photo illisible. Reprenez la photo.");
      return null;
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files || !doc) return;
    setError(null);
    const list = [...files];
    if (pages.length + list.length > MAX_PAGES_PER_DOCUMENT) {
      setError(`Maximum ${MAX_PAGES_PER_DOCUMENT} pages par fiche.`);
      return;
    }
    setBusy((b) => b + list.length);
    let current = pages;
    for (const f of list) {
      const p = await processFile(f);
      if (p) {
        current = [...current, p];
        await persist(doc, current);   // enregistré immédiatement dans la file locale
      }
      setBusy((b) => b - 1);
    }
  }

  async function editPage(i: number, fn: (p: QueuePage) => Promise<QueuePage | null>) {
    if (!doc) return;
    setBusy((b) => b + 1);
    try {
      const next = await fn(pages[i]);
      if (next) await persist(doc, pages.map((p, j) => (j === i ? next : p)));
    } catch {
      setError("Traitement impossible. Reprenez la photo.");
    } finally {
      setBusy((b) => b - 1);
    }
  }

  const rotate = (i: number, deg: 90 | -90) => editPage(i, async (p) => {
    const ops = [...p.ops, { type: "rotate" as const, deg }];
    return { ...p, ops, ...(await renderPage(p.source, ops)) };
  });
  const cropPage = (i: number, a: Area) => editPage(i, async (p) => {
    const ops = [...p.ops, { type: "crop" as const, x: a.x, y: a.y, width: a.width, height: a.height }];
    return { ...p, ops, ...(await renderPage(p.source, ops)) };
  });
  // Une page reprise reçoit un nouvel identifiant : son contenu est différent.
  const retake = (i: number, f: File) => editPage(i, (p) => processFile(f).then((n) => n && { ...n, id: uuid(), docId: p.docId }));

  async function removePage(i: number) {
    if (!doc) return;
    await persist(doc, pages.filter((_, j) => j !== i));
    setOpen(null);
  }
  async function move(i: number, dir: -1 | 1) {
    if (!doc) return;
    const next = [...pages];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    await persist(doc, next);
    setOpen(i + dir);
  }

  async function save() {
    if (!doc || pages.length === 0) return;
    await saveDraft(doc, pages);
    await commitDraft(doc.id, { note: doc.note.trim().slice(0, NOTE_MAX_LENGTH), documentDate: doc.documentDate });
    setStep("done");
    void syncNow({ force: true, onlyDocId: doc.id });
  }

  async function abandon() {
    if (doc) await deleteDoc(doc.id);
    router.replace("/");
  }

  function nextSheet() {
    setDoc(null);
    setPages([]);
    setOpen(null);
    setError(null);
    setStep("patient");
    router.replace("/scan");
  }

  if (step === "patient" || changingPatient) {
    return (
      <div className="space-y-4">
        <h1 className="h1">{changingPatient ? "Changer de patient" : "1. Choisir le patient"}</h1>
        <PatientPicker onPick={pickPatient} />
        {changingPatient && <button className="btn-secondary w-full" onClick={() => setChangingPatient(false)}>Annuler</button>}
      </div>
    );
  }

  if (step === "done" && doc) {
    const live = docs.find((d) => d.id === doc.id);
    const status = live?.status ?? "pending";
    return (
      <div className="space-y-5">
        <h1 className="h1">Fiche enregistrée</h1>
        <div className="card space-y-3">
          <p className="font-medium">{doc.patientLabel}</p>
          <p className="text-sm text-slate-600">{pages.length} page{pages.length > 1 ? "s" : ""}</p>
          {status === "failed" ? (
            <button onClick={() => syncNow({ force: true, onlyDocId: doc.id })}><StatusBadge status="failed" /></button>
          ) : (
            <StatusBadge status={status} offline={!online} />
          )}
          {live?.lastError && status !== "synced" && <p className="text-sm text-red-700">{live.lastError}</p>}
          {status !== "synced" && (
            <p className="text-sm text-slate-600">La fiche est conservée sur ce téléphone jusqu&apos;à la confirmation du serveur. Vous pouvez continuer.</p>
          )}
        </div>
        <button className="btn-primary w-full py-5 text-lg" onClick={nextSheet} data-testid="next-sheet">Fiche suivante</button>
        <button className="btn-secondary w-full" onClick={() => router.push("/")}>Retour à l&apos;accueil</button>
      </div>
    );
  }

  if (!doc) return null;
  const n = pages.length;
  return (
    <div className="space-y-4 pb-28">
      <div className="card flex items-center justify-between gap-2 border-teal-300 bg-teal-50">
        <div>
          <p className="text-xs uppercase text-teal-800">Patient</p>
          <p className="text-lg font-semibold" data-testid="selected-patient">{doc.patientLabel}</p>
        </div>
        <button className="btn-secondary" onClick={() => setChangingPatient(true)}>Changer</button>
      </div>

      <h1 className="h1">2. Photographier la fiche</h1>
      <label className="btn-primary w-full cursor-pointer py-5 text-lg">
        📷 {n === 0 ? "Prendre la première page" : `Ajouter la page ${n + 1}`}
        <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="capture-input"
          onChange={(e) => { const f = e.target.files; void addFiles(f).finally(() => { e.target.value = ""; }); }} />
      </label>
      <label className="block text-center text-sm text-teal-800 underline">
        ou importer depuis la galerie / l&apos;ordinateur
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple className="sr-only" data-testid="import-input"
          onChange={(e) => { const f = e.target.files; void addFiles(f).finally(() => { e.target.value = ""; }); }} />
      </label>

      {busy > 0 && <p className="text-sm text-slate-600" aria-live="polite">Traitement de la photo…</p>}
      {error && <p role="alert" data-testid="scan-error" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {n > 0 && (
        <>
          <p className="text-sm text-slate-600">Appuyez sur une page pour la vérifier, la tourner, la recadrer, la reprendre ou la supprimer.</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {pages.map((p, i) => <Thumb key={p.id} page={p} index={i} onOpen={() => setOpen(i)} />)}
          </div>
          <div className="card space-y-3">
            <label className="block"><span className="text-sm font-medium">Date de la fiche</span>
              <input type="date" className="input mt-1" value={doc.documentDate} max={localIsoDate()}
                onChange={(e) => e.target.value && persist({ ...doc, documentDate: e.target.value }, pages)} /></label>
            <label className="block"><span className="text-sm font-medium">Note (facultative)</span>
              <textarea className="input mt-1" rows={2} maxLength={NOTE_MAX_LENGTH} value={doc.note}
                onChange={(e) => setDoc({ ...doc, note: e.target.value })} onBlur={() => persist(doc, pages)} /></label>
          </div>
        </>
      )}

      {!confirmAbandon ? (
        <button className="w-full py-2 text-sm text-slate-500 underline" onClick={() => setConfirmAbandon(true)}>Abandonner cette fiche</button>
      ) : (
        <div className="rounded-lg bg-red-50 p-3 text-sm" role="alert">
          <p className="mb-2">Les {n} photo(s) de cette fiche seront effacées de ce téléphone.</p>
          <div className="flex gap-2">
            <button className="btn-danger" onClick={abandon}>Effacer la fiche</button>
            <button className="btn-secondary" onClick={() => setConfirmAbandon(false)}>Garder</button>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3">
        <button className="btn-primary mx-auto w-full max-w-6xl py-4 text-lg" disabled={n === 0 || busy > 0} onClick={save} data-testid="save-sync">
          Enregistrer et synchroniser ({n} page{n > 1 ? "s" : ""})
        </button>
      </div>

      {open !== null && pages[open] && (
        <PageEditor page={pages[open]} index={open} total={n} busy={busy > 0} onClose={() => setOpen(null)}
          onRotate={(d) => rotate(open, d)} onCrop={(a) => cropPage(open, a)} onRetake={(f) => retake(open, f)}
          onDelete={() => removePage(open)} onMove={(d) => move(open, d)} />
      )}
    </div>
  );
}

export default function ScanPage() {
  return <AppShell><Suspense><Scan /></Suspense></AppShell>;
}
