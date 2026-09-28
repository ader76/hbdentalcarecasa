"use client";
import { accessToken } from "@/lib/supabase/client";

export interface PageImage {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  size: number;
  sha256: string;
  receivedAt: string;
  thumbUrl: string | null;
  url: string | null;
}

/** Liens signés (5 min) vers les pages d'un document. */
export async function fetchDocumentImages(documentId: string, thumbsOnly = false): Promise<PageImage[]> {
  const token = await accessToken();
  if (!token) throw new Error("non connecté");
  const res = await fetch(`/api/documents/${documentId}/images${thumbsOnly ? "?thumbs=1" : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).pages as PageImage[];
}
