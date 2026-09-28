"use client";
// Journal d'audit (lecture seule, dentiste et administrateur).
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/lib/supabase/client";
import { ACTION_LABELS, useMemberNames } from "@/lib/useMembers";
import { formatDateTime } from "@/lib/text";

interface Row {
  id: number; action: string; user_id: string | null; entity_type: string; entity_id: string | null;
  patient_id: string | null; created_at: string; result: string; device: string | null;
  new_value: Record<string, unknown> | null;
}

function Journal() {
  const names = useMemberNames();
  const [rows, setRows] = useState<Row[]>([]);
  const [action, setAction] = useState("");
  useEffect(() => {
    let q = supabase().from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
    if (action) q = q.eq("action", action);
    q.then(({ data }) => setRows((data ?? []) as Row[]));
  }, [action]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Journal des actions</h1>
      <select className="input max-w-xs" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filtrer par action">
        <option value="">Toutes les actions</option>
        {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="p-2">Date</th><th className="p-2">Utilisateur</th><th className="p-2">Action</th><th className="p-2">Détail</th><th className="p-2">Résultat</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap p-2">{formatDateTime(r.created_at)}</td>
                <td className="p-2">{names.get(r.user_id ?? "") ?? "—"}</td>
                <td className="p-2">{ACTION_LABELS[r.action] ?? r.action}</td>
                <td className="p-2">
                  {r.patient_id && <Link className="underline" href={`/patient?id=${r.patient_id}`}>dossier</Link>}
                  {typeof r.new_value?.reason === "string" && <span> · motif : « {r.new_value.reason} »</span>}
                  {r.device && <span className="text-slate-500"> · {r.device}</span>}
                </td>
                <td className="p-2">{r.result === "success" ? "OK" : r.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page() {
  return <AppShell roles={["dentiste", "admin"]}><Journal /></AppShell>;
}
