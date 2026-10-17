-- ============================================================================
-- ANDÁ · 0003 · Funciones de sesión y del perfil PERSONA
-- Convenciones:
--  * Todas son SECURITY DEFINER con search_path vacío y validan quién llama.
--  * Los rechazos de negocio devuelven {"ok": false, "reason": "..."} (sin error)
--    para que no se pierdan registros como los intentos fallidos.
--  * Los errores de acceso lanzan excepción (HTTP 401/403).
--  * Ninguna función de esta etapa cambia estado antes de decidir un rechazo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Ayudas internas
-- ---------------------------------------------------------------------------
create function private.require_profile() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where user_id = private.me();
  if not found then
    raise exception 'sin_perfil' using errcode = 'PT403';
  end if;
  return p;
end $$;

create function private.test_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select test_mode and environment = 'prueba' from public.app_config
$$;

-- Pasos caminados visibles: los de prueba solo cuentan si el modo prueba está habilitado
create function private.visible_steps(p_user uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(s.steps), 0)::int
  from public.step_days s
  where s.user_id = p_user and s.day = p_day
    and (s.source = 'dispositivo' or (s.source = 'prueba' and private.test_allowed()))
$$;

create function private.balance_of(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select balance from public.wallets where user_id = p_user), 0)
$$;

create function private.reject(p_reason text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'reason', p_reason) || p_extra
$$;

-- ---------------------------------------------------------------------------
-- Configuración pública (pantalla de ingreso, sin sesión)
-- ---------------------------------------------------------------------------
create function public.public_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'environment', environment,
    'test_mode', test_mode and environment = 'prueba',
    'paused', paused,
    'logo_path', logo_path,
    'banner_path', banner_path,
    'terms_version', terms_version,
    'privacy_version', privacy_version
  ) from public.app_config
$$;

-- ---------------------------------------------------------------------------
-- Contexto de sesión: qué perfiles puede abrir quien está autenticado
-- ---------------------------------------------------------------------------
create function public.my_context() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_prof public.profiles;
  v_roles jsonb;
