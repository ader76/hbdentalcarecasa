# Registre des décisions

| # | Date | Décision | Raison | Réversible ? |
|---|------|----------|--------|--------------|
| D1 | 28/09/2026 | Application placée dans `cabinet-app/` du dépôt existant (site vitrine) | Seul dépôt autorisé dans cette session | Oui — **recommandé : dépôt privé séparé avant toute fusion dans `main`** (GitHub Pages publierait le code source et la documentation) |
| D2 | 28/09/2026 | PWA Next.js 16 + Supabase (recommandation du brief) | Simple, une seule base, RLS + auth + stockage privé intégrés | Oui |
| D3 | 28/09/2026 | Pages statiques rendues côté client ; ids en paramètre d'URL | Ouverture hors ligne via service worker | Oui |
| D4 | 28/09/2026 | Écritures uniquement via fonctions SQL auditées ; pages uniquement via le serveur | Contrôle d'accès et journal atomiques ; intégrité vérifiée | Oui |
| D5 | 28/09/2026 | Identifiants générés sur l'appareil (UUID) | Idempotence : un renvoi ne crée jamais de doublon | Non (structurant) |
| D6 | 28/09/2026 | Réduction à 2400 px, JPEG 0,85 | ≈200 dpi A4 : manuscrit lisible, ~0,5–1,5 Mo/page | Oui (constantes) |
| D7 | 28/09/2026 | Pas de Background Sync ; déclencheurs multiples + bouton | Background Sync limité sur certains téléphones (brief §6) | Oui |
| D8 | 28/09/2026 | Révocation vérifiée à chaque requête (table des sessions) | Téléphone perdu : coupure immédiate sans attendre l'expiration du jeton (15 min) | Oui |
| D9 | 28/09/2026 | Sauvegarde logique chiffrée maison (AES-256-GCM, scrypt) en plus des sauvegardes de l'hébergeur | Copie hors site, indépendante du fournisseur, restauration testable | Oui |
| D10 | 28/09/2026 | Codex, Muse Code et AGY CLI absents : travail réalisé par Claude Code ; 2ᵉ revue par un agent Claude indépendant en lecture seule | Outils non installés dans l'environnement ; aucune installation/compte sans autorisation | Oui |
| D11 | 28/09/2026 | Tests e2e dans un Chromium headless local (pas de contrôle de votre navigateur) | Brief §13 : pas de contrôle de l'interface de Reda | — |
| D12 | 28/09/2026 | Télémétrie Next.js désactivée | Projet de santé : aucune donnée d'usage envoyée | Oui |
| D13 | 28/09/2026 | Fiches locales liées au compte qui les a prises ; seul ce compte les envoie | Téléphone partagé : pas d'envoi sous le mauvais nom ni dans le mauvais cabinet (2ᵉ revue) | Oui |
| D14 | 28/09/2026 | Images affichées via téléchargement `no-store` + blob en mémoire | Aucune copie des fiches dans le cache disque d'un PC partagé (2ᵉ revue) | Oui |
| D15 | 28/09/2026 | Seul l'auteur d'une fiche peut y ajouter des pages ; dimensions ≤ 4000 px contrôlées avant décodage | Intégrité des fiches, protection mémoire du serveur (2ᵉ revue) | Oui |
