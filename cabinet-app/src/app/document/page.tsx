"use client";
// Lecteur : pages dans l'ordre, zoom, rotation d'affichage, navigation clavier.
// La rotation ici ne modifie jamais l'image originale conservée.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SecureImage } from "@/components/SecureImage";
import { supabase } from "@/lib/supabase/client";
import { fetchDocumentImages, type PageImage } from "@/lib/api";
import { useMemberNames } from "@/lib/useMembers";
import { formatDate, formatDateTime } from "@/lib/text";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/constants";

interface DocInfo {
  id: string; patient_id: string; document_date: string; note: string | null; page_count: number;
  created_at: string; created_by: string; version: number; sync_status: string;
  patients: { last_name: string; first_name: string; file_number: string } | null;
}

function Viewer() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const names = useMemberNames();
  const [doc, setDoc] = useState<DocInfo | null | undefined>(undefined);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [idx, setIdx] = useState(Math.max(0, Number(params.get("page") ?? 1) - 1));
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadImages = useCallback(() => {
    fetchDocumentImages(id).then(setPages, () => setError("Images indisponibles (réseau ou droits)."));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    supabase().from("documents").select("*, patients(last_name,first_name,file_number)").eq("id", id).maybeSingle()
      .then(({ data }) => setDoc(data as DocInfo | null));
    loadImages();
    // Les liens signés expirent : on les renouvelle avant l'expiration.
    const t = setInterval(loadImages, (SIGNED_URL_TTL_SECONDS - 30) * 1000);
    return () => clearInterval(t);
  }, [id, loadImages]);

  const go = useCallback((d: number) => {
    setIdx((i) => Math.min(Math.max(0, i + d), Math.max(0, pages.length - 1)));
    setZoom(1);
    setRot(0);
  }, [pages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.25));
      else if (e.key === "-") setZoom((z) => Math.max(0.5, z / 1.25));
      else if (e.key.toLowerCase() === "r") setRot((r) => (r + 90) % 360);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (doc === undefined) return <p className="text-slate-500">Chargement…</p>;
  if (doc === null) return <p>Fiche introuvable ou non autorisée.</p>;
  const page = pages[idx];
  const sideways = rot % 180 !== 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/patient?id=${doc.patient_id}`} className="text-sm text-teal-800 underline">
            ← {doc.patients?.last_name} {doc.patients?.first_name} · {doc.patients?.file_number}
          </Link>
          <h1 className="h2">Fiche du {formatDate(doc.document_date)}</h1>
          <p className="text-xs text-slate-500">Ajoutée le {formatDateTime(doc.created_at)} par {names.get(doc.created_by) ?? "—"} · version {doc.version}</p>
          {doc.note && <p className="text-sm italic">« {doc.note} »</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Lecteur">
          <button className="btn-secondary" onClick={() => go(-1)} disabled={idx === 0} aria-label="Page précédente">‹</button>
          <span className="min-w-16 text-center text-sm" data-testid="page-indicator">Page {pages.length ? idx + 1 : 0} / {doc.page_count}</span>
          <button className="btn-secondary" onClick={() => go(1)} disabled={idx >= pages.length - 1} aria-label="Page suivante">›</button>
          <button className="btn-secondary" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))} aria-label="Dézoomer">−</button>
          <span className="w-12 text-center text-sm">{Math.round(zoom * 100)} %</span>
          <button className="btn-secondary" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoomer">+</button>
          <button className="btn-secondary" onClick={() => setRot((r) => (r + 270) % 360)} aria-label="Tourner à gauche">⟲</button>
          <button className="btn-secondary" onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Tourner à droite">⟳</button>
          <button className="btn-secondary" onClick={() => { setZoom(1); setRot(0); }}>Ajuster</button>
        </div>
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="h-[75vh] overflow-auto rounded-xl border border-slate-300 bg-slate-800"
        onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setZoom((z) => Math.min(6, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 0.9)))); } }}>
        {page?.url && (
          <div className="flex min-h-full min-w-full items-center justify-center p-2"
            style={{ width: `${zoom * 100}%`, height: sideways ? `${zoom * 100}%` : undefined }}>
            <SecureImage src={page.url} alt={`Page ${page.pageNumber}`} data-testid="viewer-image"
              style={{ transform: `rotate(${rot}deg)`, maxWidth: sideways ? "none" : "100%", maxHeight: sideways ? "100%" : undefined, width: sideways ? "auto" : "100%" }}
              className="bg-white object-contain transition-transform" />
          </div>
        )}
      </div>
      {page && <p className="text-xs text-slate-500">Reçue le {formatDateTime(page.receivedAt)} · {page.width}×{page.height} px · {(page.size / 1024).toFixed(0)} Ko · empreinte {page.sha256.slice(0, 12)}…</p>}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {pages.map((p, i) => (
          <button key={p.id} onClick={() => { setIdx(i); setZoom(1); setRot(0); }}
            className={`relative w-16 shrink-0 overflow-hidden rounded border-2 ${i === idx ? "border-teal-600" : "border-transparent"}`}>
            <SecureImage src={p.thumbUrl} alt={`Miniature page ${p.pageNumber}`} className="aspect-[3/4] w-full bg-white object-contain" />
            <span className="absolute left-0.5 top-0.5 rounded bg-teal-800 px-1 text-xs text-white">{p.pageNumber}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  return <AppShell><Suspense><Viewer /></Suspense></AppShell>;
}
