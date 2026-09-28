"use client";
// Session, profil du membre et verrouillage après inactivité.
// La protection réelle des données est côté serveur (RLS + routes API) ;
// ce composant ne gère que l'expérience utilisateur.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { clearSensitiveCache } from "@/lib/queue/db";

export type Role = "dentiste" | "assistant" | "admin";

export interface Member {
  user_id: string;
  cabinet_id: string;
  full_name: string;
  role: Role;
  cabinet_name: string;
  idle_lock_minutes: number;
  timezone: string;
}

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "mfa"; session: Session }
  | { status: "denied"; session: Session }
  | { status: "ready"; session: Session; member: Member; locked: boolean };

interface AuthApi {
  state: AuthState;
  member: Member | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  unlock: () => void;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthApi | null>(null);
const MEMBER_CACHE = "cabinet-member";   // profil (nom, rôle) pour l'usage hors connexion
const LOCK_FLAG = "cabinet-locked";

function readCachedMember(uid: string): Member | null {
  try {
    const m = JSON.parse(localStorage.getItem(MEMBER_CACHE) ?? "null") as Member | null;
    return m && m.user_id === uid ? m : null;
  } catch {
    return null;
  }
}

async function loadMember(session: Session): Promise<Member | null | "offline"> {
  const { data, error } = await supabase()
    .from("members")
    .select("user_id,cabinet_id,full_name,role,cabinets(name,settings)")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) {
    if (/fetch|network/i.test(error.message) || !navigator.onLine) return "offline";
    return null;
  }
  if (!data) return null;
  const cab = (Array.isArray(data.cabinets) ? data.cabinets[0] : data.cabinets) as { name: string; settings: Record<string, unknown> } | null;
  return {
    user_id: data.user_id,
    cabinet_id: data.cabinet_id,
    full_name: data.full_name,
    role: data.role as Role,
    cabinet_name: cab?.name ?? "",
    idle_lock_minutes: Number(cab?.settings?.idle_lock_minutes ?? 10),
    timezone: String(cab?.settings?.timezone ?? "Africa/Casablanca"),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const loadingRef = useRef(false);

  const evaluate = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: "signedOut" });
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Double authentification activée mais pas encore validée pour cette session.
      const { data: aal } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
        setState({ status: "mfa", session });
        return;
      }
      const m = await loadMember(session);
      const locked = sessionStorage.getItem(LOCK_FLAG) === "1" || localStorage.getItem(LOCK_FLAG) === "1";
      if (m === "offline") {
        const cached = readCachedMember(session.user.id);
        setState(cached ? { status: "ready", session, member: cached, locked } : { status: "denied", session });
        return;
      }
      if (!m) {
        setState({ status: "denied", session });
        return;
      }
      localStorage.setItem(MEMBER_CACHE, JSON.stringify(m));
      setState({ status: "ready", session, member: m, locked });
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => evaluate(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setState({ status: "signedOut" });
      else if (event === "SIGNED_IN" || event === "MFA_CHALLENGE_VERIFIED" || event === "USER_UPDATED") {
        setTimeout(() => evaluate(session), 0);
      } else if (event === "TOKEN_REFRESHED" && session) {
        setState((s) => (s.status === "ready" ? { ...s, session } : s));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  // Verrouillage après inactivité : l'écran exige le mot de passe, mais les
  // envois en attente continuent (aucune perte de fiche).
  const member = state.status === "ready" ? state.member : null;
  const idleMinutes = member?.idle_lock_minutes ?? 10;
  useEffect(() => {
    if (state.status !== "ready" || state.locked) return;
    let timer: ReturnType<typeof setTimeout>;
    const lock = () => {
      localStorage.setItem(LOCK_FLAG, "1");
      setState((s) => (s.status === "ready" ? { ...s, locked: true } : s));
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, idleMinutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [state.status, state.status === "ready" && state.locked, idleMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const api: AuthApi = {
    state,
    member,
    refresh: async () => {
      const { data } = await supabase().auth.getSession();
      await evaluate(data.session);
    },
    signOut: async () => {
      await clearSensitiveCache();
      localStorage.removeItem(MEMBER_CACHE);
      localStorage.removeItem(LOCK_FLAG);
      await supabase().auth.signOut({ scope: "local" });
      setState({ status: "signedOut" });
    },
    unlock: () => {
      localStorage.removeItem(LOCK_FLAG);
      sessionStorage.removeItem(LOCK_FLAG);
      setState((s) => (s.status === "ready" ? { ...s, locked: false } : s));
    },
    can: (...roles) => !!member && roles.includes(member.role),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth hors AuthProvider");
  return v;
}