begin
  select * into v_cfg from public.app_config;
  select * into v_prof from public.profiles where user_id = v_me;

  update public.user_roles set last_access_at = now() where user_id = v_me and active;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'role', r.role, 'merchant_id', r.merchant_id,
      'merchant_name', m.name, 'merchant_status', m.status,
      'perms', case when r.role = 'ceo' then to_jsonb(private.perm_catalog()) else to_jsonb(r.perms) end,
      'display_name', r.display_name,
      'must_change_password', r.must_change_password
    ) order by r.role, m.name), '[]'::jsonb)
  into v_roles
  from public.user_roles r
  left join public.merchants m on m.id = r.merchant_id
  where r.user_id = v_me and r.active;

  return jsonb_build_object(
    'uid', v_me,
    'profile', case when v_prof.user_id is null then null else jsonb_build_object(
        'display_name', v_prof.display_name, 'status', v_prof.status,
        'needs_terms', v_prof.terms_version <> v_cfg.terms_version or v_prof.privacy_version <> v_cfg.privacy_version
      ) end,
    'roles', v_roles,
    'config', jsonb_build_object(
      'environment', v_cfg.environment,
      'test_mode', v_cfg.test_mode and v_cfg.environment = 'prueba',
      'paused', v_cfg.paused,
      'daily_cap', v_cfg.daily_cap,
      'code_rotation_s', v_cfg.code_rotation_s,
      'require_gps', v_cfg.require_gps,
      'mfa_required', v_cfg.mfa_required,
      'terms_version', v_cfg.terms_version,
      'privacy_version', v_cfg.privacy_version,
      'logo_path', v_cfg.logo_path,
      'banner_path', v_cfg.banner_path
    ),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Registro (solo mayores de 18; no se pide ni se guarda DNI)
-- ---------------------------------------------------------------------------
create function public.register_profile(
  p_name text, p_birth date, p_adult boolean, p_terms boolean, p_privacy boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_name text := btrim(coalesce(p_name, ''));
  v_today date := private.today();
begin
  select * into v_cfg from public.app_config;

  if exists (select 1 from public.profiles where user_id = v_me) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    return private.reject('nombre_invalido');
  end if;
  if p_birth is null or p_birth > v_today or p_birth < date '1900-01-01' then
    return private.reject('fecha_invalida');
  end if;
  -- Menor de 18: se rechaza y NO se guarda nada (ni siquiera la fecha).
  if p_birth > (v_today - interval '18 years')::date then
    return private.reject('menor');
  end if;
  if not (coalesce(p_adult, false) and coalesce(p_terms, false) and coalesce(p_privacy, false)) then
    return private.reject('falta_aceptacion');
  end if;

  insert into public.profiles (user_id, display_name, birth_date, adult_declared_at,
                               terms_version, privacy_version, accepted_at)
  values (v_me, v_name, p_birth, now(), v_cfg.terms_version, v_cfg.privacy_version, now());
  insert into public.consents (user_id, kind, version)
  values (v_me, 'terminos', v_cfg.terms_version), (v_me, 'privacidad', v_cfg.privacy_version);
  insert into public.wallets (user_id) values (v_me) on conflict do nothing;

  return jsonb_build_object('ok', true);
end $$;

create function public.accept_terms(p_terms_version text, p_privacy_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cfg public.app_config; v_me uuid := private.me();
begin
  perform private.require_profile();
  select * into v_cfg from public.app_config;
  if p_terms_version is distinct from v_cfg.terms_version
     or p_privacy_version is distinct from v_cfg.privacy_version then
    return private.reject('version_desactualizada');
  end if;
  update public.profiles set terms_version = v_cfg.terms_version,
         privacy_version = v_cfg.privacy_version, accepted_at = now() where user_id = v_me;
  insert into public.consents (user_id, kind, version)
  values (v_me, 'terminos', v_cfg.terms_version), (v_me, 'privacidad', v_cfg.privacy_version)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_p public.profiles;
begin
  v_p := private.require_profile();
  return jsonb_build_object(
    'display_name', v_p.display_name, 'birth_date', v_p.birth_date, 'status', v_p.status,
    'accepted_at', v_p.accepted_at, 'terms_version', v_p.terms_version,
    'privacy_version', v_p.privacy_version, 'created_at', v_p.created_at);
end $$;

create function public.update_my_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_profile();
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    return private.reject('nombre_invalido');
  end if;
  update public.profiles set display_name = v_name where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Inicio
-- ---------------------------------------------------------------------------
create function public.person_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_today date := private.today();
  v_bal bigint;
  v_next jsonb;
begin
  perform private.require_profile();
  select * into v_cfg from public.app_config;
  v_bal := private.balance_of(v_me);

  -- premio más cercano que todavía no alcanza
  select jsonb_build_object('id', r.id, 'title', r.title, 'cost_pasos', r.cost_pasos,
                            'merchant_name', m.name, 'photo_path', r.photo_path,
                            'missing', greatest(r.cost_pasos - v_bal, 0))
  into v_next
  from public.rewards r join public.merchants m on m.id = r.merchant_id
  where r.status = 'activo' and m.status = 'activo' and (r.stock is null or r.stock > 0)
  order by (case when r.cost_pasos > v_bal then 0 else 1 end), abs(r.cost_pasos - v_bal), r.cost_pasos
  limit 1;

  return jsonb_build_object(
    'balance', v_bal,
    'today_steps', private.visible_steps(v_me, v_today),
    'visits_today', (select count(*) from public.visits v
                     where v.user_id = v_me and v.day = v_today and v.status = 'valida'),
    'daily_cap', v_cfg.daily_cap,
    'pending_coupons', (select count(*) from public.coupons c
                        where c.user_id = v_me and c.status = 'pendiente' and c.expires_at > now()),
    'next_reward', v_next,
    'paused', v_cfg.paused,
    'test_mode', v_cfg.test_mode and v_cfg.environment = 'prueba'
  );
end $$;

-- ---------------------------------------------------------------------------
-- Desafíos y mapa
-- ---------------------------------------------------------------------------
create function public.list_challenges() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_today date := private.today();
  v_visits_today int;
  v_steps int;
  v_out jsonb;
begin
  perform private.require_profile();
  select * into v_cfg from public.app_config;
  v_steps := private.visible_steps(v_me, v_today);
  select count(*) into v_visits_today from public.visits v
   where v.user_id = v_me and v.day = v_today and v.status = 'valida';

  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_out
  from (
    select c.created_at as ord,
      jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description, 'category', c.category,
        'type', c.type, 'reward_pasos', c.reward_pasos, 'repeat_rule', c.repeat_rule,
        'goal_steps', c.goal_steps, 'ends_at', c.ends_at, 'photo_path', c.photo_path,
        'is_example', c.is_example,
        'merchant', case when m.id is null then null else jsonb_build_object(
            'id', m.id, 'name', m.name, 'neighborhood', m.neighborhood, 'photo_path', m.photo_path) end,
        'requires_acceptance', c.quota_total is not null,
        'quota_left', case when c.quota_total is null then null else greatest(c.quota_total - q.used - q.reserved, 0) end,
        'my_acceptance', (select jsonb_build_object('id', a.id, 'expires_at', a.expires_at)
                            from public.challenge_acceptances a
                           where a.challenge_id = c.id and a.user_id = v_me and a.status = 'activa' and a.expires_at > now()),
        'done_total', p.done_total, 'done_today', p.done_today,
        'today_steps', case when c.type = 'meta_pasos' then v_steps else null end,
        'unavailable_reason', case
            when v_cfg.paused then 'pausa'
            when c.repeat_rule = 'una_vez' and p.done_total >= 1 then 'ya_acreditado'
            when c.repeat_rule = 'diaria' and p.done_today >= 1 then 'ya_acreditado_hoy'
            when c.per_person_max is not null and p.done_total >= c.per_person_max then 'limite_persona'
            when c.quota_total is not null and q.used + q.reserved >= c.quota_total and not q.mine then 'cupo_agotado'
            when c.type = 'visita' and v_visits_today >= v_cfg.daily_cap then 'tope_diario'
            else null end
      ) as j
    from public.challenges c
    left join public.merchants m on m.id = c.merchant_id
    cross join lateral (
      select
        case when c.type = 'visita'
          then (select count(*) from public.visits v where v.user_id = v_me and v.challenge_id = c.id and v.status = 'valida')
          else (select count(*) from public.pasos_ledger l where l.user_id = v_me and l.kind = 'meta_pasos' and l.ref_id = c.id
                  and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id)) end as done_total,
        case when c.type = 'visita'
          then (select count(*) from public.visits v where v.user_id = v_me and v.challenge_id = c.id and v.status = 'valida' and v.day = v_today)
          else (select count(*) from public.pasos_ledger l where l.user_id = v_me and l.kind = 'meta_pasos' and l.ref_id = c.id
                  and private.local_day(l.created_at) = v_today
                  and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id)) end as done_today
    ) p
    cross join lateral (
      select case when c.type = 'visita'
          then (select count(*) from public.visits v where v.challenge_id = c.id and v.status = 'valida')
          else (select count(*) from public.pasos_ledger l where l.kind = 'meta_pasos' and l.ref_id = c.id
                  and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id)) end as used,
        (select count(*) from public.challenge_acceptances a
          where a.challenge_id = c.id and a.status = 'activa' and a.expires_at > now()) as reserved,
        exists (select 1 from public.challenge_acceptances a
                 where a.challenge_id = c.id and a.user_id = v_me and a.status = 'activa' and a.expires_at > now()) as mine
    ) q
    where private.challenge_state(c) = 'activo'
      and (m.id is null or m.status = 'activo')
      -- con cupo: desaparece cuando se ocupan todos los lugares (salvo para quien ya participa)
      and (c.quota_total is null or q.used + q.reserved < c.quota_total or q.mine or p.done_total > 0)
  ) x;
  return v_out;
