# Architecture

```
Téléphone Android (Chrome, PWA installée)        PC Windows (Chrome / Edge)
 ├─ Pages statiques (coquilles, en cache SW)       └─ mêmes pages (tableau de bord, lecteur)
 ├─ IndexedDB : file locale persistante
 │    (brouillons, photos en attente, cache patients)
 └─ Moteur de synchronisation (à l'ouverture, au retour réseau, toutes les 30 s, « Réessayer »)
          │ HTTPS
          ▼
 Next.js (serveur Node)                            Supabase
  ├─ PUT /api/pages ─── vérifie, nettoie ────────► Storage : bucket PRIVÉ « fiches »
  └─ GET /api/documents/:id/images ─ liens signés 5 min
          │ (clé service_role : serveur uniquement)
          ▼
 PostgreSQL (RLS)  ◄──── RPC authentifiées (patients, fiches, corrections) depuis le navigateur
```

## Choix
- **Une seule application web (PWA)** pour Android et Windows, une seule base, un seul mécanisme de synchronisation.
- **Next.js 16 + TypeScript**, pages rendues côté client et pré-générées (statiques) : elles se mettent en cache facilement → l'application s'ouvre sans réseau. Les identifiants passent en paramètre d'URL (`/patient?id=…`) pour garder des pages statiques.
- **Supabase** : authentification (mot de passe, TOTP, sessions révocables), PostgreSQL avec RLS, stockage privé.
- **Écritures uniquement par fonctions SQL** (`create_patient`, `create_document`, `finalize_document`, `move_document`…) qui vérifient le rôle et écrivent le journal dans la même transaction. Aucun `insert/update/delete` direct depuis le navigateur.
- **Pages enregistrées uniquement par le serveur** (`/api/pages`) après contrôle du fichier ; le navigateur n'a aucun accès direct au stockage.
- **Traitement d'image sur le téléphone** (canvas) : orientation corrigée, réduction à 2400 px (≈200 dpi A4), JPEG qualité 0,85, métadonnées supprimées, miniature. Rotations/recadrages appliqués à la source en un seul ré-encodage.
- **Côté serveur** : retrait sans perte des segments EXIF/XMP restants, décodage complet (fichier corrompu refusé), miniature, relecture du fichier stocké et comparaison d'empreinte.

## Arborescence
- `supabase/migrations/` : schéma, RLS, fonctions, bucket.
- `src/lib/queue/` : file IndexedDB, moteur de synchronisation, transport réseau.
- `src/lib/image/` : traitement des photos (navigateur). `src/lib/jpeg.ts` : nettoyage JPEG (serveur).
- `src/app/api/` : routes serveur. `src/app/*/page.tsx` : écrans.
- `scripts/` : données fictives, sauvegarde, restauration, test de restauration.
- `tests/` : unitaires, intégration (pile Supabase locale), bout en bout (Playwright).

## Limites connues
- CSP avec `'unsafe-inline'` pour les scripts (pages statiques sans nonce). Risque XSS atténué : React échappe tout, aucun HTML injecté.
- Service worker simple (cache des coquilles) ; pas de synchronisation en arrière-plan (volontaire, cf. décisions).
- Pas encore de pipeline CI.
