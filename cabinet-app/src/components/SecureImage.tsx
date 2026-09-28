"use client";
// Affiche une image via un lien signé SANS la laisser dans le cache disque du
// navigateur (poste partagé) : téléchargement « no-store » puis affichage depuis la mémoire.
import { useEffect, useState, type ImgHTMLAttributes } from "react";

export function SecureImage({ src, alt, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!src) return;
    let created: string | null = null;
    let cancelled = false;
    fetch(src, { cache: "no-store", referrerPolicy: "no-referrer" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (cancelled) return;
        created = URL.createObjectURL(b);
        setUrl(created);
        setFailed(false);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);
  if (failed) return <span className="block p-2 text-xs text-red-700">Image indisponible</span>;
  if (!url) return <span className="block aspect-[3/4] w-full animate-pulse bg-slate-200" aria-busy="true" />;
  return <img src={url} alt={alt} {...rest} />;
}
