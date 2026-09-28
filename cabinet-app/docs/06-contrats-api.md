# Contrats API

Authentification : en-tête `Authorization: Bearer <jeton Supabase>` pour les routes Next ; session Supabase pour les RPC.

## Routes serveur (Next.js)
### `PUT /api/pages?documentId=&pageId=&pageNumber=`
- En-têtes : `x-content-sha256` (hex de l'image envoyée), `Content-Type: image/jpeg`. Corps : octets JPEG (≤ 8 Mo).
- Réponses :
  - `201 {pageId, receivedSha256, storedSha256, duplicate:false}` — page vérifiée et enregistrée.
  - `200 {…, duplicate:true}` — même page déjà reçue (renvoi sans effet).
  - `400` paramètres invalides · `401` non authentifié/session révoquée · `403` compte inactif · `404` document invisible pour l'utilisateur · `409` même `pageId` avec un autre contenu · `413` trop volumineux · `415` pas un JPEG · `422` empreinte différente, image corrompue, dimensions ou n° de page invalides · `503` stockage indisponible (réessayer).
- Le client compare `receivedSha256` à sa propre empreinte.

### `GET /api/documents/:id/images[?thumbs=1]`
- `200 {expiresIn:300, pages:[{id, pageNumber, width, height, size, sha256, receivedAt, thumbUrl, url}]}` — liens signés 5 min. Consultation (hors miniatures) journalisée `document.view`.
- `404` si le document n'est pas dans le cabinet de l'utilisateur.

## Fonctions SQL (RPC `supabase.rpc`)
| Fonction | Rôles | Idempotente | Effet |
|----------|-------|-------------|-------|
| `create_patient(p_id, p_last_name, p_first_name, p_phone?, p_birth_date?, p_device?)` | tous | oui (p_id) | crée, attribue `P-xxxxx`, journalise |
| `update_patient(p_id, …)` | tous | — | corrige l'identité, journalise ancien/nouveau |
| `search_patients(p_query, p_limit)` | tous | — | recherche (RLS appliquée) |
| `create_document(p_id, p_patient_id, p_document_date, p_note, p_page_count, p_device?)` | tous | oui (p_id) | crée la fiche `receiving` |
| `finalize_document(p_id)` | tous | oui | `synced` **seulement si** les pages 1..N sont toutes reçues ; sinon erreur `incomplet` |
| `move_document(p_id, p_new_patient_id, p_reason)` | dentiste, admin | oui | déplace, version+1, trace dans les 2 dossiers |
| `archive_document(p_id, p_reason)` | dentiste, admin | — | archive (jamais d'effacement) |
| `dashboard_summary()` | tous | — | fiches du jour (fuseau du cabinet), patients récents, envois incomplets |
| `list_members()` | dentiste, admin | — | comptes + dernière connexion + sessions |
| `admin_revoke_sessions(p_user_id)` | dentiste, admin | — | supprime toutes les sessions (effet immédiat) |
| `admin_set_member_status(p_user_id, p_status)` | admin | — | active/désactive (désactivation = révocation) |
| `touch_member(p_device?)` | tous | — | dernière connexion + journal |
| `server_register_page(…)`, `server_log_access(…)` | **service_role uniquement** | oui | appelées par les routes serveur |

Codes d'erreur : `42501` accès refusé/rôle insuffisant · `P0002` introuvable · `22023` donnée invalide (motif, date) · `23505` conflit · `P0001` `incomplet`.
