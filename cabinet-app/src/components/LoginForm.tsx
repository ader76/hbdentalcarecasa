"use client";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { deviceLabel } from "@/lib/queue/transport";

/** Connexion par e-mail + mot de passe, puis code à 6 chiffres si la double authentification est activée. */
export function LoginForm({ presetEmail, onDone }: { presetEmail?: string; onDone: () => void }) {
  const [email, setEmail] = useState(presetEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<{ factorId: string } | null>(null);
  const [code, setCode] = useState("");

  async function afterPassword() {
    const sb = supabase();
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: factors } = await sb.auth.mfa.listFactors();
      const f = factors?.totp.find((x) => x.status === "verified");
      if (f) { setMfa({ factorId: f.id }); return; }
    }
    await finish();
  }

  async function finish() {
    await supabase().rpc("touch_member", { p_device: deviceLabel() });
    onDone();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!navigator.onLine) { setError("Connexion Internet nécessaire pour se connecter."); return; }
      if (mfa) {
        const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: mfa.factorId, code: code.trim() });
        if (error) { setError("Code incorrect ou expiré."); return; }
        await finish();
        return;
      }
      const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setError("E-mail ou mot de passe incorrect."); return; }
      await afterPassword();
    } catch {
      setError("Réseau indisponible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Connexion">
      {!mfa ? (
        <>
          <label className="block">
            <span className="text-sm font-medium">E-mail</span>
            <input type="email" required autoComplete="username" value={email} readOnly={!!presetEmail}
              onChange={(e) => setEmail(e.target.value)} className="input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Mot de passe</span>
            <input type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className="input mt-1" autoFocus={!!presetEmail} />
          </label>
        </>
      ) : (
        <label className="block">
          <span className="text-sm font-medium">Code à 6 chiffres de votre application d&apos;authentification</span>
          <input inputMode="numeric" pattern="[0-9]{6}" required autoFocus value={code}
            onChange={(e) => setCode(e.target.value)} className="input mt-1 tracking-widest" autoComplete="one-time-code" />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Connexion…" : mfa ? "Valider le code" : "Se connecter"}
      </button>
    </form>
  );
}
