"use client";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { QueueList } from "@/components/QueueList";
import { useSync } from "@/components/SyncProvider";
import { useAuth } from "@/components/AuthProvider";

function Home() {
  const { docs, otherUserDocs, online, syncNow, running } = useSync();
  const { member } = useAuth();
  const drafts = docs.filter((d) => d.status === "draft");
  const sent = docs.filter((d) => d.status !== "draft");
  const toRetry = sent.filter((d) => d.status === "failed" || d.status === "pending").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">Bonjour {member?.full_name}</p>
      <Link href="/scan" className="btn-primary w-full py-6 text-xl" data-testid="scan-button">📷 Scanner une fiche</Link>

      {drafts.map((d) => (
        <Link key={d.id} href={`/scan?draft=${d.id}`} className="card block border-amber-300 bg-amber-50">
          <p className="font-medium">Fiche en cours non enregistrée</p>
          <p className="text-sm">{d.patientLabel} · {d.pageIds.length} page(s) — appuyer pour reprendre</p>
        </Link>
      ))}

      {otherUserDocs > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">
          {otherUserDocs} fiche(s) d&apos;un autre compte attendent sur cet appareil : elles seront envoyées quand ce compte se reconnectera.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="h2">Envois de cet appareil</h2>
          {toRetry > 0 && (
            <button className="btn-secondary" disabled={!online || running} onClick={() => syncNow({ force: true })}>
              {running ? "Envoi…" : "Tout réessayer"}
            </button>
          )}
        </div>
        {!online && <p className="rounded-lg bg-slate-800 p-3 text-sm text-white">Hors connexion : les fiches sont conservées sur ce téléphone et seront envoyées au retour du réseau.</p>}
        <QueueList docs={sent} />
      </section>

      <Link href="/dashboard" className="btn-secondary w-full">Ouvrir le tableau de bord</Link>
    </div>
  );
}

export default function Page() {
  return <AppShell><Home /></AppShell>;
}
