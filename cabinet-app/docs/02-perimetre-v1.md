# Périmètre V1

| # | Fonction | État (28/09/2026) |
|---|----------|-------------------|
| 1 | Connexion sécurisée (mot de passe 12+ car., double authentification TOTP optionnelle, verrouillage après inactivité) | Fait, testé en local |
| 2 | Créer un patient (nom, prénom ; téléphone et date de naissance facultatifs) | Fait, testé |
| 3 | Rechercher (nom, prénom, téléphone, n° de dossier ; sans accents) | Fait, testé |
| 4 | Sélection du patient avant la photo | Fait, testé |
| 5 | Une ou plusieurs photos | Fait, testé (navigateur simulé) |
| 6-7 | Vérifier, reprendre, tourner, recadrer, supprimer, réordonner | Fait ; recadrage non couvert par un test automatique |
| 8 | Date de la fiche + note facultative | Fait, testé |
| 9 | Synchronisation avec confirmation d'intégrité | Fait, testé |
| 10 | Consultation immédiate sur Windows | Fait, testé en Chromium bureau ; **Edge réel non testé** |
| 11 | Lecteur : ordre, zoom, rotation, navigation | Fait, testé |
| 12-13 | Échecs visibles, « Réessayer » | Fait, testé |
| 14 | Déplacer une fiche vers le bon patient, tracé | Fait, testé |
| 15 | Journal minimal | Fait, testé |
| 16 | Sauvegarde chiffrée + restauration vérifiée | Fait, restauration testée en local |

**Non fait / à valider** : essai sur un vrai téléphone Android et un vrai PC Windows (nécessite un déploiement HTTPS, donc votre autorisation), hébergement de production, validation juridique.
