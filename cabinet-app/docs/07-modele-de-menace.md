# Modèle de menace (V1)

Actifs : images des fiches, identité des patients, journal. Acteurs : personnel du cabinet (3 rôles), autre cabinet, personne extérieure, voleur de téléphone, prestataire d'hébergement.

| Menace | Mesure en place | Vérifié par | Risque résiduel |
|--------|-----------------|-------------|-----------------|
| Accès d'un autre cabinet | RLS sur toutes les tables, FK composites, fonctions vérifiant `cabinet_id` | `security.test.ts`, e2e « autre cabinet » | Faible |
| Accès anonyme / inscription | Aucun droit `anon`, inscription publique désactivée | `security.test.ts` | Faible |
| Élévation de rôle (assistant) | Rôle vérifié dans les fonctions ; aucune écriture directe | `security.test.ts` | Faible |
| URL publique vers une fiche | Bucket privé, aucun accès direct client, liens signés 5 min, `Referrer-Policy: no-referrer` | `security.test.ts` | Un lien copié reste valable ≤ 5 min |
| Téléphone perdu/volé | Verrouillage après 10 min d'inactivité ; révocation immédiate des sessions (vérifiée à chaque requête) ; désactivation du compte | `workflow.test.ts` | Les photos **non encore envoyées** restent dans le stockage du navigateur du téléphone (non chiffré par l'application) → exiger un verrouillage d'écran Android + chiffrement de l'appareil |
| Vol de mot de passe | 12 caractères min., TOTP optionnel (exigé en base dès qu'activé), sessions 24 h max / 8 h d'inactivité | `workflow.test.ts` (TOTP) | Tant que le TOTP n'est pas activé : mot de passe seul |
| Fichier malveillant / corrompu | Signature JPEG, taille ≤ 8 Mo, dimensions ≤ 4000 px vérifiées **avant** décodage, décodage complet (sharp), JPEG seul accepté par le bucket | `upload.test.ts` | Faible (bibliothèque libvips à maintenir à jour) |
| Fuite de métadonnées (GPS) | Ré-encodage canvas + analyse complète du JPEG côté serveur : retrait EXIF/XMP, images secondaires (MPF), commentaires, segments entre scans, données après la fin d'image | `jpeg.test.ts`, `upload.test.ts` | Faible |
| Copie des fiches sur un PC partagé | Images téléchargées en `no-store` et affichées depuis la mémoire ; objets stockés avec `max-age=0` ; déconnexion efface le cache patients | e2e (`blob:`), `upload.test.ts` | Captures d'écran / impressions hors du contrôle de l'application |
| Téléphone partagé entre deux comptes | Fiches locales liées au compte et au cabinet ; envoyées uniquement par ce compte | `sync.test.ts` | Les photos en attente d'un compte restent sur l'appareil jusqu'à sa reconnexion |
| Falsification du journal | Déclencheur refusant UPDATE/DELETE | `security.test.ts` | Un super-utilisateur de la base peut désactiver le déclencheur |
| Clé d'administration exposée | `service_role` uniquement dans les routes serveur (`server-only`), jamais préfixée `NEXT_PUBLIC_` | revue de code | À contrôler au déploiement |
| XSS | React (échappement), CSP stricte hors `'unsafe-inline'` scripts, pas d'HTML injecté | revue | Moyen-faible (voir architecture) |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | — | Faible |
| Données patient dans les journaux techniques | Messages d'erreur génériques, pas de console.log de données, chemins de stockage sans nom | revue | À surveiller |
| Perte de données (serveur) | Sauvegarde chiffrée AES-256-GCM, restauration testée, empreintes vérifiées | `test-restore.mts` | Dépend de l'exécution régulière et du stockage hors site |
| Hébergeur | Chiffrement au repos (Supabase), région à choisir | — | **À valider juridiquement** (voir checklist) |
