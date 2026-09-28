"use client";
// Double authentification (TOTP) : recommandée pour tous les comptes.
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase/client";

interface Factor { id: string; status: string; friendly_name?: string }

function Securite() {
  const { signOut } = useAuth();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : l'état n'est mis à jour qu'après la réponse réseau
  useEffect(() => { void load(); }, [load]);

  async function start() {
    setMsg(null);
    const { data, error } = await supabase().auth.mfa.enroll({ factorType: "totp", friendlyName: `Téléphone ${new Date().toLocaleDateString("fr-FR")}` });
    if (error || !data) { setMsg("Activation impossible pour le moment."); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function verify() {
    if (!enroll) return;
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    if (error) { setMsg("Code incorrect. Réessayez."); return; }
    setEnroll(null); setCode(""); setMsg("Double authentification activée."); void load();
  }
  async function remove(id: string) {
    if (!confirm("Désactiver la double authentification ?")) return;
    const { error } = await supabase().auth.mfa.unenroll({ factorId: id });
    setMsg(error ? "Impossible (reconnectez-vous avec votre code puis réessayez)." : "Désactivée.");
    void load();
  }
  const verified = factors.filter((f) => f.status === "verified");

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="h1">Sécurité du compte</h1>
      <section className="card space-y-3">
        <h2 className="h2">Double authentification</h2>
        <p className="text-sm text-slate-600">Un code à 6 chiffres (application Google Authenticator, Microsoft Authenticator…) sera demandé à chaque connexion.</p>
        {verified.length > 0 ? (
          <>
            <p className="text-emerald-800">✓ Activée</p>
            {verified.map((f) => <button key={f.id} className="btn-danger" onClick={() => remove(f.id)}>Désactiver</button>)}
          </>
        ) : enroll ? (
          <div className="space-y-3">
            <p className="text-sm">1. Scannez ce QR code avec l&apos;application d&apos;authentification.</p>
            <img src={enroll.qr} alt="QR code d'activation" className="h-48 w-48 rounded bg-white p-2" />
            <p className="break-all text-xs text-slate-500">Ou saisissez la clé : {enroll.secret}</p>
            <p className="text-sm">2. Saisissez le code affiché :</p>
            <input className="input" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn-primary" onClick={verify}>Valider</button>
          </div>
        ) : (
          <button className="btn-primary" onClick={start}>Activer la double authentification</button>
        )}
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </section>
      <section className="card space-y-2">
        <h2 className="h2">Session</h2>
        <p className="text-sm text-slate-600">L&apos;application se verrouille après une période d&apos;inactivité. La déconnexion efface la liste des patients mémorisée sur cet appareil, mais conserve les fiches non encore envoyées.</p>
        <button className="btn-secondary" onClick={signOut}>Se déconnecter</button>
      </section>
    </div>
  );
}

export default function Page() {
  return <AppShell><Securite /></AppShell>;
}
