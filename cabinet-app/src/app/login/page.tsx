"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/components/AuthProvider";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, refresh } = useAuth();
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  useEffect(() => {
    if (state.status === "ready") router.replace(target);
  }, [state.status, router, target]);

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center p-6">
      <h1 className="h1 mb-1">Fiches cabinet</h1>
      <p className="mb-6 text-sm text-slate-600">Connexion réservée au personnel du cabinet.</p>
      <div className="card">
        <LoginForm onDone={async () => { await refresh(); }} />
      </div>
      <p className="mt-6 text-xs text-slate-500">Mot de passe oublié ou téléphone perdu : contactez l&apos;administrateur du cabinet.</p>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}