end $$;

create function public.list_merchants_map() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_profile();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'category', m.category, 'neighborhood', m.neighborhood,
      'photo_path', m.photo_path, 'is_example', m.is_example,
      'branches', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', b.id, 'name', b.name, 'address', b.address, 'lat', b.lat, 'lng', b.lng)
                     order by b.name), '[]'::jsonb)
                   from public.branches b where b.merchant_id = m.id and b.status = 'activo'),
      'challenges', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', c.id, 'title', c.title, 'reward_pasos', c.reward_pasos, 'type', c.type)
                       order by c.created_at), '[]'::jsonb)
                     from public.challenges c
                     where c.merchant_id = m.id and private.challenge_state(c) = 'activo'
                       and (c.quota_total is null
                            or private.challenge_completions(c) + private.challenge_reserved(c) < c.quota_total))
    ) order by m.name), '[]'::jsonb)
    from public.merchants m where m.status = 'activo'
  );
end $$;

-- ---------------------------------------------------------------------------
-- Aceptar un desafío con cupo = reservar un lugar por un plazo (config.acceptance_hours)
-- ---------------------------------------------------------------------------
create function public.accept_challenge(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_prof public.profiles;
  v_ch public.challenges;
  v_state text;
  v_acc public.challenge_acceptances;
  v_today date := private.today();
  v_total int;
  v_todays int;
  v_used bigint;
  v_res bigint;
begin
  v_prof := private.require_profile();
  select * into v_cfg from public.app_config;
  if v_prof.status <> 'activo' then return private.reject('cuenta_suspendida'); end if;
  if v_cfg.paused then return private.reject('pausa'); end if;

  select * into v_ch from public.challenges where id = p_challenge_id;
  if not found then return private.reject('desafio_no_encontrado'); end if;
  v_state := private.challenge_state(v_ch);
  if v_state = 'finalizado' then return private.reject('desafio_finalizado'); end if;
  if v_state <> 'activo' then return private.reject('desafio_no_disponible'); end if;
  if v_ch.quota_total is null then return private.reject('no_requiere_aceptar'); end if;
  if v_ch.type = 'visita' and not exists (
       select 1 from public.merchants where id = v_ch.merchant_id and status = 'activo') then
    return private.reject('comercio_no_disponible');
  end if;

  -- Serializa con quienes aceptan o completan este mismo desafío (no se puede pasar del cupo)
  perform 1 from public.challenges where id = v_ch.id for update;
  update public.challenge_acceptances set status = 'vencida', closed_at = now()
   where challenge_id = v_ch.id and status = 'activa' and expires_at <= now();

  select * into v_acc from public.challenge_acceptances
   where challenge_id = v_ch.id and user_id = v_me and status = 'activa';
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'acceptance_id', v_acc.id, 'expires_at', v_acc.expires_at);
  end if;

  -- Mismas reglas por persona que al completarlo
  if v_ch.type = 'visita' then
    select count(*) into v_total from public.visits
     where user_id = v_me and challenge_id = v_ch.id and status = 'valida';
    select count(*) into v_todays from public.visits
     where user_id = v_me and challenge_id = v_ch.id and status = 'valida' and day = v_today;
  else
    select count(*) into v_total from public.pasos_ledger l
     where l.user_id = v_me and l.kind = 'meta_pasos' and l.ref_id = v_ch.id
       and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id);
    select count(*) into v_todays from public.pasos_ledger l
     where l.user_id = v_me and l.kind = 'meta_pasos' and l.ref_id = v_ch.id and private.local_day(l.created_at) = v_today
       and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id);
  end if;
  if v_ch.repeat_rule = 'una_vez' and v_total >= 1 then return private.reject('ya_acreditado'); end if;
  if v_ch.repeat_rule = 'diaria' and v_todays >= 1 then return private.reject('ya_acreditado_hoy'); end if;
  if v_ch.per_person_max is not null and v_total >= v_ch.per_person_max then
    return private.reject('limite_persona');
  end if;

  v_used := private.challenge_completions(v_ch);
  v_res := private.challenge_reserved(v_ch);
  if v_used + v_res >= v_ch.quota_total then return private.reject('cupo_agotado'); end if;

  insert into public.challenge_acceptances (challenge_id, user_id, expires_at)
  values (v_ch.id, v_me, now() + make_interval(hours => v_cfg.acceptance_hours))
  returning * into v_acc;
  update public.profiles set last_activity_at = now() where user_id = v_me;
  return jsonb_build_object('ok', true, 'acceptance_id', v_acc.id, 'expires_at', v_acc.expires_at,
                            'slots_left', v_ch.quota_total - v_used - v_res - 1);
