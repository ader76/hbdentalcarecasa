"use client";
// Comptes du cabinet : révocation des sessions (téléphone perdu), activation.
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { supabase, friendlyError } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/text";

interface M { user_id: string; full_name: string; role: string; status: "active" | "disabled"; email: string; last_login_at: string | null; active_sessions: number }

function Comptes() {
  const { can, member } = useAuth();
  const [rows, setRows] = useState<M[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase().rpc("list_members");
    setRows((data ?? []) as M[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : l'état n'est mis à jour qu'après la réponse réseau
  useEffect(() => { void load(); }, [load]);

  async function revoke(m: M) {
    if (!confirm(`Déconnecter tous les appareils de ${m.full_name} ?`)) return;
    const { data, error } = await supabase().rpc("admin_revoke_sessions", { p_user_id: m.user_id });
    setMsg(error ? friendlyError(error) : `${data} session(s) révoquée(s). L'accès est coupé immédiatement.`);
    void load();
  }
  async function setStatus(m: M, status: "active" | "disabled") {
    const { error } = await supabase().rpc("admin_set_member_status", { p_user_id: m.user_id, p_status: status });
    setMsg(error ? friendlyError(error) : status === "disabled" ? "Compte désactivé et déconnecté." : "Compte réactivé.");
    void load();
  }

  return (
    <div className="space-y-4">
      <h1 className="h1">Comptes du cabinet</h1>
      <div className="card space-y-1 border-amber-300 bg-amber-50 text-sm">
        <p className="font-semibold">Téléphone perdu ou volé</p>
        <ol className="list-decimal pl-5">
          <li>Appuyez sur « Déconnecter tous les appareils » pour le compte concerné : l&apos;accès aux données est coupé immédiatement.</li>
          <li>Changez le mot de passe du compte (administrateur Supabase).</li>
          <li>Les fiches non envoyées restées sur le téléphone perdu ne pourront plus être envoyées : reprenez ces fiches papier.</li>
        </ol>
      </div>
      {msg && <p role="status" className="rounded bg-emerald-50 p-2 text-sm">{msg}</p>}
      <ul className="space-y-2">
        {rows.map((m) => (
          <li key={m.user_id} className="card flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{m.full_name} <span className="text-sm text-slate-500">({m.role})</span> {m.status === "disabled" && <span className="text-sm text-red-700">— désactivé</span>}</p>
              <p className="text-sm text-slate-600">{m.email} · dernière connexion : {m.last_login_at ? formatDateTime(m.last_login_at) : "jamais"} · {m.active_sessions} session(s) active(s)</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => revoke(m)}>Déconnecter tous les appareils</button>
              {can("admin") && m.user_id !== member?.user_id && (m.status === "active"
                ? <button className="btn-danger" onClick={() => setStatus(m, "disabled")}>Désactiver</button>
                : <button className="btn-secondary" onClick={() => setStatus(m, "active")}>Réactiver</button>)}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">La création de comptes se fait par l&apos;administrateur (voir docs/exploitation.md) : l&apos;inscription publique est désactivée.</p>
    </div>
  );
}

export default function Page() {
  return <AppShell roles={["dentiste", "admin"]}><Comptes /></AppShell>;
}
