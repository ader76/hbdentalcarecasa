-- =============================================================================
-- Mise en service : À EXÉCUTER UNE SEULE FOIS dans Supabase → SQL Editor,
-- APRÈS la migration (supabase/migrations/20260928000001_v1_schema.sql)
-- et APRÈS avoir créé les comptes dans Authentication → Users.
-- Remplacer les 3 valeurs entre chevrons, puis « Run ».
-- =============================================================================
do $$
declare
  cab uuid;
  dentiste_email text := '<EMAIL_DU_DENTISTE>';
  dentiste_nom text := '<NOM_AFFICHÉ, ex. Dr Hicham>';
  cabinet_nom text := '<NOM_DU_CABINET>';
  uid uuid;
begin
  if dentiste_email like '<%' then
    raise exception 'Remplacez d''abord les valeurs entre chevrons';
  end if;
  select id into uid from auth.users where lower(email) = lower(dentiste_email);
  if uid is null then
    raise exception 'Compte % introuvable : créez-le d''abord dans Authentication → Users', dentiste_email;
  end if;
  insert into public.cabinets (name) values (cabinet_nom) returning id into cab;
  -- rôle « admin » en plus de dentiste ? Le dentiste a déjà accès au journal et aux comptes.
  insert into public.members (user_id, cabinet_id, full_name, role) values (uid, cab, dentiste_nom, 'dentiste');
  raise notice 'Cabinet créé (%). Compte % rattaché comme dentiste.', cab, dentiste_email;
end $$;

-- Vérification : doit afficher 1 ligne.
select m.full_name, m.role, c.name as cabinet from public.members m join public.cabinets c on c.id = m.cabinet_id;