end $$;

-- Soltar el lugar reservado (queda libre para otra persona)
create function public.cancel_acceptance(p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_n int;
begin
  perform private.require_profile();
  update public.challenge_acceptances set status = 'cancelada', closed_at = now()
   where challenge_id = p_challenge_id and user_id = v_me and status = 'activa';
  get diagnostics v_n = row_count;
  if v_n = 0 then return private.reject('aceptacion_no_encontrada'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Reclamo de visita (código dinámico validado en el servidor)
-- ---------------------------------------------------------------------------
create function public.claim_visit(
  p_claim_id uuid, p_challenge_id uuid, p_code text,
  p_claimed_at timestamptz default null,
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_prof public.profiles;
  v_ch public.challenges;
  v_m public.merchants;
  v_v public.visits;
  v_br public.branches;
  v_vc public.visit_codes;
  v_code text := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  v_today date := private.today();
  v_state text;
  v_fails int;
  v_total int;
  v_todays int;
  v_used int;
  v_acc public.challenge_acceptances;
  v_matched uuid := null;
  v_matched_prev boolean := false;
  v_validating boolean := false;
  v_expired boolean := false;
  v_got int;
  v_gps boolean := false;
  v_visit_id uuid := gen_random_uuid();
  v_led bigint;
  v_fee numeric;
  v_bal bigint;
begin
  v_prof := private.require_profile();
  select * into v_cfg from public.app_config;

  -- Reintento de red: devolver el resultado original, sin acreditar de nuevo.
  select * into v_v from public.visits where user_id = v_me and claim_id = p_claim_id;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'visit_id', v_v.id,
                              'pasos', v_v.pasos, 'balance', private.balance_of(v_me));
  end if;

  if v_prof.status <> 'activo' then return private.reject('cuenta_suspendida'); end if;
  if v_cfg.paused then return private.reject('pausa'); end if;

  -- Serializa los reclamos de esta persona (evita carreras entre dos dispositivos)
  insert into public.wallets (user_id) values (v_me) on conflict do nothing;
  perform 1 from public.wallets where user_id = v_me for update;

  if p_claimed_at is not null
     and now() - p_claimed_at > make_interval(secs => v_cfg.claim_window_s) then
    return private.reject('reclamo_vencido');
  end if;

  select count(*) into v_fails from public.visit_attempts
   where user_id = v_me and ts > now() - interval '10 minutes';
  if v_fails >= v_cfg.max_failed_attempts then return private.reject('demasiados_intentos'); end if;

  select * into v_ch from public.challenges where id = p_challenge_id;
  if not found or v_ch.type <> 'visita' then return private.reject('desafio_no_encontrado'); end if;
  v_state := private.challenge_state(v_ch);
  if v_state = 'finalizado' then return private.reject('desafio_finalizado'); end if;
  if v_state <> 'activo' then return private.reject('desafio_no_disponible'); end if;

  select * into v_m from public.merchants where id = v_ch.merchant_id;
  if v_m.status <> 'activo' then return private.reject('comercio_no_disponible'); end if;

  select count(*) into v_total from public.visits
   where user_id = v_me and challenge_id = v_ch.id and status = 'valida';
  if v_ch.repeat_rule = 'una_vez' and v_total >= 1 then return private.reject('ya_acreditado'); end if;
  if v_ch.repeat_rule = 'diaria' and exists (
       select 1 from public.visits where user_id = v_me and challenge_id = v_ch.id
          and day = v_today and status = 'valida') then
    return private.reject('ya_acreditado_hoy');
  end if;
  if v_ch.per_person_max is not null and v_total >= v_ch.per_person_max then
    return private.reject('limite_persona');
  end if;

  select count(*) into v_todays from public.visits
   where user_id = v_me and day = v_today and status = 'valida';
  if v_todays >= v_cfg.daily_cap then
    return private.reject('tope_diario', jsonb_build_object('cap', v_cfg.daily_cap));
  end if;

  -- Cupo: se bloquea la fila del desafío para que dos personas no se pasen del cupo
  perform 1 from public.challenges where id = v_ch.id for update;
  if v_ch.quota_total is not null then
    -- desafío con cupo: hace falta un lugar reservado y vigente (ver accept_challenge)
    select * into v_acc from public.challenge_acceptances
     where challenge_id = v_ch.id and user_id = v_me and status = 'activa' for update;
    if not found then return private.reject('requiere_aceptar'); end if;
    if v_acc.expires_at <= now() then
      update public.challenge_acceptances set status = 'vencida', closed_at = now() where id = v_acc.id;
      return private.reject('aceptacion_vencida');
    end if;
    select count(*) into v_used from public.visits where challenge_id = v_ch.id and status = 'valida';
    if v_used >= v_ch.quota_total then return private.reject('cupo_agotado'); end if;
  end if;

  -- Código dinámico: se busca en los locales activos del comercio
  for v_br in select * from public.branches
              where merchant_id = v_ch.merchant_id and status = 'activo' order by id loop
    v_vc := private.ensure_code(v_br.id);
    if v_cfg.require_merchant_active and (v_vc.active_until is null or v_vc.active_until < now()) then
      continue;
    end if;
    v_validating := true;
    if v_code = v_vc.code then
      v_matched := v_br.id; v_matched_prev := false; exit;
    elsif v_vc.prev_code is not null and v_code = v_vc.prev_code then
      if v_vc.prev_valid_until >= now() then
        v_matched := v_br.id; v_matched_prev := true; exit;
      else
        v_expired := true;
      end if;
    elsif v_code = any (v_vc.old_codes) then
      v_expired := true;
    end if;
  end loop;

  if not v_validating then return private.reject('comercio_sin_validacion'); end if;

  if v_matched is null then
    insert into public.visit_attempts (user_id, challenge_id, reason)
    values (v_me, v_ch.id, case when v_expired then 'codigo_vencido' else 'codigo_incorrecto' end);
    if v_fails + 1 >= v_cfg.max_failed_attempts then
      perform private.raise_alert('intentos_codigo', 'media', 'persona', v_me::text,
        'Intentos repetidos de código de visita en pocos minutos');
    end if;
    return private.reject(case when v_expired then 'codigo_vencido' else 'codigo_incorrecto' end);
  end if;

  select * into v_br from public.branches where id = v_matched;

  -- Ubicación (solo si está exigida; en la web inicial está desactivada y no se simula)
  if v_cfg.require_gps then
    if p_lat is null or p_lng is null or p_accuracy is null then
      return private.reject('ubicacion_requerida');
    end if;
    if p_accuracy > 100 then return private.reject('precision_insuficiente'); end if;
    if v_br.lat is null or v_br.lng is null then return private.reject('local_sin_ubicacion'); end if;
    if private.dist_m(p_lat, p_lng, v_br.lat, v_br.lng) > v_br.radius_m then
      return private.reject('fuera_de_rango');
    end if;
    v_gps := true;
  end if;

  -- Uso del código (atómico, con tope de usos)
  if v_matched_prev then
    update public.visit_codes set prev_uses = prev_uses + 1
     where branch_id = v_matched and prev_uses < v_cfg.max_uses_per_code;
  else
    update public.visit_codes set uses = uses + 1
     where branch_id = v_matched and uses < v_cfg.max_uses_per_code;
  end if;
  get diagnostics v_got = row_count;
  if v_got = 0 then return private.reject('codigo_agotado'); end if;

  v_fee := coalesce(v_m.fee_per_visit, v_cfg.fee_per_visit);
  v_led := private.ledger_add(v_me, 'visita', v_ch.reward_pasos, 'visita:' || v_me || ':' || p_claim_id,
                              'visita', v_visit_id, null, v_me);
  insert into public.visits (id, claim_id, user_id, challenge_id, merchant_id, branch_id, day,
                             pasos, fee_ars, gps_verified, ledger_id)
  values (v_visit_id, p_claim_id, v_me, v_ch.id, v_m.id, v_br.id, v_today,
          v_ch.reward_pasos, v_fee, v_gps, v_led);
  if v_acc.id is not null then
    update public.challenge_acceptances set status = 'completada', closed_at = now() where id = v_acc.id;
  end if;
  update public.profiles set last_activity_at = now() where user_id = v_me;

  v_bal := private.balance_of(v_me);
  return jsonb_build_object('ok', true, 'visit_id', v_visit_id, 'pasos', v_ch.reward_pasos,
                            'balance', v_bal, 'challenge_title', v_ch.title,
                            'merchant_name', v_m.name, 'at', now());
end $$;

-- ---------------------------------------------------------------------------
-- Meta de pasos caminados (los pasos solo se muestran; el premio lo da el desafío)
-- ---------------------------------------------------------------------------
create function public.claim_step_goal(p_claim_id uuid, p_challenge_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_prof public.profiles;
  v_ch public.challenges;
  v_today date := private.today();
  v_steps int;
  v_total int;
  v_used int;
  v_acc public.challenge_acceptances;
  v_key text;
  v_led bigint;
begin
  v_prof := private.require_profile();
  select * into v_cfg from public.app_config;
  if v_prof.status <> 'activo' then return private.reject('cuenta_suspendida'); end if;
  if v_cfg.paused then return private.reject('pausa'); end if;

  insert into public.wallets (user_id) values (v_me) on conflict do nothing;
  perform 1 from public.wallets where user_id = v_me for update;

  select * into v_ch from public.challenges where id = p_challenge_id;
  if not found or v_ch.type <> 'meta_pasos' then return private.reject('desafio_no_encontrado'); end if;
  if private.challenge_state(v_ch) = 'finalizado' then return private.reject('desafio_finalizado'); end if;
  if private.challenge_state(v_ch) <> 'activo' then return private.reject('desafio_no_disponible'); end if;

  v_steps := private.visible_steps(v_me, v_today);
  if v_steps < v_ch.goal_steps then
    return private.reject('meta_no_alcanzada', jsonb_build_object('steps', v_steps, 'goal', v_ch.goal_steps));
  end if;

  v_key := case when v_ch.repeat_rule = 'una_vez'
                then 'meta:' || v_me || ':' || v_ch.id
                else 'meta:' || v_me || ':' || v_ch.id || ':' || v_today end;
  if exists (select 1 from public.pasos_ledger where idem_key = v_key) then
    return private.reject(case when v_ch.repeat_rule = 'una_vez' then 'ya_acreditado' else 'ya_acreditado_hoy' end);
  end if;

  select count(*) into v_total from public.pasos_ledger l
   where l.user_id = v_me and l.kind = 'meta_pasos' and l.ref_id = v_ch.id
     and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id);
  if v_ch.per_person_max is not null and v_total >= v_ch.per_person_max then
    return private.reject('limite_persona');
  end if;

  perform 1 from public.challenges where id = v_ch.id for update;
  if v_ch.quota_total is not null then
    select * into v_acc from public.challenge_acceptances
     where challenge_id = v_ch.id and user_id = v_me and status = 'activa' for update;
    if not found then return private.reject('requiere_aceptar'); end if;
    if v_acc.expires_at <= now() then
      update public.challenge_acceptances set status = 'vencida', closed_at = now() where id = v_acc.id;
      return private.reject('aceptacion_vencida');
    end if;
    select count(*) into v_used from public.pasos_ledger l
     where l.kind = 'meta_pasos' and l.ref_id = v_ch.id
       and not exists (select 1 from public.pasos_ledger r where r.reverses_id = l.id);
    if v_used >= v_ch.quota_total then return private.reject('cupo_agotado'); end if;
  end if;

  v_led := private.ledger_add(v_me, 'meta_pasos', v_ch.reward_pasos, v_key, 'desafio', v_ch.id, null, v_me);
  if v_acc.id is not null then
    update public.challenge_acceptances set status = 'completada', closed_at = now() where id = v_acc.id;
  end if;
  update public.profiles set last_activity_at = now() where user_id = v_me;
  return jsonb_build_object('ok', true, 'pasos', v_ch.reward_pasos,
                            'balance', private.balance_of(v_me), 'challenge_title', v_ch.title);
end $$;

-- ---------------------------------------------------------------------------
-- Premios y cupones
-- ---------------------------------------------------------------------------
create function public.list_rewards() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_bal bigint;
begin
  perform private.require_profile();
  v_bal := private.balance_of(v_me);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'description', r.description, 'category', r.category,
      'cost_pasos', r.cost_pasos, 'stock', r.stock, 'unlimited', r.stock is null,
      'valid_days', r.valid_days, 'conditions', r.conditions, 'photo_path', r.photo_path,
      'is_example', r.is_example,
      'merchant', jsonb_build_object('id', m.id, 'name', m.name, 'neighborhood', m.neighborhood,
                                      'photo_path', m.photo_path),
      'can_afford', v_bal >= r.cost_pasos,
      'missing', greatest(r.cost_pasos - v_bal, 0),
      'sold_out', r.stock is not null and r.stock <= 0,
      'my_count', (select count(*) from public.coupons c
                    where c.user_id = v_me and c.reward_id = r.id and c.status <> 'cancelado'),
      'limit_reached', r.per_person_max is not null and
                       (select count(*) from public.coupons c
                         where c.user_id = v_me and c.reward_id = r.id and c.status <> 'cancelado') >= r.per_person_max
    ) order by r.cost_pasos, r.title), '[]'::jsonb)
    from public.rewards r join public.merchants m on m.id = r.merchant_id
    where r.status = 'activo' and m.status = 'activo'
  );
