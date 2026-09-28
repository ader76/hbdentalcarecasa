"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth, type Role } from "./AuthProvider";
import { useSync } from "./SyncProvider";
import { LoginForm } from "./LoginForm";

const NAV: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/", label: "Accueil" },
  { href: "/scan", label: "Scanner" },
  { href: "/patients", label: "Patients" },
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/journal", label: "Journal", roles: ["dentiste", "admin"] },
  { href: "/comptes", label: "Comptes", roles: ["dentiste", "admin"] },
  { href: "/securite", label: "Sécurité" },
];

function SyncIndicator() {
  const { docs, online, running } = useSync();
  const waiting = docs.filter((d) => d.status === "pending" || d.status === "uploading").length;
  const failed = docs.filter((d) => d.status === "failed").length;
  return (
    <Link href="/" className="flex items-center gap-2 text-xs" data-testid="sync-indicator">
      {!online && <span className="rounded bg-slate-700 px-2 py-0.5 text-white">Hors connexion</span>}
      {failed > 0 && <span className="rounded bg-red-600 px-2 py-0.5 text-white">{failed} échec{failed > 1 ? "s" : ""}</span>}
      {waiting > 0 && <span className="rounded bg-amber-500 px-2 py-0.5 text-white">{running ? "Envoi…" : `${waiting} en attente`}</span>}
    </Link>
  );
}

export function AppShell({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { state, member, signOut, unlock, refresh, can } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (state.status === "signedOut") router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [state.status, router, path]);

  if (state.status === "loading" || state.status === "signedOut") {
    return <div className="p-8 text-center text-slate-500">Chargement…</div>;
  }
  if (state.status === "mfa") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-xl font-semibold">Double authentification</h1>
        <LoginForm presetEmail={state.session.user.email} onDone={refresh} />
      </main>
    );
  }
  if (state.status === "denied") {
    return (
      <main className="mx-auto max-w-sm space-y-4 p-6 text-center">
        <p>Ce compte n&apos;a pas accès à l&apos;application (compte désactivé ou session révoquée).</p>
        <button className="btn-secondary" onClick={signOut}>Se déconnecter</button>
      </main>
    );
  }
  if (state.locked) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold">Application verrouillée</h1>
        <p className="mb-4 text-sm text-slate-600">Verrouillage après inactivité. Les envois en attente continuent.</p>
        <LoginForm presetEmail={state.session.user.email} onDone={async () => { unlock(); await refresh(); }} />
        <button className="mt-6 w-full text-sm text-slate-600 underline" onClick={signOut}>Changer d&apos;utilisateur</button>
      </main>
    );
  }
  const allowed = !roles || (member && roles.includes(member.role));

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <button className="rounded p-2 lg:hidden" aria-label="Menu" onClick={() => setMenuOpen((v) => !v)}>☰</button>
          <Link href="/" className="font-semibold text-teal-800">Fiches cabinet</Link>
          <nav className="ml-4 hidden gap-1 lg:flex">
            {NAV.filter((n) => !n.roles || can(...n.roles)).map((n) => (
              <Link key={n.href} href={n.href}
                className={`rounded px-3 py-1.5 text-sm ${path === n.href ? "bg-teal-50 font-medium text-teal-800" : "text-slate-700 hover:bg-slate-100"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto"><SyncIndicator /></div>
        </div>
        {menuOpen && (
          <nav className="border-t border-slate-200 px-4 py-2 lg:hidden">
            {NAV.filter((n) => !n.roles || can(...n.roles)).map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className="block rounded px-2 py-3 text-base">
                {n.label}
              </Link>
            ))}
            <button onClick={signOut} className="block w-full px-2 py-3 text-left text-base text-slate-600">Se déconnecter</button>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
        {allowed ? children : <p className="text-slate-600">Cette page est réservée aux rôles : {roles?.join(", ")}.</p>}
      </main>
      <footer className="mx-auto hidden w-full max-w-6xl items-center justify-between px-4 py-3 text-xs text-slate-500 lg:flex">
        <span>{member?.full_name} · {member?.role} · {member?.cabinet_name}</span>
        <button onClick={signOut} className="underline">Se déconnecter</button>
      </footer>
    </div>
  );
}

