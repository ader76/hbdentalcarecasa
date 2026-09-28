"use client";
// Édition d'une page avant l'envoi : rotation, recadrage, reprise, suppression, ordre.
import { useEffect, useMemo, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import type { QueuePage } from "@/lib/queue/db";

export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

export function Thumb({ page, index, onOpen }: { page: QueuePage; index: number; onOpen: () => void }) {
  const url = useObjectUrl(page.thumb);
  return (
    <button onClick={onOpen} className="relative overflow-hidden rounded-lg border border-slate-300 bg-white" data-testid="page-thumb"
      aria-label={`Page ${index + 1} : ouvrir pour vérifier`}>
      {url && <img src={url} alt={`Page ${index + 1}`} className="aspect-[3/4] w-full object-contain" />}
      <span className="absolute left-1 top-1 rounded bg-teal-800 px-1.5 text-sm font-semibold text-white">{index + 1}</span>
    </button>
  );
}

export function PageEditor({ page, index, total, busy, onClose, onRotate, onCrop, onRetake, onDelete, onMove }: {
  page: QueuePage; index: number; total: number; busy: boolean;
  onClose: () => void; onRotate: (deg: 90 | -90) => void; onCrop: (a: Area) => void;
  onRetake: (file: File) => void; onDelete: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const url = useObjectUrl(page.blob);
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-white" role="dialog" aria-label={`Page ${index + 1}`}>
      <div className="flex items-center justify-between p-3">
        <span className="font-semibold">Page {index + 1} / {total}</span>
        <button className="rounded-lg bg-white/10 px-4 py-2" onClick={onClose}>Fermer</button>
      </div>
      <div className="relative flex-1">
        {url && cropping ? (
          <Cropper image={url} crop={crop} zoom={zoom} aspect={undefined} objectFit="contain"
            onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, px) => setArea(px)}
            initialCroppedAreaPercentages={{ x: 2, y: 2, width: 96, height: 96 }} />
        ) : url ? (
          <img src={url} alt={`Page ${index + 1} en grand`} className="absolute inset-0 h-full w-full object-contain" />
        ) : null}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/40">Traitement…</div>}
      </div>
      {cropping ? (
        <div className="grid grid-cols-2 gap-2 p-3">
          <button className="btn-primary" disabled={!area || busy} onClick={() => { if (area) onCrop(area); setCropping(false); }}>Valider le recadrage</button>
          <button className="rounded-xl bg-white/10 py-3" onClick={() => setCropping(false)}>Annuler</button>
        </div>
      ) : confirmDelete ? (
        <div className="space-y-2 p-3">
          <p>Supprimer cette page ?</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-xl bg-red-600 py-3 font-semibold" onClick={onDelete}>Supprimer</button>
            <button className="rounded-xl bg-white/10 py-3" onClick={() => setConfirmDelete(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-3 text-sm">
          <button className="rounded-xl bg-white/10 py-3" disabled={busy} onClick={() => onRotate(-90)}>⟲ Tourner</button>
          <button className="rounded-xl bg-white/10 py-3" disabled={busy} onClick={() => onRotate(90)}>⟳ Tourner</button>
          <button className="rounded-xl bg-white/10 py-3" disabled={busy} onClick={() => { setZoom(1); setCrop({ x: 0, y: 0 }); setCropping(true); }}>✂ Recadrer</button>
          <label className="flex cursor-pointer items-center justify-center rounded-xl bg-white/10 py-3">
            📷 Reprendre
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onRetake(f); }} />
          </label>
          <button className="rounded-xl bg-white/10 py-3" disabled={index === 0 || busy} onClick={() => onMove(-1)}>↑ Avant</button>
          <button className="rounded-xl bg-white/10 py-3" disabled={index === total - 1 || busy} onClick={() => onMove(1)}>↓ Après</button>
          <button className="col-span-3 rounded-xl bg-red-600/80 py-3" disabled={busy} onClick={() => setConfirmDelete(true)}>🗑 Supprimer la page</button>
        </div>
      )}
    </div>
  );
}