end $$;

create function public.claim_reward(p_claim_id uuid, p_reward_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_prof public.profiles;
  v_r public.rewards;
  v_m public.merchants;
  v_c public.coupons;
  v_bal bigint;
  v_mine int;
  v_code text;
  v_coupon_id uuid := gen_random_uuid();
  v_led bigint;
  v_try int := 0;
  v_got int;
begin
  v_prof := private.require_profile();
  select * into v_cfg from public.app_config;

  select * into v_c from public.coupons where user_id = v_me and claim_id = p_claim_id;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'coupon_id', v_c.id, 'code', v_c.code,
                              'expires_at', v_c.expires_at, 'balance', private.balance_of(v_me));
  end if;

  if v_prof.status <> 'activo' then return private.reject('cuenta_suspendida'); end if;
  if v_cfg.paused then return private.reject('pausa'); end if;

  -- Orden de bloqueo: billetera -> premio (siempre el mismo, para evitar bloqueos cruzados)
  insert into public.wallets (user_id) values (v_me) on conflict do nothing;
  perform 1 from public.wallets where user_id = v_me for update;

  -- Reintento simultáneo con el mismo reclamo: otro pedido ya lo resolvió mientras esperábamos el bloqueo
  select * into v_c from public.coupons where user_id = v_me and claim_id = p_claim_id;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'coupon_id', v_c.id, 'code', v_c.code,
                              'expires_at', v_c.expires_at, 'balance', private.balance_of(v_me));
  end if;

  select * into v_r from public.rewards where id = p_reward_id for update;
  if not found or v_r.status <> 'activo' then return private.reject('premio_no_disponible'); end if;
  select * into v_m from public.merchants where id = v_r.merchant_id;
  if v_m.status <> 'activo' then return private.reject('premio_no_disponible'); end if;
  if v_r.stock is not null and v_r.stock <= 0 then return private.reject('sin_stock'); end if;

  if v_r.per_person_max is not null then
    select count(*) into v_mine from public.coupons
     where user_id = v_me and reward_id = v_r.id and status <> 'cancelado';
    if v_mine >= v_r.per_person_max then return private.reject('limite_persona'); end if;
  end if;

  v_bal := private.balance_of(v_me);
  if v_bal < v_r.cost_pasos then
    return private.reject('saldo_insuficiente',
      jsonb_build_object('balance', v_bal, 'cost', v_r.cost_pasos, 'missing', v_r.cost_pasos - v_bal));
  end if;

  -- Código único (reintenta si hubiera colisión)
  loop
    v_code := private.gen_coupon_code();
    exit when not exists (select 1 from public.coupons where code = v_code);
    v_try := v_try + 1;
    if v_try > 20 then raise exception 'no_se_pudo_generar_codigo'; end if;
  end loop;

  v_led := private.ledger_add(v_me, 'canje', -v_r.cost_pasos, 'canje:' || v_me || ':' || p_claim_id,
                              'cupon', v_coupon_id, null, v_me);
  if v_r.stock is not null then
    update public.rewards set stock = stock - 1 where id = v_r.id and stock > 0;
    get diagnostics v_got = row_count;
    if v_got = 0 then raise exception 'sin_stock'; end if;
  end if;

  insert into public.coupons (id, code, claim_id, user_id, reward_id, merchant_id, reward_title,
                              reward_conditions, cost_pasos, expires_at, debit_ledger_id)
  values (v_coupon_id, v_code, p_claim_id, v_me, v_r.id, v_m.id, v_r.title, v_r.conditions,
          v_r.cost_pasos, now() + make_interval(days => v_r.valid_days), v_led);
  update public.profiles set last_activity_at = now() where user_id = v_me;

  return jsonb_build_object('ok', true, 'coupon_id', v_coupon_id, 'code', v_code,
    'expires_at', now() + make_interval(days => v_r.valid_days),
    'balance', private.balance_of(v_me), 'reward_title', v_r.title, 'merchant_name', v_m.name);
