-- ============================================================================
-- ANDÁ · 0002 · Funciones de ayuda (esquema "private": no accesible desde la API)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Identidad, fecha local, aleatorios
-- ---------------------------------------------------------------------------
create function private.me() returns uuid
language plpgsql stable set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then
    raise exception 'no_autenticado' using errcode = 'PT401';
  end if;
  return u;
end $$;

create function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone (select timezone from public.app_config))::date
$$;

create function private.local_day(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select (ts at time zone (select timezone from public.app_config))::date
$$;

-- entero aleatorio en [0, n) usando gen_random_uuid() (criptográficamente aleatorio)
create function private.rand_int(n int) returns int
language sql volatile set search_path = '' as $$
  select (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % n)::int
$$;

create function private.gen_visit_code(p_avoid text) returns text
language plpgsql volatile set search_path = '' as $$
declare c text;
begin
  loop
    c := lpad(private.rand_int(1000000)::text, 6, '0');
    exit when c is distinct from p_avoid;
  end loop;
  return c;
end $$;

-- código de cupón legible: 8 caracteres sin letras ambiguas (alfabeto de 32 => sin sesgo)
create function private.gen_coupon_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  s text := '';
  i int;
begin
  for i in 1..8 loop
    s := s || substr(alphabet, private.rand_int(32) + 1, 1);
  end loop;
  return substr(s, 1, 4) || '-' || substr(s, 5, 4);
end $$;

create function private.normalize_coupon_code(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when length(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')) = 8
    then substr(regexp_replace(upper(p), '[^A-Z0-9]', '', 'g'), 1, 4) || '-' ||
         substr(regexp_replace(upper(p), '[^A-Z0-9]', '', 'g'), 5, 4)
    else upper(coalesce(p, ''))
  end
$$;

create function private.dist_m(lat1 double precision, lng1 double precision,
                               lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ---------------------------------------------------------------------------
-- Libro de PASOS: inmutable (append-only) y billetera derivada
-- ---------------------------------------------------------------------------
create function private.ledger_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'libro_inmutable: los movimientos no se borran; se corrigen con un movimiento compensatorio';
  end if;
  -- Única modificación permitida: anonimizar (user_id -> null) al eliminar una cuenta.
  if new.user_id is null and old.user_id is not null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'libro_inmutable: los movimientos no se editan; se corrigen con un movimiento compensatorio';
end $$;

create trigger pasos_ledger_guard before update or delete on public.pasos_ledger
  for each row execute function private.ledger_guard();
create trigger pasos_ledger_guard_truncate before truncate on public.pasos_ledger
  for each statement execute function private.ledger_guard();

create function private.ledger_to_wallet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    insert into public.wallets (user_id, balance) values (new.user_id, new.amount)
    on conflict (user_id) do update
      set balance = public.wallets.balance + excluded.balance, updated_at = now();
  end if;
  return new;
end $$;
create trigger pasos_ledger_wallet after insert on public.pasos_ledger
  for each row execute function private.ledger_to_wallet();

-- Agrega un movimiento. Idempotente por p_idem (si ya existe, devuelve el existente).
create function private.ledger_add(
  p_user uuid, p_kind text, p_amount int, p_idem text,
  p_ref_type text default null, p_ref_id uuid default null,
  p_reason text default null, p_actor uuid default null, p_reverses bigint default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.pasos_ledger (user_id, kind, amount, idem_key, ref_type, ref_id, reason, actor, reverses_id)
  values (p_user, p_kind, p_amount, p_idem, p_ref_type, p_ref_id, p_reason, p_actor, p_reverses)
  on conflict (idem_key) do nothing
  returning id into v;
  if v is null then
    select id into v from public.pasos_ledger where idem_key = p_idem;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Auditoría: append-only con cadena de hashes (detecta alteraciones)
-- ---------------------------------------------------------------------------
create function private.audit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'auditoria_inmutable: el registro de auditoría no se edita ni se borra';
end $$;
create trigger audit_log_guard before update or delete on public.audit_log
  for each row execute function private.audit_guard();
create trigger audit_log_guard_truncate before truncate on public.audit_log
  for each statement execute function private.audit_guard();

create function private.audit_hash(prev text, r public.audit_log) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(
    coalesce(prev, '') || '|' || r.id || '|' ||
    to_char(r.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(r.actor::text, '') || '|' || coalesce(r.actor_role, '') || '|' || r.action || '|' ||
    coalesce(r.target_type, '') || '|' || coalesce(r.target_id, '') || '|' ||
    coalesce(r.summary, '') || '|' || coalesce(r.details::text, ''), 'UTF8')), 'hex')
$$;

create function private.audit_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare prev text;
begin
  perform pg_advisory_xact_lock(7441001);
  select hash into prev from public.audit_log order by id desc limit 1;
  new.prev_hash := prev;
  new.hash := private.audit_hash(prev, new);
  return new;
end $$;
create trigger audit_log_chain before insert on public.audit_log
  for each row execute function private.audit_chain();

create function private.verify_audit_chain() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.audit_log; prev text := null; n int := 0;
begin
  for r in select * from public.audit_log order by id loop
    n := n + 1;
    if r.prev_hash is distinct from prev or r.hash is distinct from private.audit_hash(prev, r) then
      return jsonb_build_object('ok', false, 'broken_at', r.id, 'checked', n);
    end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'checked', n);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
create function private.perm_catalog() returns text[]
language sql immutable set search_path = '' as $$
  select array['desafios.editar','desafios.aprobar','catalogo.gestionar','fotos.gestionar',
               'personas.ver','visitas.ver','cupones.ver','auditoria.ver']
$$;

-- Segundo factor: si está exigido, la sesión tiene que ser aal2 (TOTP verificado)
create function private.require_mfa() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select mfa_required from public.app_config)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_requerido' using errcode = 'PT403';
  end if;
end $$;

create function private.staff_role(p_user uuid) returns public.user_roles
language sql stable security definer set search_path = '' as $$
  select * from public.user_roles
  where user_id = p_user and role in ('ceo','equipo') and active
  order by (role = 'ceo') desc
  limit 1
$$;

create function private.require_staff() returns public.user_roles
language plpgsql stable security definer set search_path = '' as $$
declare r public.user_roles;
begin
  r := private.staff_role(private.me());
  if r.id is null then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;
  perform private.require_mfa();
  return r;
end $$;

create function private.require_ceo() returns public.user_roles
language plpgsql stable security definer set search_path = '' as $$
declare r public.user_roles;
begin
  r := private.require_staff();
  if r.role <> 'ceo' then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;
  return r;
end $$;

create function private.require_perm(p text) returns public.user_roles
language plpgsql stable security definer set search_path = '' as $$
declare r public.user_roles;
begin
  r := private.require_staff();
  if r.role = 'ceo' or p = any (r.perms) then
    return r;
  end if;
  raise exception 'sin_permiso' using errcode = 'PT403';
end $$;

create function private.has_perm(p text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r public.user_roles;
begin
  r := private.staff_role(auth.uid());
  return r.id is not null and (r.role = 'ceo' or p = any (r.perms));
end $$;

-- Cuenta de comercio activa para ese comercio (y comercio no suspendido)
create function private.require_merchant(p_merchant uuid) returns public.user_roles
language plpgsql stable security definer set search_path = '' as $$
declare r public.user_roles; m public.merchants;
begin
  select * into r from public.user_roles
   where user_id = private.me() and role = 'comercio' and merchant_id = p_merchant and active;
  if r.id is null then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;
  select * into m from public.merchants where id = p_merchant;
  if m.status <> 'activo' then
    raise exception 'comercio_suspendido' using errcode = 'PT403';
  end if;
  return r;
end $$;

-- Estado efectivo de un desafío (programado empieza solo; activo termina solo)
create function private.challenge_state(c public.challenges) returns text
language sql stable set search_path = '' as $$
  select case
    when c.status = 'programado' and c.starts_at is not null and c.starts_at <= now()
         and (c.ends_at is null or c.ends_at > now()) then 'activo'
    when c.status in ('programado','activo','pausado') and c.ends_at is not null and c.ends_at <= now()
         then 'finalizado'
    else c.status
  end
$$;

-- Cupo de un desafío: completados (válidos, sin revertir) y lugares reservados vigentes
create function private.challenge_completions(c public.challenges) returns bigint
language sql stable set search_path = '' as $$
  select case when c.type = 'visita'
    then (select count(*) from public.visits v where v.challenge_id = c.id and v.status = 'valida')
    else (select count(*) from public.pasos_ledger l where l.kind = 'meta_pasos' and l.ref_id = c.id
            and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id)) end
$$;

create function private.challenge_reserved(c public.challenges) returns bigint
language sql stable set search_path = '' as $$
  select count(*) from public.challenge_acceptances a
   where a.challenge_id = c.id and a.status = 'activa' and a.expires_at > now()
$$;

-- ---------------------------------------------------------------------------
-- Auditoría (escritura) y alertas
-- ---------------------------------------------------------------------------
create function private.audit(p_action text, p_target_type text, p_target_id text,
                               p_summary text, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.user_roles;
begin
  r := private.staff_role(auth.uid());
  insert into public.audit_log (actor, actor_role, action, target_type, target_id, summary, details)
  values (auth.uid(), coalesce(r.role, case when auth.uid() is null then 'sistema' else 'usuario' end),
          p_action, p_target_type, p_target_id, p_summary, p_details);
end $$;

create function private.raise_alert(p_kind text, p_severity text, p_entity_type text,
                                    p_entity_id text, p_summary text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alerts (kind, severity, entity_type, entity_id, summary)
  values (p_kind, p_severity, p_entity_type, p_entity_id, p_summary)
  on conflict (kind, entity_id) where status in ('nueva','en_revision') do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Versionado de desafíos y premios
-- ---------------------------------------------------------------------------
create function private.version_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.row_versions (table_name, row_id, version, snapshot, actor)
  values (tg_table_name, old.id, old.version, to_jsonb(old), auth.uid());
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger challenges_version before update on public.challenges
  for each row execute function private.version_row();
create trigger rewards_version before update on public.rewards
  for each row execute function private.version_row();

-- ---------------------------------------------------------------------------
-- Código dinámico de visita (rotación diferida: se rota al consultar)
-- Un código es válido rotation_s segundos; luego queda "en gracia" code_grace_s más.
-- ---------------------------------------------------------------------------
create function private.ensure_code(p_branch uuid) returns public.visit_codes
language plpgsql security definer set search_path = '' as $$
declare cfg public.app_config; vc public.visit_codes;
begin
  select * into cfg from public.app_config;
  insert into public.visit_codes (branch_id, code)
  values (p_branch, private.gen_visit_code(null))
  on conflict (branch_id) do nothing;

  select * into vc from public.visit_codes where branch_id = p_branch for update;

  if now() >= vc.rotated_at + make_interval(secs => cfg.code_rotation_s) then
    update public.visit_codes set
      prev_code = vc.code,
      prev_valid_until = vc.rotated_at + make_interval(secs => cfg.code_rotation_s + cfg.code_grace_s),
      prev_uses = vc.uses,
      old_codes = case when vc.prev_code is null then vc.old_codes
                       else (array_prepend(vc.prev_code, vc.old_codes))[1:8] end,
      code = private.gen_visit_code(vc.code),
      uses = 0,
      rotated_at = now()
    where branch_id = p_branch
    returning * into vc;
  end if;
  return vc;
end $$;

-- ---------------------------------------------------------------------------
-- Validación de rutas de fotos (Storage o imagen embebida del modo demostración)
-- ---------------------------------------------------------------------------
create function private.assert_photo_path(p text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p is null then return; end if;
  if p ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and char_length(p) <= 700000 then return; end if;
  if p ~ '^[a-z_]+/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' then return; end if;
  if p ~ '^config/[A-Za-z0-9._-]{1,120}$' then return; end if;
  raise exception 'foto_invalida';
end $$;
