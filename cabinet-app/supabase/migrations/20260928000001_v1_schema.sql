-- =============================================================================
-- Cabinet dentaire — V1 : numérisation des fiches papier
-- Schéma, sécurité (RLS), fonctions auditées, stockage privé.
--
-- Principes :
--   * chaque ligne appartient à un cabinet ; aucune lecture hors de son cabinet ;
--   * les clients (navigateur) n'ont AUCUN droit d'écriture direct sur les tables :
--     toutes les écritures passent par des fonctions qui vérifient le rôle et
--     écrivent le journal d'audit dans la même transaction ;
--   * les pages (images) ne sont enregistrées que par le serveur (service_role)
--     après vérification de l'intégrité du fichier ;
--   * un compte désactivé ou une session révoquée perd l'accès immédiatement
--     (vérifié à chaque requête, pas seulement à l'expiration du jeton).
-- =============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.member_role as enum ('dentiste', 'assistant', 'admin');
create type public.account_status as enum ('active', 'disabled');
create type public.record_status as enum ('active', 'archived');
-- receiving : le document existe, toutes ses pages ne sont pas encore reçues
-- synced    : toutes les pages ont été reçues ET vérifiées par le serveur
create type public.sync_status as enum ('receiving', 'synced');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.cabinets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  contact jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{"timezone": "Africa/Casablanca", "idle_lock_minutes": 10}'::jsonb,
  next_file_number integer not null default 1,
  created_at timestamptz not null default now()
);