end $$;

create function public.my_coupons() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  perform private.require_profile();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'reward_title', c.reward_title, 'conditions', c.reward_conditions,
      'cost_pasos', c.cost_pasos, 'merchant_id', c.merchant_id, 'merchant_name', m.name,
      'merchant_neighborhood', m.neighborhood,
      'status', case when c.status = 'pendiente' and c.expires_at <= now() then 'vencido' else c.status end,
      'created_at', c.created_at, 'expires_at', c.expires_at, 'redeemed_at', c.redeemed_at,
      'cancel_reason', c.cancel_reason
    ) order by c.created_at desc), '[]'::jsonb)
    from public.coupons c join public.merchants m on m.id = c.merchant_id
    where c.user_id = v_me
  );
end $$;

-- Un cupón pendiente se puede cancelar y recupera los PASOS (movimiento compensatorio)
create function public.cancel_coupon(p_coupon_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_c public.coupons;
  v_led bigint;
begin
  perform private.require_profile();
  insert into public.wallets (user_id) values (v_me) on conflict do nothing;
  perform 1 from public.wallets where user_id = v_me for update;

  select * into v_c from public.coupons where id = p_coupon_id and user_id = v_me for update;
  if not found then return private.reject('cupon_no_encontrado'); end if;
  if v_c.status = 'canjeado' then return private.reject('cupon_ya_utilizado'); end if;
  if v_c.status <> 'pendiente' then return private.reject('cupon_no_cancelable'); end if;
  if v_c.expires_at <= now() then return private.reject('cupon_vencido'); end if;

  v_led := private.ledger_add(v_me, 'devolucion', v_c.cost_pasos, 'devolucion:' || v_c.id,
                              'cupon', v_c.id, 'Cupón cancelado por la persona', v_me, v_c.debit_ledger_id);
  update public.coupons set status = 'cancelado', cancelled_at = now(), cancelled_by = v_me,
         cancel_reason = 'Cancelado por la persona', refund_ledger_id = v_led where id = v_c.id;
  update public.rewards set stock = stock + 1 where id = v_c.reward_id and stock is not null;
  return jsonb_build_object('ok', true, 'balance', private.balance_of(v_me), 'refunded', v_c.cost_pasos);
end $$;

-- ---------------------------------------------------------------------------
-- Historial
-- ---------------------------------------------------------------------------
create function public.my_ledger(p_limit int default 30, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  perform private.require_profile();
  return (
    select coalesce(jsonb_agg(t.j order by t.id desc), '[]'::jsonb)
    from (
      select l.id,
        jsonb_build_object('id', l.id, 'kind', l.kind, 'amount', l.amount, 'created_at', l.created_at,
          'reason', l.reason, 'reverses_id', l.reverses_id,
          'label', coalesce(
             (select ch.title from public.visits v join public.challenges ch on ch.id = v.challenge_id where v.id = l.ref_id and l.ref_type = 'visita'),
             (select ch.title from public.challenges ch where ch.id = l.ref_id and l.ref_type = 'desafio'),
             (select c.reward_title from public.coupons c where c.id = l.ref_id and l.ref_type = 'cupon'))) as j
      from public.pasos_ledger l
      where l.user_id = v_me and (p_before is null or l.id < p_before)
      order by l.id desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) t
  );
end $$;

create function public.my_steps(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_today date := private.today();
        v_n int := least(greatest(coalesce(p_days, 7), 1), 31);
begin
  perform private.require_profile();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('day', v_today - i, 'steps', private.visible_steps(v_me, v_today - i))
                              order by i desc), '[]'::jsonb)
    from generate_series(0, v_n - 1) i
  );
