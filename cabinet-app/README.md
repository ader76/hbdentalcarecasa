# Fiches cabinet — numérisation des fiches patients (V1)

PWA (Android + Windows) pour photographier les fiches papier du cabinet, les rattacher au bon patient et les retrouver sur l'ordinateur, même après une coupure réseau.

- Documentation : [`docs/`](docs/) — commencer par [`docs/14-rapport-phase-1.md`](docs/14-rapport-phase-1.md).
- Données : **uniquement fictives** en développement. Aucune vraie fiche, aucun vrai nom.

## Démarrage local (développeurs)
Pré-requis : Node 22, Docker.
```bash
npm install
npx supabase start          # pile locale (Postgres, Auth, Storage)
cp .env.example .env.local  # puis y reporter les valeurs affichées par « supabase status »
npm run db:reset            # schéma + données fictives
npm run build && npm start  # http://localhost:3000
```
Comptes fictifs (mot de passe `Fictif-Demo-2026!`) : `dentiste@cabinet-a.test`, `assistant@cabinet-a.test`, `admin@cabinet-a.test`, `dentiste@cabinet-b.test` (autre cabinet).

> Si les images `public.ecr.aws` sont bloquées par votre réseau : `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start`.

## Vérifications
```bash
npm run lint && npm run typecheck && npm run build
npm test && npm run test:tz
npm run test:integration   # remet la base locale à zéro
npm run test:e2e
npm run test:restore
```