-- « Utilisateur » : profil applicatif d'un compte d'authentification.
create table public.members (
  user_id uuid primary key references auth.users (id) on delete restrict,
  cabinet_id uuid not null references public.cabinets (id),
  full_name text not null check (char_length(full_name) between 1 and 200),
  role public.member_role not null,
  status public.account_status not null default 'active',
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create index members_cabinet_idx on public.members (cabinet_id);

create table public.patients (
  id uuid primary key,
  cabinet_id uuid not null references public.cabinets (id),
  file_number text not null,
  last_name text not null check (char_length(btrim(last_name)) between 1 and 100),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  phone text check (phone is null or phone ~ '^[0-9+() .-]{6,25}$'),
  birth_date date check (birth_date is null or birth_date >= date '1900-01-01'),
  status public.record_status not null default 'active',
  search_text text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (cabinet_id, file_number),
  unique (cabinet_id, id)
);
create index patients_cabinet_updated_idx on public.patients (cabinet_id, updated_at desc);
create index patients_search_trgm_idx on public.patients using gin (search_text extensions.gin_trgm_ops);

create table public.documents (
  id uuid primary key,                         -- généré par l'appareil : clé d'idempotence
  cabinet_id uuid not null references public.cabinets (id),
  patient_id uuid not null,
  document_date date not null,
  note text check (note is null or char_length(note) <= 500),
  page_count integer not null check (page_count between 1 and 50),
  sync_status public.sync_status not null default 'receiving',
  version integer not null default 1,
  status public.record_status not null default 'active',
  device_label text check (device_label is null or char_length(device_label) <= 100),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  synced_at timestamptz,
  -- le patient appartient forcément au même cabinet que le document
  foreign key (cabinet_id, patient_id) references public.patients (cabinet_id, id),
  unique (cabinet_id, id)
);
create index documents_patient_idx on public.documents (patient_id, document_date desc);
create index documents_cabinet_created_idx on public.documents (cabinet_id, created_at desc);

create table public.pages (
  id uuid primary key,                         -- généré par l'appareil : clé d'idempotence
  cabinet_id uuid not null,
  document_id uuid not null,
  page_number integer not null check (page_number between 1 and 50),
  storage_path text not null,
  thumb_path text not null,
  size_bytes integer not null check (size_bytes > 0),
  mime_type text not null check (mime_type = 'image/jpeg'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  validation_status text not null default 'validated' check (validation_status in ('validated')),
  uploaded_by uuid not null references auth.users (id),
  foreign key (cabinet_id, document_id) references public.documents (cabinet_id, id),
  unique (document_id, page_number)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  cabinet_id uuid references public.cabinets (id),
  user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  patient_id uuid,
  old_value jsonb,
  new_value jsonb,
  session_id uuid,
  device text,
  result text not null default 'success' check (result in ('success', 'denied', 'error')),
  created_at timestamptz not null default now()
);
create index audit_cabinet_created_idx on public.audit_log (cabinet_id, created_at desc);
create index audit_entity_idx on public.audit_log (entity_id);
create index audit_patient_idx on public.audit_log (patient_id);

-- Le journal est en ajout seul, y compris pour le propriétaire des tables.
create function private.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log est en ajout seul' using errcode = '42501';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Fonctions utilitaires (schéma privé, non exposé par l'API)
-- -----------------------------------------------------------------------------
create function private.normalize(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

create function private.patients_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := private.normalize(new.last_name || ' ' || new.first_name || ' ' || new.first_name)
    || ' ' || coalesce(regexp_replace(new.phone, '[^0-9]', '', 'g'), '')
    || ' ' || lower(new.file_number);
  return new;
end $$;
create trigger patients_search_text before insert or update on public.patients
  for each row execute function private.patients_search_text();

-- Membre courant : compte actif, session non révoquée, MFA respectée.
-- Renvoie NULL si l'une de ces conditions échoue → aucune ligne visible.
create function private.current_member() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.members;
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into m from public.members where user_id = auth.uid() and status = 'active';
  if not found then
    return null;
  end if;
  -- session révoquée (téléphone perdu, déconnexion globale) → accès refusé immédiatement
  if sid is null or not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = auth.uid()) then
    return null;
  end if;
  -- si l'utilisateur a activé la double authentification, elle est exigée
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     and exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') then
    return null;
  end if;
  return m;
end $$;

create function private.my_cabinet() returns uuid
language sql stable security definer set search_path = '' as $$
  select (private.current_member()).cabinet_id
$$;

create function private.my_role() returns public.member_role
language sql stable security definer set search_path = '' as $$
  select (private.current_member()).role
$$;

-- Les fonctions sont exécutables par PUBLIC par défaut : on retire ce droit et on
-- n'autorise que les fonctions utilisées par les politiques RLS et la recherche.
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.my_cabinet(), private.my_role(), private.current_member(), private.normalize(text) to authenticated;

-- Exige un membre actif (éventuellement avec un rôle donné), sinon erreur.
create function private.require_member(allowed public.member_role[] default null)
returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.members := private.current_member();
begin
  if m.user_id is null then
    raise exception 'accès refusé' using errcode = '42501';
  end if;
  if allowed is not null and not (m.role = any (allowed)) then
    raise exception 'rôle insuffisant' using errcode = '42501';
  end if;
  return m;
end $$;

create function private.write_audit(
  p_cabinet uuid, p_user uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_patient uuid, p_old jsonb, p_new jsonb, p_device text default null, p_result text default 'success'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (cabinet_id, user_id, action, entity_type, entity_id, patient_id,
                                old_value, new_value, session_id, device, result)
  values (p_cabinet, p_user, p_action, p_entity_type, p_entity_id, p_patient, p_old, p_new,
          nullif(auth.jwt() ->> 'session_id', '')::uuid, left(p_device, 200), p_result)
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security : lecture limitée au cabinet ; aucune écriture directe.
-- -----------------------------------------------------------------------------
alter table public.cabinets enable row level security;
alter table public.members enable row level security;
alter table public.patients enable row level security;
alter table public.documents enable row level security;
alter table public.pages enable row level security;
alter table public.audit_log enable row level security;

create policy cabinets_select on public.cabinets for select to authenticated
  using (id = private.my_cabinet());
create policy members_select on public.members for select to authenticated
  using (cabinet_id = private.my_cabinet());
create policy patients_select on public.patients for select to authenticated
  using (cabinet_id = private.my_cabinet());
create policy documents_select on public.documents for select to authenticated
  using (cabinet_id = private.my_cabinet()
         and (status = 'active' or private.my_role() in ('dentiste', 'admin')));
create policy pages_select on public.pages for select to authenticated
  using (cabinet_id = private.my_cabinet()
         and exists (select 1 from public.documents d where d.id = document_id));
create policy audit_select on public.audit_log for select to authenticated
  using (cabinet_id = private.my_cabinet() and private.my_role() in ('dentiste', 'admin'));

revoke all on public.cabinets, public.members, public.patients, public.documents,
              public.pages, public.audit_log from anon, authenticated;
grant select on public.cabinets, public.members, public.patients, public.documents,
                public.pages, public.audit_log to authenticated;
grant select, insert, update, delete on public.cabinets, public.members, public.patients,
                public.documents, public.pages to service_role;
grant select, insert on public.audit_log to service_role;
grant usage on sequence public.audit_log_id_seq to service_role;

-- -----------------------------------------------------------------------------
-- Fonctions appelables par l'application (RPC)
-- -----------------------------------------------------------------------------

-- Connexion : met à jour « dernière connexion » et journalise.
create function public.touch_member(p_device text default null) returns public.members
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member();
begin
  update public.members set last_login_at = now() where user_id = m.user_id returning * into m;
  perform private.write_audit(m.cabinet_id, m.user_id, 'session.open', 'member', m.user_id, null, null, null, p_device);
  return m;
end $$;

-- Création d'un patient. Idempotente : l'appareil fournit l'identifiant, un second
-- appel avec le même identifiant renvoie le patient existant sans le modifier.
create function public.create_patient(
  p_id uuid, p_last_name text, p_first_name text,
  p_phone text default null, p_birth_date date default null, p_device text default null
) returns public.patients
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member();
  p public.patients;
  n integer;
begin
  -- deux appels simultanés avec le même identifiant (réessai réseau) sont traités l'un après l'autre
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into p from public.patients where id = p_id;
  if found then
    if p.cabinet_id <> m.cabinet_id then
      raise exception 'accès refusé' using errcode = '42501';
    end if;
    return p;
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'date de naissance dans le futur' using errcode = '22023';
  end if;
  update public.cabinets set next_file_number = next_file_number + 1
    where id = m.cabinet_id returning next_file_number - 1 into n;
  insert into public.patients (id, cabinet_id, file_number, last_name, first_name, phone, birth_date, created_by)
  values (p_id, m.cabinet_id, 'P-' || lpad(n::text, 5, '0'), btrim(upper(p_last_name)), btrim(p_first_name),
          nullif(btrim(p_phone), ''), p_birth_date, m.user_id)
  returning * into p;
  perform private.write_audit(m.cabinet_id, m.user_id, 'patient.create', 'patient', p.id, p.id, null,
    jsonb_build_object('file_number', p.file_number), p_device);
  return p;
end $$;

-- Correction de l'identité d'un patient (faute de frappe…), journalisée.
create function public.update_patient(
  p_id uuid, p_last_name text, p_first_name text, p_phone text, p_birth_date date
) returns public.patients
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member();
  old public.patients;
  p public.patients;
begin
  select * into old from public.patients where id = p_id and cabinet_id = m.cabinet_id for update;
  if not found then
    raise exception 'patient introuvable' using errcode = 'P0002';
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'date de naissance dans le futur' using errcode = '22023';
  end if;
  update public.patients set last_name = btrim(upper(p_last_name)), first_name = btrim(p_first_name),
    phone = nullif(btrim(p_phone), ''), birth_date = p_birth_date, updated_at = now()
  where id = p_id returning * into p;
  perform private.write_audit(m.cabinet_id, m.user_id, 'patient.update', 'patient', p.id, p.id,
    jsonb_build_object('last_name', old.last_name, 'first_name', old.first_name, 'phone', old.phone, 'birth_date', old.birth_date),
    jsonb_build_object('last_name', p.last_name, 'first_name', p.first_name, 'phone', p.phone, 'birth_date', p.birth_date));
  return p;
end $$;

-- Recherche par nom, prénom, téléphone ou numéro de dossier (insensible aux accents).
create function public.search_patients(p_query text, p_limit integer default 20)
returns setof public.patients
language sql stable security invoker set search_path = '' as $$
  with tokens as (
    select t from regexp_split_to_table(private.normalize(btrim(coalesce(p_query, ''))), '\s+') t where t <> ''
  )
  select p.* from public.patients p
  where p.status = 'active'
    and not exists (
      select 1 from tokens
      where p.search_text not like '%' || tokens.t || '%'
        and (regexp_replace(tokens.t, '[^0-9]', '', 'g') = ''
             or p.search_text not like '%' || regexp_replace(tokens.t, '[^0-9]', '', 'g') || '%')
    )
  order by p.updated_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- Création d'un document (fiche photographiée). Idempotente sur p_id.
create function public.create_document(
  p_id uuid, p_patient_id uuid, p_document_date date, p_note text, p_page_count integer,
  p_device text default null
) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member();
  d public.documents;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into d from public.documents where id = p_id;
  if found then
    if d.cabinet_id <> m.cabinet_id then
      raise exception 'accès refusé' using errcode = '42501';
    end if;
    if d.page_count <> p_page_count then
      raise exception 'conflit : ce document existe avec un autre nombre de pages' using errcode = '23505';
    end if;
    return d;   -- renvoi répété : aucun doublon
  end if;
  if not exists (select 1 from public.patients where id = p_patient_id and cabinet_id = m.cabinet_id and status = 'active') then
    raise exception 'patient introuvable' using errcode = 'P0002';
  end if;
  insert into public.documents (id, cabinet_id, patient_id, document_date, note, page_count, created_by, device_label)
  values (p_id, m.cabinet_id, p_patient_id, p_document_date, nullif(btrim(p_note), ''), p_page_count, m.user_id, left(p_device, 100))
  returning * into d;
  update public.patients set updated_at = now() where id = p_patient_id;
  perform private.write_audit(m.cabinet_id, m.user_id, 'document.create', 'document', d.id, p_patient_id, null,
    jsonb_build_object('page_count', p_page_count, 'document_date', p_document_date), p_device);
  return d;
end $$;

-- Enregistrement d'une page : réservé au serveur, APRÈS vérification du fichier.
create function public.server_register_page(
  p_actor uuid, p_id uuid, p_document_id uuid, p_page_number integer, p_storage_path text,
  p_thumb_path text, p_size integer, p_width integer, p_height integer, p_sha256 text
) returns public.pages
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  pg public.pages;
begin
  select * into d from public.documents where id = p_document_id for update;
  if not found then
    raise exception 'document introuvable' using errcode = 'P0002';
  end if;
  -- seules les pages de l'auteur de la fiche sont acceptées (évite qu'un tiers occupe un numéro de page)
  if d.created_by <> p_actor then
    raise exception 'accès refusé' using errcode = '42501';
  end if;
  if p_page_number > d.page_count then
    raise exception 'numéro de page hors limites' using errcode = '22023';
  end if;
  select * into pg from public.pages where id = p_id;
  if found then
    if pg.sha256 = p_sha256 and pg.document_id = p_document_id and pg.page_number = p_page_number then
      return pg;  -- renvoi répété : aucun doublon
    end if;
    raise exception 'conflit : page déjà reçue avec un contenu différent' using errcode = '23505';
  end if;
  insert into public.pages (id, cabinet_id, document_id, page_number, storage_path, thumb_path,
                            size_bytes, mime_type, width, height, sha256, uploaded_by)
  values (p_id, d.cabinet_id, p_document_id, p_page_number, p_storage_path, p_thumb_path,
          p_size, 'image/jpeg', p_width, p_height, p_sha256, p_actor)
  returning * into pg;
  perform private.write_audit(d.cabinet_id, p_actor, 'page.receive', 'page', pg.id, d.patient_id, null,
    jsonb_build_object('document_id', p_document_id, 'page_number', p_page_number, 'sha256', p_sha256, 'size', p_size));
  return pg;
end $$;

-- Finalisation : « synchronisée » UNIQUEMENT si toutes les pages 1..N sont reçues et vérifiées.
create function public.finalize_document(p_id uuid) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member();
  d public.documents;
  received integer;
begin
  select * into d from public.documents where id = p_id and cabinet_id = m.cabinet_id for update;
  if not found then
    raise exception 'document introuvable' using errcode = 'P0002';
  end if;
  if d.sync_status = 'synced' then
    return d;
  end if;
  select count(*) into received from public.pages
    where document_id = p_id and validation_status = 'validated' and page_number between 1 and d.page_count;
  if received <> d.page_count then
    raise exception 'incomplet : % page(s) reçue(s) sur %', received, d.page_count using errcode = 'P0001';
  end if;
  update public.documents set sync_status = 'synced', synced_at = now(), updated_at = now()
    where id = p_id returning * into d;
  perform private.write_audit(m.cabinet_id, m.user_id, 'document.synced', 'document', d.id, d.patient_id, null,
    jsonb_build_object('page_count', d.page_count));
  return d;
end $$;

-- Correction : déplacer un document vers le bon patient (trace conservée).
create function public.move_document(p_id uuid, p_new_patient_id uuid, p_reason text) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member(array['dentiste', 'admin']::public.member_role[]);
  d public.documents;
  old_patient uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'motif obligatoire' using errcode = '22023';
  end if;
  select * into d from public.documents where id = p_id and cabinet_id = m.cabinet_id for update;
  if not found then
    raise exception 'document introuvable' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.patients where id = p_new_patient_id and cabinet_id = m.cabinet_id and status = 'active') then
    raise exception 'patient introuvable' using errcode = 'P0002';
  end if;
  if d.patient_id = p_new_patient_id then
    return d;
  end if;
  old_patient := d.patient_id;
  update public.documents set patient_id = p_new_patient_id, version = version + 1, updated_at = now()
    where id = p_id returning * into d;
  update public.patients set updated_at = now() where id in (old_patient, p_new_patient_id);
  perform private.write_audit(m.cabinet_id, m.user_id, 'document.move', 'document', d.id, p_new_patient_id,
    jsonb_build_object('patient_id', old_patient),
    jsonb_build_object('patient_id', p_new_patient_id, 'reason', btrim(p_reason), 'version', d.version));
  -- trace également visible dans l'historique de l'ancien patient
  perform private.write_audit(m.cabinet_id, m.user_id, 'document.move_out', 'document', d.id, old_patient,
    jsonb_build_object('patient_id', old_patient),
    jsonb_build_object('patient_id', p_new_patient_id, 'reason', btrim(p_reason), 'version', d.version));
  return d;
