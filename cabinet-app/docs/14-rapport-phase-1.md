# Rapport de phase 1 — V1 (28/09/2026)

## Ce qui a réellement été réalisé
- Application PWA complète dans `cabinet-app/` : connexion (mot de passe, double authentification TOTP, verrouillage après inactivité), recherche/création de patients (homonymes signalés, jamais fusionnés), capture multi-pages avec vérification/rotation/recadrage/reprise/suppression/réordonnancement, file locale hors connexion, synchronisation confirmée par le serveur, tableau de bord Windows, dossier patient, lecteur (zoom, rotation, navigation), déplacement d'une fiche avec motif et trace, journal, gestion des comptes (révocation « téléphone perdu »).
- Base Supabase : 6 tables, RLS sur toutes, écritures uniquement via fonctions auditées, bucket privé.
- Sauvegarde chiffrée + restauration vérifiée.
- Documentation (`docs/01` à `15`, checklist juridique, exploitation).

## Ce qui a été testé et résultats
Voir `12-plan-de-tests.md` (résultats de la dernière exécution complète sur le code final dans le message de livraison et la PR).

Tout a été exécuté **dans l'environnement de développement** (pile Supabase locale sous Docker, Chromium headless avec profils « Pixel 7 » et « bureau »). **Rien n'a été testé sur un vrai téléphone ni sur un vrai PC Windows.**

## Seconde revue indépendante (rôle AGY CLI)
11 points relevés (2 élevés, 4 moyens, 5 faibles). Tous corrigés et couverts par des tests :
1. Dates décalées d'un jour dans la sauvegarde selon le fuseau (élevé) → dates conservées en texte ; test de restauration comparant les lignes complètes sous le fuseau de Casablanca.
2. Fiche bloquée si le serveur l'a perdue (restauration) (élevé) → l'appareil la recrée automatiquement ; patient hors connexion gardé jusqu'à confirmation.
3. Image aux dimensions démesurées (saturation mémoire) → contrôle avant décodage.
4. Métadonnées cachées (images secondaires, données après la fin d'image, segments entre scans) → analyse JPEG complète.
5. Téléphone partagé : fiches envoyées sous un autre compte → fiches liées à leur compte.
6. Images dans le cache disque du PC → téléchargement `no-store`, affichage en mémoire.
7. Un tiers pouvait ajouter une page à la fiche d'un autre → auteur uniquement.
8–9. Faux conflits sur requêtes simultanées → verrou par identifiant ; écriture de stockage rendue robuste (cas reproduit par un test de charge puis corrigé).
10. « Abandonner la fiche » sans confirmation → confirmation ajoutée.
11. Reprise après plantage sans verrou → verrou ajouté.

## Ce qui reste à faire
- Essai réel Android + Windows (Chrome et Edge) : nécessite un déploiement HTTPS.
- Projet Supabase de production, hébergement, sauvegardes planifiées, CI.
- Validation juridique (checklist).
- Dépôt privé séparé (voir D1).

## Risques et décisions en attente (Reda)
1. **Autorisation de créer les comptes** Supabase (gratuit au départ) et d'hébergement (ex. Vercel, gratuit au départ) pour l'essai réel — ou choix d'un hébergeur au Maroc.
2. **Région d'hébergement** : à décider avec l'avis juridique (données de santé, transfert hors du Maroc).
3. **Dépôt** : l'application est dans le dépôt du site vitrine. Ne pas fusionner dans `main` tel quel (GitHub Pages publierait le code et la documentation). Recommandation : dépôt privé dédié.
4. Codex, Muse Code et AGY CLI n'étaient pas installés dans cet environnement ; faut-il les installer/connecter pour la suite (compte, coût) ?

## Ce que Reda peut vérifier dès maintenant
1. Ouvrir la PR GitHub indiquée dans le message de livraison, onglet **Files changed** : dossier `cabinet-app/`.
2. Lire `cabinet-app/docs/02-perimetre-v1.md` et `11-criteres-acceptation.md` : vérifier que le périmètre correspond au besoin de Hicham.
3. Lire `checklist-juridique.md` et la transmettre au conseil juridique.
4. Répondre aux 4 décisions ci-dessus.

Ensuite, pour l'essai réel (après autorisation), une séquence pas à pas sera fournie : installation sur le téléphone, 20 fiches **fictives**, mode avion, redémarrage, vérification sur le PC.