end $$;

-- ---------------------------------------------------------------------------
-- Modo prueba (solo si el CEO lo habilitó y el entorno NO es producción)
-- ---------------------------------------------------------------------------
create function public.test_add_pasos(p_claim_id uuid, p_amount int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  perform private.require_profile();
  if not private.test_allowed() then return private.reject('modo_prueba_inactivo'); end if;
  if p_amount not in (500, 2000, 5000) then return private.reject('monto_invalido'); end if;
  insert into public.wallets (user_id) values (v_me) on conflict do nothing;
  perform private.ledger_add(v_me, 'prueba', p_amount, 'prueba:' || v_me || ':' || p_claim_id,
                             'prueba', null, 'Movimiento de prueba', v_me);
  return jsonb_build_object('ok', true, 'balance', private.balance_of(v_me));
end $$;

create function public.test_add_steps(p_amount int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_today date := private.today(); v_cur int;
begin
  perform private.require_profile();
  if not private.test_allowed() then return private.reject('modo_prueba_inactivo'); end if;
  if p_amount is null or p_amount < 1 or p_amount > 20000 then return private.reject('monto_invalido'); end if;
  insert into public.step_days (user_id, day, steps, source)
  values (v_me, v_today, least(p_amount, 100000), 'prueba')
  on conflict (user_id, day, source) do update
    set steps = least(public.step_days.steps + p_amount, 100000), updated_at = now();
  select steps into v_cur from public.step_days where user_id = v_me and day = v_today and source = 'prueba';
  return jsonb_build_object('ok', true, 'today_steps', v_cur);
end $$;

-- Para probar a solas: muestra el código vigente del comercio (solo modo prueba)
create function public.test_peek_code(p_merchant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.branches; v_vc public.visit_codes;
begin
  perform private.require_profile();
  if not private.test_allowed() then return private.reject('modo_prueba_inactivo'); end if;
  select * into v_b from public.branches where merchant_id = p_merchant and status = 'activo' order by id limit 1;
  if not found then return private.reject('comercio_no_disponible'); end if;
  v_vc := private.ensure_code(v_b.id);
  return jsonb_build_object('ok', true, 'code', v_vc.code, 'branch', v_b.name);
end $$;

-- ---------------------------------------------------------------------------
-- Mis datos: exportación y eliminación
-- ---------------------------------------------------------------------------
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_p public.profiles;
begin
  v_p := private.require_profile();
  return jsonb_build_object(
    'exported_at', now(),
    'profile', jsonb_build_object('display_name', v_p.display_name, 'birth_date', v_p.birth_date,
                'created_at', v_p.created_at, 'status', v_p.status),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'version', version, 'accepted_at', accepted_at)
                  order by id), '[]') from public.consents where user_id = v_me),
    'balance', private.balance_of(v_me),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'amount', amount,
                  'created_at', created_at, 'reason', reason) order by id), '[]')
               from public.pasos_ledger where user_id = v_me),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object('at', v.created_at, 'challenge', ch.title,
                  'merchant', m.name, 'pasos', v.pasos, 'status', v.status) order by v.created_at), '[]')
               from public.visits v join public.challenges ch on ch.id = v.challenge_id
               join public.merchants m on m.id = v.merchant_id where v.user_id = v_me),
    'coupons', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'reward', reward_title,
                  'status', status, 'created_at', created_at, 'expires_at', expires_at) order by created_at), '[]')
                from public.coupons where user_id = v_me),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'steps', steps, 'source', source)
                  order by day), '[]') from public.step_days where user_id = v_me),
    'challenge_acceptances', (select coalesce(jsonb_agg(jsonb_build_object('challenge', ch.title, 'status', a.status,
                  'accepted_at', a.accepted_at, 'expires_at', a.expires_at) order by a.accepted_at), '[]')
                from public.challenge_acceptances a join public.challenges ch on ch.id = a.challenge_id
                where a.user_id = v_me)
  );
