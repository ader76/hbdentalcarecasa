"use client";
import type { DocStatus } from "@/lib/queue/db";

const LABELS: Record<DocStatus, { text: string; cls: string; icon: string }> = {
  draft: { text: "Brouillon", cls: "bg-slate-100 text-slate-700 border-slate-300", icon: "✎" },
  pending: { text: "En attente", cls: "bg-amber-50 text-amber-800 border-amber-300", icon: "⏳" },
  uploading: { text: "En cours d'envoi", cls: "bg-sky-50 text-sky-800 border-sky-300", icon: "↑" },
  synced: { text: "Synchronisée et vérifiée", cls: "bg-emerald-50 text-emerald-800 border-emerald-400", icon: "✓" },
  failed: { text: "Échec, appuyer pour réessayer", cls: "bg-red-50 text-red-800 border-red-400", icon: "!" },
};

export function statusText(s: DocStatus): string {
  return LABELS[s].text;
}

export function StatusBadge({ status, offline }: { status: DocStatus; offline?: boolean }) {
  const l = LABELS[status];
  return (
    <span data-testid="sync-status" data-status={status}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-medium ${l.cls}`}>
      <span aria-hidden>{l.icon}</span>
      {l.text}
      {offline && status === "pending" ? " (hors connexion)" : ""}
    </span>
  );
}

export function ServerStatusBadge({ status }: { status: "receiving" | "synced" }) {
  return status === "synced" ? (
    <span className="inline-flex rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Complète et vérifiée</span>
  ) : (
    <span className="inline-flex rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Incomplète (pages en cours de réception)</span>
  );
}
