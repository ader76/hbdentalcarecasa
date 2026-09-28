"use client";
// Transport réseau réel du moteur de synchronisation.
import { accessToken, supabase } from "@/lib/supabase/client";
import { SyncError, type SyncTransport } from "./sync";
import type { SyncErrorKind } from "./db";

export function deviceLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const os = /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Autre";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  return `${br} ${os}`;
}

function classifyRpc(error: { message?: string; code?: string; status?: number } | null): SyncError {
  const msg = error?.message ?? "";
  const code = error?.code ?? "";
  if ((typeof navigator !== "undefined" && !navigator.onLine) || /fetch|network|Load failed/i.test(msg)) {
    return new SyncError("network", "réseau");
  }
  let kind: SyncErrorKind = "server";
  if (code === "42501" || code === "PGRST301" || code === "PGRST303" || /JWT/i.test(msg)) kind = "auth";
  else if (code === "23505") kind = "conflict";
  else if (code === "P0002") return new SyncError("server", "introuvable");
  else if (code === "22023") kind = "rejected";
  if (code === "P0001" && /incomplet/.test(msg)) return new SyncError("server", "incomplet");
  return new SyncError(kind, kind === "server" ? "erreur serveur" : msg);
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  if (!token) throw new SyncError("auth", "non connecté");
  let res;
  try {
    res = await supabase().rpc(fn, args);
  } catch {
    throw new SyncError("network", "réseau");
  }
  if (res.error) throw classifyRpc(res.error);
  return res.data as T;
}

export function createTransport(): SyncTransport {
  const device = deviceLabel();
  return {
    async createPatient(p) {
      await rpc("create_patient", {
        p_id: p.id, p_last_name: p.lastName, p_first_name: p.firstName,
        p_phone: p.phone, p_birth_date: p.birthDate, p_device: device,
      });
    },
    async createDocument(d) {
      await rpc("create_document", {
        p_id: d.id, p_patient_id: d.patientId, p_document_date: d.documentDate,
        p_note: d.note || null, p_page_count: d.pageIds.length, p_device: device,
      });
    },
    async uploadPage(d, page, pageNumber) {
      const token = await accessToken();
      if (!token) throw new SyncError("auth", "non connecté");
      const qs = new URLSearchParams({ documentId: d.id, pageId: page.id, pageNumber: String(pageNumber) });
      let res: Response;
      try {
        res = await fetch(`/api/pages?${qs}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "x-content-sha256": page.sha256 },
          body: page.blob,
          cache: "no-store",
        });
      } catch {
        throw new SyncError("network", "réseau");
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { receivedSha256: String(body.receivedSha256 ?? "") };
      if (res.status === 401 || res.status === 403) throw new SyncError("auth", body.error ?? "accès refusé");
      if (res.status === 409) throw new SyncError("conflict", body.error ?? "conflit");
      if (res.status === 404) throw new SyncError("server", "introuvable");
      if (res.status === 400 || res.status === 413 || res.status === 415 || res.status === 422) {
        throw new SyncError("rejected", `Page ${pageNumber} : ${body.error ?? "refusée"}.`);
      }
      throw new SyncError(res.status >= 500 ? "server" : "network", `HTTP ${res.status}`);
    },
    async finalizeDocument(id) {
      const d = await rpc<{ sync_status: string; page_count: number }>("finalize_document", { p_id: id });
      return { syncStatus: d.sync_status, pageCount: d.page_count };
    },
  };
}
