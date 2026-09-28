# Plan de synchronisation et stratégie offline-first

## Principe
La photo est écrite dans **IndexedDB** dès sa prise (avant tout réseau). Le serveur est la seule autorité pour « Synchronisée ». La copie locale n'est effacée qu'après confirmation, dans la même transaction que le passage à `synced`.

## États locaux d'une fiche
`draft` (en capture) → `pending` (enregistrée) → `uploading` → `synced` | `failed`
- `failed` : réessai automatique avec délai croissant (30 s, 1 min, 2 min… max 15 min) + bouton « Réessayer » immédiat.
- Session expirée : la fiche reste `pending` (message « reconnectez-vous »), ce n'est pas un échec.
- Au démarrage, une fiche restée `uploading` (fermeture forcée, redémarrage) repasse en `pending`.

## Déclencheurs (pas de dépendance à la synchronisation en arrière-plan)
Ouverture de l'application · retour du réseau (`online`) · retour au premier plan · toutes les 30 s tant que l'application est ouverte · « Réessayer ». Un verrou (`navigator.locks`) empêche deux envois simultanés (plusieurs onglets).

## Étapes d'un envoi (toutes idempotentes)
1. Patient créé hors connexion → `create_patient(id)`.
2. `create_document(id, page_count)`.
3. Pour chaque page non encore confirmée : `PUT /api/pages` ; le serveur renvoie l'empreinte des octets reçus, comparée à celle du téléphone ; la page est mémorisée comme reçue.
4. `finalize_document(id)` : le serveur vérifie que les pages 1..N existent et sont validées → `synced`.
5. Le téléphone passe la fiche en `synced` et supprime ses photos.

Si la réponse d'une étape est perdue, l'étape est simplement rejouée : mêmes identifiants → aucun doublon (testé). Si le serveur déclare la fiche incomplète, toutes les pages sont renvoyées au prochain essai (sans doublon).

## Ce qui est conservé sur le téléphone
- Photos en attente (jusqu'à confirmation), brouillons.
- Liste des patients (nom, prénom, téléphone, date de naissance, n° de dossier) pour la recherche hors connexion ; effacée à la déconnexion.
- `navigator.storage.persist()` est demandé pour éviter la purge automatique par le navigateur.
- Historique des fiches synchronisées (sans image) : 3 jours.

## Limites connues
- Un téléphone jamais rouvert ne peut pas envoyer ses fiches : le tableau de bord Windows signale les fiches commencées mais incomplètes (> 30 min) ; les fiches jamais commencées ne sont visibles que sur le téléphone.
- « Vider les données du site » dans Chrome effacerait les fiches non envoyées : consigne à donner à l'utilisateur.
