"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

/** Noms des membres du cabinet (pour afficher l'auteur d'un ajout). */
export function useMemberNames(): Map<string, string> {
  const [map, setMap] = useState(new Map<string, string>());
  useEffect(() => {
    supabase().from("members").select("user_id,full_name").then(({ data }) => {
      if (data) setMap(new Map(data.map((m) => [m.user_id as string, m.full_name as string])));
    });
  }, []);
  return map;
}

export const ACTION_LABELS: Record<string, string> = {
  "session.open": "Connexion",
  "patient.create": "Création du patient",
  "patient.update": "Modification de l'identité",
  "document.create": "Nouvelle fiche",
  "page.receive": "Page reçue et vérifiée",
  "document.synced": "Fiche complète et vérifiée",
  "document.move": "Fiche déplacée vers ce patient",
  "document.move_out": "Fiche retirée de ce patient (déplacée)",
  "document.archive": "Fiche archivée",
  "document.view": "Consultation des images",
  "member.revoke_sessions": "Sessions révoquées",
  "member.set_status": "Statut du compte modifié",
};
