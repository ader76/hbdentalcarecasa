# Procédure de sauvegarde et de restauration

## Deux niveaux
1. **Sauvegardes de l'hébergeur** (Supabase : quotidiennes sur les offres payantes ; à vérifier selon l'offre choisie — *aucun service payant activé sans votre accord*).
2. **Sauvegarde applicative chiffrée** (ce dépôt) : base (comptes, patients, fiches, pages, journal) + toutes les images, chiffrées AES-256-GCM avec une phrase secrète. Indépendante de l'hébergeur, à conserver hors site.

## Sauvegarder
Sur l'ordinateur d'administration (Node 22 installé, fichier `.env.local` de **production** avec `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `BACKUP_PASSPHRASE`) :
```bash
npm run backup -- "D:/Sauvegardes/fiches"
```
- Les images déjà sauvegardées ne sont pas recopiées (stockage par empreinte) : sauvegarde incrémentale.
- Fréquence recommandée : chaque semaine + avant chaque mise à jour. Deux supports (disque externe chiffré + second support hors du cabinet).
- La phrase secrète (32 caractères min.) est conservée **séparément** (coffre-fort de mots de passe + copie papier sous clé). Sans elle, la sauvegarde est inutilisable.

## Restaurer
Uniquement dans un projet **vide** dont le schéma est migré (`supabase db push`) :
```bash
npm run restore -- "D:/Sauvegardes/fiches" --confirm <hôte-du-projet-cible>
```
Le script : vérifie l'intégrité de chaque fichier **avant** d'écrire, refuse une base non vide, restaure en une transaction, renvoie les images, puis relit chaque page et compare son empreinte. Les utilisateurs se reconnectent avec leurs mots de passe habituels (les sessions ne sont pas restaurées).

## Test de restauration
- Automatique en local : `npm run test:restore` (réussi le 28/09/2026 : 4 comptes, 4 patients, 3 fiches, 6 pages, 14 entrées de journal identiques après restauration ; sauvegarde altérée et mauvaise phrase refusées).
- **À faire en production** : tous les 3 mois, restaurer la dernière sauvegarde dans un projet Supabase de test, ouvrir 3 dossiers au hasard, noter la date et le résultat ici.

| Date | Sauvegarde utilisée | Résultat | Par |
|------|---------------------|----------|-----|
| 28/09/2026 | test local fictif | ✅ | Claude Code |
