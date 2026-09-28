# Critères d'acceptation V1 — état au 28/09/2026

Légende : ✅ vérifié (automatiquement, pile locale) · 🟡 partiel · ⏳ non vérifié (nécessite l'essai réel)

| Critère | État | Preuve |
|---------|------|--------|
| Créer ou sélectionner un patient sur le téléphone | ✅ 🟡 | e2e profil Pixel 7 (navigateur simulé, pas un vrai téléphone) |
| Photographier plusieurs pages | ✅ 🟡 | e2e (fichiers injectés dans le champ photo) |
| Vérifier et corriger les images | ✅ | e2e (rotation, suppression) ; recadrage testé manuellement : **non** |
| Panne réseau sans perte silencieuse | ✅ | e2e hors connexion + rechargement ; unitaires |
| Envois interrompus repris | ✅ | e2e coupure ; unitaires |
| Envoi répété sans doublon | ✅ | e2e, intégration, unitaires |
| « Synchronisée » seulement après confirmation serveur | ✅ | unitaires (serveur qui ne confirme pas) ; intégration (`incomplet`) |
| Pages dans le bon dossier sur Windows | ✅ 🟡 | e2e profil bureau Chromium ; **Edge non testé** |
| Écriture lisible | 🟡 | 2400 px / JPEG 0,85 ; à confirmer sur de vraies fiches manuscrites (fictives) |
| Erreur d'association corrigible et journalisée | ✅ | intégration + e2e |
| Images non accessibles publiquement | ✅ | intégration (bucket privé, URL publique refusée) |
| Autre utilisateur/cabinet sans accès | ✅ | intégration + e2e ; test de mutation |
| Sauvegardes existent | 🟡 | script prêt ; **aucune sauvegarde de production** (pas de production) |
| Restauration testée | ✅ | `npm run test:restore` (local) |
| Parcours réel Android et Windows | ⏳ | nécessite un déploiement HTTPS |
| Tests, types, compilation OK | ✅ | voir plan de tests |
| Aucun secret exposé | ✅ | `.env*` ignorés ; seules les clés de démonstration locales publiques de Supabase apparaissent dans la doc de dev |
| Aucun défaut critique de sécurité connu ouvert | ✅ (en local) | 2ᵉ revue : 11 points corrigés et testés ; à refaire avant la production |

**Conclusion : la V1 n'est pas encore « terminée » au sens du brief** tant que l'essai réel Android/Windows n'a pas eu lieu.
