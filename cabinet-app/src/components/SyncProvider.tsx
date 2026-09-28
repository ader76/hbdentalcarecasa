"use client";
// Déclenche la synchronisation : à l'ouverture, au retour du réseau, au retour
// au premier plan, toutes les 30 s tant que l'application est ouverte, et à la
// demande (« Réessayer »). Tient à jour la liste locale des fiches.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { listDocs, onQueueChange, pruneSynced, replacePatientCache, requestPersistentStorage, type QueueDoc } from "@/lib/queue/db";
import { recoverIfIdle, runSync, type SyncReport } from "@/lib/queue/sync";
import { createTransport } from "@/lib/queue/transport";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "./AuthProvider";

interface SyncApi {
  /** Fiches du compte connecté. */
  docs: QueueDoc[];
  /** Fiches d'un autre compte restées sur cet appareil (non envoyées tant qu'il ne se reconnecte pas). */
  otherUserDocs: number;
  online: boolean;
  running: boolean;
  lastReport: SyncReport | null;
  syncNow: (opts?: { force?: boolean; onlyDocId?: string }) => Promise<void>;
  refreshPatientCache: () => Promise<void>;
}

const Ctx = createContext<SyncApi | null>(null);

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { state, member } = useAuth();
  const ready = state.status === "ready";
  const userId = member?.user_id;
  const [allDocs, setDocs] = useState<QueueDoc[]>([]);
  const docs = allDocs.filter((d) => d.userId === userId);
  const otherUserDocs = allDocs.filter((d) => d.userId !== userId && d.status !== "synced").length;
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [running, setRunning] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const transport = useRef(createTransport());
  const busy = useRef(false);

  const reload = useCallback(async () => setDocs(await listDocs()), []);

  const syncNow = useCallback(async (opts?: { force?: boolean; onlyDocId?: string }) => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    try {
      if (!userId) return;
      const r = await runSync(transport.current, { ...opts, userId });
      if (r.ran) setLastReport(r);
    } finally {
      busy.current = false;
      setRunning(false);
      await reload();
    }
  }, [reload, userId]);

  const refreshPatientCache = useCallback(async () => {
    if (!navigator.onLine) return;
    const { data, error } = await supabase()
      .from("patients")
      .select("id,last_name,first_name,phone,birth_date,file_number")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (!error && data) await replacePatientCache(data);
  }, []);

  useEffect(() => {
    requestPersistentStorage();
    recoverIfIdle().then(reload);
    pruneSynced().catch(() => undefined);
    return onQueueChange(() => { void reload(); });
  }, [reload]);

  useEffect(() => {
    if (!ready) return;
    void syncNow();
    void refreshPatientCache();
    const onOnline = () => { void syncNow({ force: true }); void refreshPatientCache(); };
    const onVisible = () => { if (document.visibilityState === "visible") void syncNow(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const iv = setInterval(() => { void syncNow(); }, 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(iv);
    };
  }, [ready, syncNow, refreshPatientCache]);

  return (
    <Ctx.Provider value={{ docs, otherUserDocs, online, running, lastReport, syncNow, refreshPatientCache }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSync hors SyncProvider");
  return v;
}
