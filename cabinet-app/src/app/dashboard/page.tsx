"use client";
// Tableau de bord (usage principal sur l'ordinateur Windows).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ServerStatusBadge } from "@/components/StatusBadge";
import { QueueList } from "@/components/QueueList";
import { useSync } from "@/components/SyncProvider";
import { supabase } from "@/lib/supabase/client";
import { formatDate, formatDateTime } from "@/lib/text";

interface DocRow {
  id: string; patient_id: string; last_name: string; first_name: string; file_number: string;
  page_count: number; sync_status: "receiving" | "synced"; created_at: string; document_date?: string;
  pages_received?: number; device_label?: string | null;
}
interface Summary {
  today: string; timezone: string;
  imported_today: DocRow[];
  recent_patients: { id: string; last_name: string; first_name: string; file_number: string; phone: string | null; updated_at: string }[];
  incomplete: DocRow[];
}
interface SearchResult { kind: "patient" | "document"; id: string; title: string; subtitle: string; href: string }

function Dashboard() {
  const { docs } = useSync();
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("dashboard_summary");
    if (error) setError("Tableau de bord indisponible (réseau ?)."); else { setS(data as Summary); setError(null); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : l'état n'est mis à jour qu'après la réponse réseau
    void load();
    const t = setInterval(load, 30_000); // les nouvelles fiches apparaissent sans action manuelle
    return () => clearInterval(t);
  }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const out: SearchResult[] = [];
    if (q.trim()) {
      const { data } = await supabase().rpc("search_patients", { p_query: q, p_limit: 30 });
      for (const p of (data ?? []) as { id: string; last_name: string; first_name: string; file_number: string; phone: string | null; birth_date: string | null }[]) {
        out.push({ kind: "patient", id: p.id, title: `${p.last_name} ${p.first_name}`,
          subtitle: `${p.file_number}${p.phone ? ` · ${p.phone}` : ""}${p.birth_date ? ` · né(e) le ${formatDate(p.birth_date)}` : ""}`, href: `/patient?id=${p.id}` });
      }
    }
    if (date) {
      const { data } = await supabase().from("documents")
        .select("id,document_date,page_count,patient_id,patients(last_name,first_name,file_number)")
        .eq("document_date", date).order("created_at", { ascending: false }).limit(100);
      for (const d of (data ?? []) as unknown as { id: string; page_count: number; document_date: string; patients: { last_name: string; first_name: string; file_number: string } }[]) {
        out.push({ kind: "document", id: d.id, title: `Fiche du ${formatDate(d.document_date)} — ${d.patients.last_name} ${d.patients.first_name}`,
          subtitle: `${d.patients.file_number} · ${d.page_count} page(s)`, href: `/document?id=${d.id}` });
      }
    }
    setResults(out);
  }

  const localFailed = docs.filter((d) => d.status === "failed");
  const localWaiting = docs.filter((d) => d.status === "pending" || d.status === "uploading");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="h1">Tableau de bord</h1>
        <button className="btn-secondary" onClick={load}>Actualiser</button>
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}

      <form onSubmit={search} className="card grid gap-3 sm:grid-cols-[1fr_auto_auto]" role="search">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, prénom, téléphone ou n° de dossier" aria-label="Recherche patient" />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date de fiche" />
        <button className="btn-primary">Rechercher</button>
        {results && (
          <ul className="space-y-1 sm:col-span-3">
            {results.length === 0 && <li className="text-sm text-slate-500">Aucun résultat.</li>}
            {results.map((r) => (
              <li key={`${r.kind}-${r.id}`}><Link href={r.href} className="block rounded-lg px-3 py-2 hover:bg-slate-50">
                <span className="font-medium">{r.title}</span> <span className="text-sm text-slate-600">{r.subtitle}</span></Link></li>
            ))}
          </ul>
        )}
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-2" data-testid="imported-today">
          <h2 className="h2">Fiches importées aujourd&apos;hui {s ? `(${s.imported_today.length})` : ""}</h2>
          {s?.imported_today.length === 0 && <p className="text-sm text-slate-500">Aucune fiche aujourd&apos;hui.</p>}
          <ul className="divide-y divide-slate-100">
            {s?.imported_today.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/document?id=${d.id}`} className="hover:underline">
                  <span className="font-medium">{d.last_name} {d.first_name}</span>
                  <span className="text-sm text-slate-600"> · {d.file_number} · {d.page_count} p. · {formatDateTime(d.created_at)}</span>
                </Link>
                <ServerStatusBadge status={d.sync_status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-2">
          <h2 className="h2">Patients récemment modifiés</h2>
          <ul className="divide-y divide-slate-100">
            {s?.recent_patients.map((p) => (
              <li key={p.id} className="py-2">
                <Link href={`/patient?id=${p.id}`} className="hover:underline">
                  <span className="font-medium">{p.last_name} {p.first_name}</span>
                  <span className="text-sm text-slate-600"> · {p.file_number} · {formatDateTime(p.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-2" data-testid="incomplete">
          <h2 className="h2">Envois incomplets (pages manquantes depuis plus de 30 min)</h2>
          <p className="text-xs text-slate-500">Fiches commencées mais non terminées : l&apos;appareil d&apos;origine doit être ouvert et connecté pour finir l&apos;envoi.</p>
          {s?.incomplete.length === 0 && <p className="text-sm text-slate-500">Aucun.</p>}
          <ul className="divide-y divide-slate-100">
            {s?.incomplete.map((d) => (
              <li key={d.id} className="py-2 text-sm">
                <Link href={`/patient?id=${d.patient_id}`} className="font-medium hover:underline">{d.last_name} {d.first_name}</Link>
                {" "}· {d.pages_received}/{d.page_count} pages · commencé le {formatDateTime(d.created_at)} {d.device_label ? `· ${d.device_label}` : ""}
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-2">
          <h2 className="h2">Échecs de synchronisation sur cet appareil</h2>
          {localFailed.length === 0 && localWaiting.length === 0 && <p className="text-sm text-slate-500">Aucun envoi en échec ou en attente sur cet appareil.</p>}
          <QueueList docs={[...localFailed, ...localWaiting]} />
        </section>
      </div>
      {s && <p className="text-xs text-slate-500">Date du jour selon le fuseau du cabinet ({s.timezone}) : {formatDate(s.today)}</p>}
    </div>
  );
}

export default function Page() {
  return <AppShell><Dashboard /></AppShell>;
}
