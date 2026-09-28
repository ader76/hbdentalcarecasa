# Modèle de données

Toutes les tables portent `cabinet_id` ; les clés étrangères composites `(cabinet_id, id)` empêchent de rattacher un document au patient d'un autre cabinet.

| Table | Rôle | Champs principaux |
|-------|------|-------------------|
| `cabinets` | Cabinet | id, name, contact (jsonb), settings (jsonb : `timezone`, `idle_lock_minutes`), next_file_number, created_at |
| `members` | Utilisateur | user_id (= auth.users), cabinet_id, full_name, role (`dentiste`/`assistant`/`admin`), status (`active`/`disabled`), last_login_at |
| `patients` | Patient | id (généré sur l'appareil), cabinet_id, file_number (`P-00001`), last_name, first_name, phone?, birth_date?, status (`active`/`archived`), created_at/by, updated_at |
| `documents` | Fiche photographiée | id (généré sur l'appareil = clé d'idempotence), patient_id, document_date, note?, page_count, sync_status (`receiving`/`synced`), version, status, device_label, created_at/by, synced_at |
| `pages` | Page / image | id (appareil), document_id, page_number, storage_path, thumb_path, size_bytes, mime_type (`image/jpeg`), width, height, sha256, received_at, validation_status, uploaded_by |
| `audit_log` | Journal (ajout seul) | user_id, action, entity_type/id, patient_id, old_value, new_value, session_id, device, result, created_at |

Règles :
- Chemins de stockage `cabinet/document/page.jpg` : aucune donnée patient dans les noms ; déplacer une fiche ne déplace aucun fichier.
- Unicité `(document_id, page_number)` et identifiants fournis par l'appareil : un renvoi ne crée jamais de doublon.
- `audit_log` refuse `UPDATE`/`DELETE` (déclencheur), y compris pour la clé serveur.
- Jamais de suppression physique en V1 : archivage avec motif.

## Évolutions prévues
Tables futures rattachées à `patients` (et `cabinet_id`) : `consultations`, `antecedents`, `allergies`, `pathologies`, `traitements`, `conseils`, `ordonnances` (+ `ordonnance_versions`), `ocr_extractions` (texte proposé, moteur/version, validation humaine). L'image (`pages`) reste la source de vérité ; aucune de ces tables ne la remplace.
