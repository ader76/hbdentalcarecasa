<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Règles du projet (tous les agents)

- Lire `docs/09-registre-des-decisions.md` et `docs/10-backlog.md` avant de modifier le code.
- **Données fictives uniquement.** Jamais de nom, photo, diagnostic ou donnée de patient réel dans le code, les tests, les prompts, les journaux ou les messages d'erreur.
- Aucun secret dans le dépôt ; `SUPABASE_SERVICE_ROLE_KEY` uniquement dans du code serveur (`import "server-only"`).
- Aucune écriture directe dans les tables depuis le navigateur : passer par une fonction SQL qui vérifie le rôle et journalise.
- Ne jamais afficher « Synchronisée » sans confirmation du serveur ; ne jamais supprimer une photo locale avant cette confirmation.
- Un agent = une liste de fichiers dont il est propriétaire (voir le backlog) ; pas de modification simultanée des mêmes fichiers.
- Une fonctionnalité n'est « terminée » qu'après lint, types, build, tests concernés verts et vérification de bout en bout.
- Pas de déploiement, d'inscription à un service, de dépense ou de suppression irréversible sans autorisation explicite de Reda.
