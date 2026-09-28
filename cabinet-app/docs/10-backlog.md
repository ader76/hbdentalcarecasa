# Backlog par phase

Répartition prévue par le brief : **Codex** (pilotage, contrats, intégration, revue), **Muse Code** (tickets UI délimités), **AGY CLI** (vérification, cas limites, 2ᵉ revue). Ces trois outils n'étant pas installés, la phase 1 a été réalisée par Claude Code (voir D10). Les tickets restent rédigés pour pouvoir être confiés à ces agents ensuite.

## Phase 1 — V1 (fait)
| Ticket | Propriétaire prévu | Fichiers | État |
|--------|-------------------|----------|------|
| T1 Schéma, RLS, fonctions, bucket | Codex | `supabase/migrations/**` | Fait, testé |
| T2 Contrat d'envoi des pages + validation | Codex | `src/app/api/**`, `src/lib/jpeg.ts`, `src/lib/server/**` | Fait, testé |
| T3 File locale + moteur de synchronisation | Codex | `src/lib/queue/**` | Fait, testé |
| T4 Écran de capture et d'édition | Muse Code | `src/app/scan/**`, `src/components/PageEditor.tsx`, `src/lib/image/**` | Fait, testé (sauf recadrage auto) |
| T5 Sélection / création patient | Muse Code | `src/components/PatientPicker.tsx` | Fait, testé |
| T6 Écrans Windows | Muse Code | `src/app/{dashboard,patient,document,journal,comptes}/**` | Fait, testé |
| T7 Auth, verrouillage, TOTP | Codex | `src/components/{AuthProvider,LoginForm,AppShell}.tsx`, `src/app/securite/**` | Fait ; TOTP testé côté base, écran non testé en e2e |
| T8 PWA (manifest, service worker) | Muse Code | `public/sw.js`, `src/app/manifest.ts` | Fait, ouverture hors ligne testée |
| T9 Sauvegarde / restauration | AGY CLI | `scripts/backup*.mts`, `scripts/restore.mts` | Fait, restauration testée |
| T10 Tests (unit, intégration, e2e) + 2ᵉ revue | AGY CLI | `tests/**` | Fait |

## Phase 1-bis — mise en service (à faire, nécessite vos autorisations)
| Ticket | Détail | Bloqué par |
|--------|--------|------------|
| M1 | Créer le projet Supabase (région à choisir) | Autorisation inscription + choix région |
| M2 | Hébergement HTTPS de l'application (ex. Vercel ou serveur au Maroc) | Autorisation inscription / dépense |
| M3 | Essai réel Android (installation PWA, 20 fiches fictives, mode avion) | M1, M2 |
| M4 | Essai réel Windows Chrome + Edge | M1, M2 |
| M5 | Sauvegarde planifiée (hebdo + avant mise à jour) vers un disque externe | M1 |
| M6 | Intégration continue (lint, types, tests) sur GitHub Actions | Accord |
| M7 | Dépôt privé séparé pour l'application | Votre décision (D1) |
| M8 | Création des comptes réels + activation TOTP | M1 |

## Phase 1.1 — numérisation améliorée
QR code par dossier papier (confirmation d'identité obligatoire) · recadrage automatique · netteté/contraste · OCR assisté avec validation humaine · recherche dans les données validées.

## Phase 2 — dossier clinique structuré
Antécédents · pathologies (renseignées par le dentiste) · allergies · traitements · alertes · notes · consultations · conseils validés · rappels.

## Phase 3 — ordonnances assistées
Catalogue national versionné · favoris · champs modifiables · alertes (source fiable) · PDF « Brouillon » → validation explicite → versions.