end $$;

-- Archivage (suppression logique) d'un document ; jamais d'effacement physique en V1.
create function public.archive_document(p_id uuid, p_reason text) returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member(array['dentiste', 'admin']::public.member_role[]);
  d public.documents;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'motif obligatoire' using errcode = '22023';
  end if;
  update public.documents set status = 'archived', version = version + 1, updated_at = now()
    where id = p_id and cabinet_id = m.cabinet_id returning * into d;
  if not found then
    raise exception 'document introuvable' using errcode = 'P0002';
  end if;
  perform private.write_audit(m.cabinet_id, m.user_id, 'document.archive', 'document', d.id, d.patient_id,
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'archived', 'reason', btrim(p_reason)));
  return d;
end $$;

-- Journalisation d'un accès (consultation d'images), appelée par le serveur.
create function public.server_log_access(p_actor uuid, p_document_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document_id;
  if found then
    perform private.write_audit(d.cabinet_id, p_actor, 'document.view', 'document', d.id, d.patient_id, null, null);
  end if;
end $$;

-- Administration : liste des comptes du cabinet avec dernière connexion.
create function public.list_members() returns table (
  user_id uuid, full_name text, role public.member_role, status public.account_status,
  email text, last_login_at timestamptz, active_sessions bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.members := private.require_member(array['admin', 'dentiste']::public.member_role[]);
begin
  return query
    select mb.user_id, mb.full_name, mb.role, mb.status, u.email::text, mb.last_login_at,
           (select count(*) from auth.sessions s where s.user_id = mb.user_id)
    from public.members mb join auth.users u on u.id = mb.user_id
    where mb.cabinet_id = m.cabinet_id
    order by mb.full_name;
end $$;

-- Téléphone perdu : révoque toutes les sessions d'un compte (effet immédiat).
create function public.admin_revoke_sessions(p_user_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member(array['admin', 'dentiste']::public.member_role[]);
  n integer;
begin
  if not exists (select 1 from public.members where user_id = p_user_id and cabinet_id = m.cabinet_id) then
    raise exception 'compte introuvable' using errcode = 'P0002';
  end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  perform private.write_audit(m.cabinet_id, m.user_id, 'member.revoke_sessions', 'member', p_user_id, null, null,
    jsonb_build_object('sessions_revoked', n));
  return n;
end $$;

-- Activation / désactivation d'un compte (réservé à l'administrateur).
create function public.admin_set_member_status(p_user_id uuid, p_status public.account_status) returns public.members
language plpgsql security definer set search_path = '' as $$
declare
  m public.members := private.require_member(array['admin']::public.member_role[]);
  target public.members;
  old_status public.account_status;
begin
  if p_user_id = m.user_id then
    raise exception 'impossible de modifier son propre compte' using errcode = '22023';
  end if;
  select status into old_status from public.members where user_id = p_user_id and cabinet_id = m.cabinet_id for update;
  if not found then
    raise exception 'compte introuvable' using errcode = 'P0002';
  end if;
  update public.members set status = p_status where user_id = p_user_id returning * into target;
  if p_status = 'disabled' then
    delete from auth.sessions where user_id = p_user_id;
  end if;
  perform private.write_audit(m.cabinet_id, m.user_id, 'member.set_status', 'member', p_user_id, null,
    jsonb_build_object('status', old_status), jsonb_build_object('status', p_status));
  return target;
end $$;

-- Tableau de bord (droits de l'appelant appliqués : security invoker + RLS).
create function public.dashboard_summary() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  tz text;
  today date;
begin
  select coalesce(c.settings ->> 'timezone', 'Africa/Casablanca') into tz
    from public.cabinets c where c.id = private.my_cabinet();
  if tz is null then
    raise exception 'accès refusé' using errcode = '42501';
  end if;
  today := (now() at time zone tz)::date;
  return jsonb_build_object(
    'timezone', tz,
    'today', today,
    'imported_today', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select d.id, d.patient_id, p.last_name, p.first_name, p.file_number, d.page_count,
               d.sync_status, d.document_date, d.created_at
        from public.documents d join public.patients p on p.id = d.patient_id
        where d.status = 'active' and (d.created_at at time zone tz)::date = today
        limit 200) x), '[]'::jsonb),
    'recent_patients', coalesce((
      select jsonb_agg(x order by x.updated_at desc) from (
        select id, last_name, first_name, file_number, phone, updated_at
        from public.patients where status = 'active' order by updated_at desc limit 10) x), '[]'::jsonb),
    -- documents dont des pages manquent depuis plus de 30 minutes : envoi interrompu ou échoué
    'incomplete', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select d.id, d.patient_id, p.last_name, p.first_name, p.file_number, d.page_count,
               (select count(*) from public.pages pg where pg.document_id = d.id) as pages_received,
               d.created_at, d.device_label
        from public.documents d join public.patients p on p.id = d.patient_id
        where d.status = 'active' and d.sync_status = 'receiving' and d.created_at < now() - interval '30 minutes'
        limit 100) x), '[]'::jsonb)
  );
end $$;

-- Droits d'exécution : rien pour anon ; le strict nécessaire pour authenticated.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.touch_member(text),
  public.create_patient(uuid, text, text, text, date, text),
  public.update_patient(uuid, text, text, text, date),
  public.search_patients(text, integer),
  public.create_document(uuid, uuid, date, text, integer, text),
  public.finalize_document(uuid),
  public.move_document(uuid, uuid, text),
  public.archive_document(uuid, text),
  public.list_members(),
  public.admin_revoke_sessions(uuid),
  public.admin_set_member_status(uuid, public.account_status),
  public.dashboard_summary()
to authenticated;
grant execute on function public.server_register_page(uuid, uuid, uuid, integer, text, text, integer, integer, integer, text),
  public.server_log_access(uuid, uuid)
to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Stockage : bucket PRIVÉ, JPEG uniquement, 10 Mo max. Aucune politique pour
-- anon/authenticated : seul le serveur (service_role) lit/écrit, et l'affichage
-- se fait par liens signés de courte durée.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fiches', 'fiches', false, 10485760, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
