"use client";
import { useState } from "react";
import { deleteDoc, type QueueDoc } from "@/lib/queue/db";
import { formatDate, formatDateTime } from "@/lib/text";
import { StatusBadge } from "./StatusBadge";
import { useSync } from "./SyncProvider";

export function QueueItem({ doc }: { doc: QueueDoc }) {
  const { syncNow, online } = useSync();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const retry = () => syncNow({ force: true, onlyDocId: doc.id });
  return (
    <li className="card space-y-2" data-testid="queue-item" data-doc-id={doc.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{doc.patientLabel}</p>
          <p className="text-sm text-slate-600">
            {doc.pageIds.length} page{doc.pageIds.length > 1 ? "s" : ""} · fiche du {formatDate(doc.documentDate)}
          </p>
        </div>
        {doc.status === "failed" ? (
          <button onClick={retry} aria-label="Réessayer l'envoi"><StatusBadge status="failed" /></button>
        ) : (
          <StatusBadge status={doc.status} offline={!online} />
        )}
      </div>
      {doc.lastError && doc.status !== "synced" && <p className="text-sm text-red-700">{doc.lastError}</p>}
      {doc.status === "synced" && doc.syncedAt && (
        <p className="text-xs text-slate-500">Confirmée par le serveur le {formatDateTime(doc.syncedAt)}. Copie locale supprimée.</p>
      )}
      {(doc.status === "failed" || doc.status === "pending") && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={retry} disabled={!online}>Réessayer</button>
          {doc.status === "failed" && doc.errorKind === "rejected" && !confirmDelete && (
            <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Supprimer de ce téléphone</button>
          )}
          {confirmDelete && (
            <div className="w-full rounded-lg bg-red-50 p-3 text-sm">
              <p className="mb-2">Les photos de cette fiche seront définitivement effacées de ce téléphone. Reprenez d&apos;abord la fiche si besoin.</p>
              <div className="flex gap-2">
                <button className="btn-danger" onClick={() => deleteDoc(doc.id)}>Confirmer la suppression</button>
                <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function QueueList({ docs }: { docs: QueueDoc[] }) {
  if (docs.length === 0) return <p className="text-sm text-slate-500">Aucun envoi récent depuis cet appareil.</p>;
  return <ul className="space-y-3">{docs.map((d) => <QueueItem key={d.id} doc={d} />)}</ul>;
}
