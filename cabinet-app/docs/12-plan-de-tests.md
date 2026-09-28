# Plan de tests et résultats

Données : **uniquement fictives** (`scripts/seed-dev.ts`, images générées « FICHE FICTIVE »).

## Commandes
```bash
npm run lint && npm run typecheck && npm run build
npm test                 # unitaires (28)
npm run test:tz          # unitaires sous UTC+14 et UTC-7
npm run test:integration # pile Supabase locale + serveur Next (31) — remet la base à zéro
npm run test:e2e         # Playwright, profils Pixel 7 et bureau (8)
npm run test:restore     # sauvegarde → sinistre → restauration → vérification
```

## Couverture des situations demandées
| Situation | Test | Résultat (28/09/2026) |
|-----------|------|-----------------------|
| Fiche d'une page | unit `sync`, intégration | ✅ |
| Fiche de plusieurs pages | unit, e2e mobile | ✅ |
| Photo floue reprise avant envoi | e2e (suppression + nouvelle page) ; bouton « Reprendre » non automatisé | 🟡 |
| Absence totale d'Internet | e2e hors connexion, unit | ✅ |
| Retour du réseau | e2e (envoi automatique au retour) | ✅ |
| Coupure pendant l'envoi | e2e (réponse perdue après réception), unit | ✅ |
| Fermeture forcée de l'application | e2e (rechargement hors ligne), unit (`uploading` repris) | ✅ |
| Redémarrage du téléphone | équivalent IndexedDB persistant ; **à confirmer sur appareil** | ⏳ |
| Tentative d'envoi répétée / doublons | unit, intégration, e2e | ✅ |
| 50 à 100 photos dans la journée | unit (100 pages/25 fiches avec coupure), intégration (50 pages via l'API) | ✅ |
| Deux patients aux noms proches | intégration (recherche), e2e (2 résultats), avertissement à la création | ✅ |
| Fiche associée au mauvais patient + correction | intégration + e2e | ✅ |
| Utilisateur sans autorisation | intégration (anonyme, assistant, autre cabinet), e2e | ✅ |
| Révocation d'un téléphone perdu | intégration (jeton encore valide refusé immédiatement) | ✅ |
| Image corrompue | intégration (tronquée, octets aléatoires), e2e (refus local) | ✅ |
| Fichier trop volumineux | intégration (413) | ✅ |
| Changement d'heure / fuseau | unit sous 3 fuseaux, intégration (fuseau du cabinet, date du 29/03) | ✅ |
| Restauration complète | `test:restore` | ✅ |
| Chrome et Edge sur Windows | Chromium bureau automatisé ; **Edge et vrai Windows non testés** | ⏳ |
| Vrai téléphone Android | **non testé** (nécessite déploiement HTTPS) | ⏳ |

## Contrôle de la qualité des tests
Test de mutation : suppression volontaire de la vérification de session dans `private.current_member()` → les tests de révocation et de double authentification échouent comme attendu, puis schéma restauré.

## Essai réel à réaliser (Reda)
Voir `14-rapport-phase-1.md`, section « Ce que Reda doit vérifier ».