end $$;

-- Borra los datos personales. Los movimientos y visitas se conservan ANONIMIZADOS
-- (sin vínculo con la persona) por trazabilidad contable. El usuario de acceso se
-- elimina desde la Edge Function "delete-account" (necesita clave de servicio).
create function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); r record;
begin
  perform private.require_profile();
  -- cupones pendientes: se anulan y vuelve el stock (los PASOS se pierden junto con la cuenta)
  for r in select id, reward_id from public.coupons where user_id = v_me and status = 'pendiente' loop
    update public.coupons set status = 'cancelado', cancelled_at = now(), cancelled_by = v_me,
           cancel_reason = 'Cuenta eliminada' where id = r.id;
    update public.rewards set stock = stock + 1 where id = r.reward_id and stock is not null;
  end loop;
  update public.pasos_ledger set user_id = null where user_id = v_me;
  update public.visits set user_id = null where user_id = v_me;
  update public.coupons set user_id = null where user_id = v_me;
  delete from public.challenge_acceptances where user_id = v_me;
  delete from public.step_days where user_id = v_me;
  delete from public.visit_attempts where user_id = v_me;
  delete from public.consents where user_id = v_me;
  delete from public.wallets where user_id = v_me;
  delete from public.profiles where user_id = v_me;
  perform private.audit('cuenta_eliminada', 'persona', null, 'Una persona eliminó su cuenta');
  return jsonb_build_object('ok', true);
end $$;
