-- ============================================================================
-- ANDÁ · 0005 · Funciones del perfil CEO / EQUIPO
-- Cada función verifica en el servidor el rol y el permiso concreto.
-- Ocultar un botón en pantalla NO es seguridad: acá se decide.
-- Permisos del equipo: desafios.editar, desafios.aprobar, catalogo.gestionar,
-- fotos.gestionar, personas.ver, visitas.ver, cupones.ver, auditoria.ver.
-- Solo el CEO: equipo, control y seguridad, cobros, configuración, pausa,
-- alta de comercios y cuentas, anulaciones, ajustes de PASOS.
-- ============================================================================

create function private.actor_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_user is null then 'Sistema'
         else coalesce((select r.display_name from public.user_roles r where r.user_id = p_user
                         order by (r.role = 'ceo') desc limit 1), 'Usuario') end
$$;

create function private.challenge_json(c public.challenges) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'category', c.category, 'type', c.type,
    'merchant_id', c.merchant_id,
    'merchant_name', (select m.name from public.merchants m where m.id = c.merchant_id),
    'reward_pasos', c.reward_pasos, 'repeat_rule', c.repeat_rule, 'per_person_max', c.per_person_max,
    'quota_total', c.quota_total, 'goal_steps', c.goal_steps, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
    'status', c.status, 'state', private.challenge_state(c), 'photo_path', c.photo_path,
    'created_by_name', private.actor_name(c.created_by), 'approved_by_name', private.actor_name(c.approved_by),
    'created_by', c.created_by, 'self_approved', c.self_approved, 'version', c.version,
    'proposal_id', c.proposal_id, 'is_example', c.is_example,
    'created_at', c.created_at, 'updated_at', c.updated_at,
    'used', private.challenge_completions(c),
    'reserved', private.challenge_reserved(c),
    'slots_left', case when c.quota_total is null then null
                       else greatest(c.quota_total - private.challenge_completions(c) - private.challenge_reserved(c), 0) end)
$$;

create function private.reward_json(r public.rewards) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'merchant_id', r.merchant_id,
    'merchant_name', (select m.name from public.merchants m where m.id = r.merchant_id),
    'title', r.title, 'description', r.description, 'category', r.category, 'cost_pasos', r.cost_pasos,
    'stock', r.stock, 'unlimited', r.stock is null, 'per_person_max', r.per_person_max,
    'valid_days', r.valid_days, 'conditions', r.conditions, 'photo_path', r.photo_path,
    'status', r.status, 'version', r.version, 'is_example', r.is_example,
    'created_by_name', private.actor_name(r.created_by), 'approved_by_name', private.actor_name(r.approved_by),
    'issued', (select count(*) from public.coupons c where c.reward_id = r.id and c.status <> 'cancelado'),
    'created_at', r.created_at, 'updated_at', r.updated_at)
$$;

-- ---------------------------------------------------------------------------
-- Inicio
-- ---------------------------------------------------------------------------
create function public.admin_dashboard(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.user_roles;
  v_cfg public.app_config;
  v_today date := private.today();
  v_n int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz := now() - make_interval(days => v_n);
begin
  v_role := private.require_staff();
  select * into v_cfg from public.app_config;
  return jsonb_build_object(
    'people_total', (select count(*) from public.profiles),
    'people_active', (select count(*) from public.profiles where last_activity_at >= v_from),
    'merchants_active', (select count(*) from public.merchants where status = 'activo'),
    'branches_active', (select count(*) from public.branches b join public.merchants m on m.id = b.merchant_id
                         where b.status = 'activo' and m.status = 'activo'),
    'visits_period', (select count(*) from public.visits where status = 'valida' and created_at >= v_from),
    'pasos_credited', (select coalesce(sum(amount), 0) from public.pasos_ledger
                        where kind in ('visita','meta_pasos') and amount > 0 and created_at >= v_from),
    'pasos_spent', (select coalesce(-sum(amount), 0) from public.pasos_ledger
                     where kind = 'canje' and created_at >= v_from),
    'coupons_issued', (select count(*) from public.coupons where created_at >= v_from),
    'coupons_redeemed', (select count(*) from public.coupons where status = 'canjeado' and redeemed_at >= v_from),
    'alerts_open', case when v_role.role = 'ceo'
                     then (select count(*) from public.alerts where status in ('nueva','en_revision')) else null end,
    'billing_pending', case when v_role.role = 'ceo'
                     then (select coalesce(sum(total), 0) from private.billing_rows(null) where status = 'pendiente') else null end,
    'challenges_active', (select count(*) from public.challenges c where private.challenge_state(c) = 'activo'),
    'proposals_open', (select count(*) from public.proposals where status in ('enviada','en_revision','cambios_solicitados')),
    'challenges_review', (select count(*) from public.challenges where status = 'revision'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', v_today - i,
                 'visits', (select count(*) from public.visits v where v.status = 'valida' and v.day = v_today - i),
                 'pasos', (select coalesce(sum(l.amount), 0) from public.pasos_ledger l
                            where l.kind in ('visita','meta_pasos') and l.amount > 0
                              and private.local_day(l.created_at) = v_today - i))
                 order by i desc), '[]'::jsonb) from generate_series(0, 13) i),
    'paused', v_cfg.paused, 'pause_reason', v_cfg.pause_reason, 'paused_at', v_cfg.paused_at,
    'test_mode', v_cfg.test_mode and v_cfg.environment = 'prueba',
    'environment', v_cfg.environment,
    'role', v_role.role
  );
end $$;

-- ---------------------------------------------------------------------------
-- Personas (nunca se devuelve la fecha de nacimiento ni se pide DNI)
-- ---------------------------------------------------------------------------
create function public.admin_list_people(p_search text default null, p_status text default null,
                                         p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm('personas.ver');
  return (
    select coalesce(jsonb_agg(t.j order by t.created_at desc), '[]'::jsonb)
    from (
      select p.created_at, jsonb_build_object('id', p.user_id, 'display_name', p.display_name,
        'status', p.status, 'balance', private.balance_of(p.user_id),
        'visits', (select count(*) from public.visits v where v.user_id = p.user_id and v.status = 'valida'),
        'coupons', (select count(*) from public.coupons c where c.user_id = p.user_id),
        'created_at', p.created_at, 'last_activity_at', p.last_activity_at, 'age_verified', true) as j
      from public.profiles p
      where (p_status is null or p.status = p_status)
        and (p_search is null or p_search = '' or p.display_name ilike '%' || p_search || '%'
             or p.user_id::text like p_search || '%')
      order by p.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) t
  );
end $$;

create function public.admin_person_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_p public.profiles;
begin
  perform private.require_perm('personas.ver');
  select * into v_p from public.profiles where user_id = p_user;
  if not found then return private.reject('persona_no_encontrada'); end if;
  return jsonb_build_object('ok', true,
    'person', jsonb_build_object('id', v_p.user_id, 'display_name', v_p.display_name, 'status', v_p.status,
        'status_reason', v_p.status_reason, 'created_at', v_p.created_at,
        'last_activity_at', v_p.last_activity_at, 'age_verified', true,
        'terms_version', v_p.terms_version, 'balance', private.balance_of(p_user)),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'amount', l.amount,
                  'created_at', l.created_at, 'reason', l.reason, 'reverses_id', l.reverses_id) order by l.id desc), '[]')
               from (select * from public.pasos_ledger where user_id = p_user order by id desc limit 50) l),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'at', v.created_at, 'challenge', ch.title,
                  'merchant', m.name, 'pasos', v.pasos, 'status', v.status) order by v.created_at desc), '[]')
               from (select * from public.visits where user_id = p_user order by created_at desc limit 30) v
               join public.challenges ch on ch.id = v.challenge_id join public.merchants m on m.id = v.merchant_id),
    'coupons', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'reward', c.reward_title,
                  'status', case when c.status = 'pendiente' and c.expires_at <= now() then 'vencido' else c.status end,
                  'created_at', c.created_at) order by c.created_at desc), '[]')
                from public.coupons c where c.user_id = p_user));
end $$;

create function public.admin_set_person_status(p_user uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  if p_status not in ('activo','suspendido') then return private.reject('estado_invalido'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return private.reject('motivo_requerido'); end if;
  update public.profiles set status = p_status, status_reason = btrim(p_reason) where user_id = p_user;
  if not found then return private.reject('persona_no_encontrada'); end if;
  perform private.audit('persona_' || p_status, 'persona', p_user::text,
    case when p_status = 'suspendido' then 'Suspendió una persona' else 'Reactivó una persona' end,
    jsonb_build_object('motivo', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Comercios y locales (alta solo del CEO)
-- ---------------------------------------------------------------------------
create function public.admin_list_merchants() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_roles;
begin
  v_role := private.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'category', m.category, 'description', m.description,
      'neighborhood', m.neighborhood, 'photo_path', m.photo_path, 'status', m.status,
      'status_reason', m.status_reason, 'is_example', m.is_example,
      'fee_per_visit', case when v_role.role = 'ceo' then m.fee_per_visit else null end,
      'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address,
                     'lat', b.lat, 'lng', b.lng, 'radius_m', b.radius_m, 'status', b.status) order by b.name), '[]')
                   from public.branches b where b.merchant_id = m.id),
      'accounts', case when v_role.role = 'ceo'
        then (select count(*) from public.user_roles r where r.merchant_id = m.id and r.active) else null end,
      'visits', (select count(*) from public.visits v where v.merchant_id = m.id and v.status = 'valida')
    ) order by m.name), '[]'::jsonb)
    from public.merchants m
  );
end $$;

create function public.admin_save_merchant(p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_data ->> 'name', ''));
  v_fee numeric;
  v_id uuid := p_id;
  v_branch jsonb := p_data -> 'branch';
  v_branch_id uuid;
  v_old public.merchants;
begin
  perform private.require_ceo();
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'name');
  end if;
  begin
    v_fee := nullif(p_data ->> 'fee_per_visit', '')::numeric;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'fee_per_visit');
  end;
  if v_fee is not null and v_fee < 0 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'fee_per_visit');
  end if;

  if p_id is null then
    insert into public.merchants (name, category, description, neighborhood, fee_per_visit, created_by)
    values (v_name, coalesce(nullif(btrim(p_data ->> 'category'), ''), 'otros'),
            nullif(btrim(p_data ->> 'description'), ''), nullif(btrim(p_data ->> 'neighborhood'), ''),
            v_fee, auth.uid())
    returning id into v_id;
    if v_branch is not null and char_length(btrim(coalesce(v_branch ->> 'name', ''))) >= 2 then
      insert into public.branches (merchant_id, name, address, lat, lng, radius_m)
      values (v_id, btrim(v_branch ->> 'name'), nullif(btrim(v_branch ->> 'address'), ''),
              nullif(v_branch ->> 'lat', '')::double precision, nullif(v_branch ->> 'lng', '')::double precision,
              coalesce(nullif(v_branch ->> 'radius_m', '')::int, 80))
      returning id into v_branch_id;
    end if;
    perform private.audit('comercio_creado', 'comercio', v_id::text, 'Creó el comercio ' || v_name);
  else
    select * into v_old from public.merchants where id = p_id;
    if not found then return private.reject('comercio_no_encontrado'); end if;
    update public.merchants set name = v_name,
      category = coalesce(nullif(btrim(p_data ->> 'category'), ''), category),
      description = nullif(btrim(p_data ->> 'description'), ''),
      neighborhood = nullif(btrim(p_data ->> 'neighborhood'), ''),
      fee_per_visit = v_fee, updated_at = now()
    where id = p_id;
    perform private.audit('comercio_editado', 'comercio', p_id::text, 'Editó el comercio ' || v_name,
      jsonb_build_object('tarifa_anterior', v_old.fee_per_visit, 'tarifa_nueva', v_fee));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'branch_id', v_branch_id);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  return jsonb_build_object('ok', false, 'reason', 'campo_invalido');
end $$;

create function public.admin_save_branch(p_id uuid, p_merchant uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_data ->> 'name', ''));
  v_id uuid := p_id;
begin
  perform private.require_ceo();
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'name');
  end if;
  if p_id is null then
    if not exists (select 1 from public.merchants where id = p_merchant) then
      return private.reject('comercio_no_encontrado');
    end if;
    insert into public.branches (merchant_id, name, address, lat, lng, radius_m, status)
    values (p_merchant, v_name, nullif(btrim(p_data ->> 'address'), ''),
            nullif(p_data ->> 'lat', '')::double precision, nullif(p_data ->> 'lng', '')::double precision,
            coalesce(nullif(p_data ->> 'radius_m', '')::int, 80), coalesce(p_data ->> 'status', 'activo'))
    returning id into v_id;
  else
    update public.branches set name = v_name, address = nullif(btrim(p_data ->> 'address'), ''),
      lat = nullif(p_data ->> 'lat', '')::double precision, lng = nullif(p_data ->> 'lng', '')::double precision,
      radius_m = coalesce(nullif(p_data ->> 'radius_m', '')::int, radius_m),
      status = coalesce(p_data ->> 'status', status)
    where id = p_id;
    if not found then return private.reject('local_no_encontrado'); end if;
  end if;
  perform private.audit('local_guardado', 'local', v_id::text, 'Guardó el local ' || v_name);
  return jsonb_build_object('ok', true, 'id', v_id);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  return jsonb_build_object('ok', false, 'reason', 'campo_invalido');
end $$;

create function public.admin_set_merchant_status(p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  if p_status not in ('activo','suspendido') then return private.reject('estado_invalido'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return private.reject('motivo_requerido'); end if;
  update public.merchants set status = p_status, status_reason = btrim(p_reason), updated_at = now() where id = p_id;
  if not found then return private.reject('comercio_no_encontrado'); end if;
  perform private.audit('comercio_' || p_status, 'comercio', p_id::text,
    case when p_status = 'suspendido' then 'Suspendió un comercio' else 'Reactivó un comercio' end,
    jsonb_build_object('motivo', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Desafíos: edición y ciclo de estados
-- Borrador -> Revisión -> Programado -> Activo -> Pausado -> Finalizado
-- ---------------------------------------------------------------------------
create function public.admin_list_challenges(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_roles;
begin
  v_role := private.require_staff();
  if not (v_role.role = 'ceo' or 'desafios.editar' = any (v_role.perms) or 'desafios.aprobar' = any (v_role.perms)) then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;
  return (
    select coalesce(jsonb_agg(private.challenge_json(c) order by c.created_at desc), '[]'::jsonb)
    from public.challenges c
    where p_status is null or private.challenge_state(c) = p_status
  );
end $$;

create function public.admin_save_challenge(p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_roles;
  v_old public.challenges;
  v_id uuid := p_id;
  v_title text; v_desc text; v_cat text; v_type text; v_merchant uuid; v_reward int;
  v_repeat text; v_ppm int; v_quota int; v_goal int; v_start timestamptz; v_end timestamptz; v_photo text;
begin
  v_role := private.require_perm('desafios.editar');
  begin
    v_title := btrim(coalesce(p_data ->> 'title', ''));
    v_desc := nullif(btrim(p_data ->> 'description'), '');
    v_cat := coalesce(nullif(btrim(p_data ->> 'category'), ''), 'visitas');
    v_type := p_data ->> 'type';
    v_merchant := nullif(p_data ->> 'merchant_id', '')::uuid;
    v_reward := (p_data ->> 'reward_pasos')::int;
    v_repeat := coalesce(p_data ->> 'repeat_rule', 'una_vez');
    v_ppm := nullif(p_data ->> 'per_person_max', '')::int;
    v_quota := nullif(p_data ->> 'quota_total', '')::int;
    v_goal := nullif(p_data ->> 'goal_steps', '')::int;
    v_start := nullif(p_data ->> 'starts_at', '')::timestamptz;
    v_end := nullif(p_data ->> 'ends_at', '')::timestamptz;
    v_photo := nullif(p_data ->> 'photo_path', '');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'formato');
  end;
  if char_length(v_title) < 3 or char_length(v_title) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'title');
  end if;
  if v_type not in ('visita', 'meta_pasos') then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'type');
  end if;
  if v_repeat not in ('una_vez', 'diaria') then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'repeat_rule');
  end if;
  if v_reward is null or v_reward < 1 or v_reward > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'reward_pasos');
  end if;
  if v_type = 'visita' and (v_merchant is null or not exists (select 1 from public.merchants where id = v_merchant)) then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'merchant_id');
  end if;
  if v_type = 'meta_pasos' then
    v_merchant := null;
    if v_goal is null or v_goal < 1000 or v_goal > 100000 then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'goal_steps');
    end if;
  else
    v_goal := null;
  end if;
  if v_ppm is not null and v_ppm < 1 then return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'per_person_max'); end if;
  if v_quota is not null and v_quota < 1 then return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'quota_total'); end if;
  if v_start is not null and v_end is not null and v_end <= v_start then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'ends_at');
  end if;
  perform private.assert_photo_path(v_photo);

  if p_id is null then
    insert into public.challenges (title, description, category, type, merchant_id, reward_pasos, repeat_rule,
        per_person_max, quota_total, goal_steps, starts_at, ends_at, photo_path, created_by)
    values (v_title, v_desc, v_cat, v_type, v_merchant, v_reward, v_repeat, v_ppm, v_quota, v_goal,
            v_start, v_end, v_photo, auth.uid())
    returning id into v_id;
    perform private.audit('desafio_creado', 'desafio', v_id::text, 'Creó el desafío ' || v_title);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  select * into v_old from public.challenges where id = p_id for update;
  if not found then return private.reject('desafio_no_encontrado'); end if;

  if v_old.status = 'borrador' then
    update public.challenges set title = v_title, description = v_desc, category = v_cat, type = v_type,
      merchant_id = v_merchant, reward_pasos = v_reward, repeat_rule = v_repeat, per_person_max = v_ppm,
      quota_total = v_quota, goal_steps = v_goal, starts_at = v_start, ends_at = v_end, photo_path = v_photo
    where id = p_id;
  elsif v_old.status in ('programado', 'activo', 'pausado') then
    -- Cambios sustanciales (recompensa, límites, comercio, fechas) no se aplican retroactivamente:
    -- hay que finalizar el desafío y crear uno nuevo.
    if (v_type, v_merchant, v_reward, v_repeat, v_ppm, v_quota, v_goal, v_start, v_end)
       is distinct from (v_old.type, v_old.merchant_id, v_old.reward_pasos, v_old.repeat_rule,
                         v_old.per_person_max, v_old.quota_total, v_old.goal_steps, v_old.starts_at, v_old.ends_at) then
      return private.reject('cambio_no_permitido');
    end if;
    update public.challenges set title = v_title, description = v_desc, category = v_cat, photo_path = v_photo
    where id = p_id;
  else
    return private.reject('desafio_no_editable');
  end if;
  perform private.audit('desafio_editado', 'desafio', p_id::text, 'Editó el desafío ' || v_title);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create function public.admin_challenge_transition(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_roles;
  v_c public.challenges;
  v_to text;
  v_need text;
  v_self boolean := false;
  v_me uuid := auth.uid();
begin
  v_role := private.require_staff();
  select * into v_c from public.challenges where id = p_id for update;
  if not found then return private.reject('desafio_no_encontrado'); end if;

  -- (acción, estado de origen) -> (estado destino, permiso)
  if p_action = 'enviar_revision' and v_c.status = 'borrador' then v_to := 'revision'; v_need := 'desafios.editar';
  elsif p_action = 'solicitar_cambios' and v_c.status = 'revision' then v_to := 'borrador'; v_need := 'desafios.aprobar';
  elsif p_action = 'aprobar' and v_c.status = 'revision' then v_to := 'programado'; v_need := 'desafios.aprobar';
  elsif p_action = 'activar' and v_c.status = 'programado' then v_to := 'activo'; v_need := 'desafios.aprobar';
  elsif p_action = 'pausar' and v_c.status in ('programado', 'activo') then v_to := 'pausado'; v_need := 'desafios.aprobar';
  elsif p_action = 'reanudar' and v_c.status = 'pausado' then v_to := 'activo'; v_need := 'desafios.aprobar';
  elsif p_action = 'finalizar' and v_c.status in ('borrador', 'revision', 'programado', 'activo', 'pausado')
    then v_to := 'finalizado'; v_need := 'desafios.aprobar';
  else
    return private.reject('transicion_invalida');
  end if;
  if not (v_role.role = 'ceo' or v_need = any (v_role.perms)) then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;

  if p_action = 'solicitar_cambios' and char_length(btrim(coalesce(p_note, ''))) < 3 then
    return private.reject('motivo_requerido');
  end if;

  if p_action in ('aprobar', 'activar', 'reanudar') then
    if v_c.ends_at is not null and v_c.ends_at <= now() then return private.reject('fechas_vencidas'); end if;
    if v_c.type = 'visita' and not exists (
         select 1 from public.merchants where id = v_c.merchant_id and status = 'activo') then
      return private.reject('comercio_no_disponible');
    end if;
  end if;

  -- Separación de funciones: quien creó o envió el desafío no lo aprueba ni lo activa.
  if p_action in ('aprobar', 'activar') and (v_me = v_c.created_by or v_me = v_c.submitted_by) then
    if v_role.role <> 'ceo' then return private.reject('separacion_de_funciones'); end if;
    v_self := true;  -- el CEO puede, pero queda marcado y auditado
  end if;

  update public.challenges set status = v_to,
    submitted_by = case when p_action = 'enviar_revision' then v_me else submitted_by end,
    approved_by = case when p_action = 'aprobar' then v_me else approved_by end,
    self_approved = case when p_action = 'aprobar' then v_self else self_approved end
  where id = p_id;

  perform private.audit('desafio_' || p_action, 'desafio', p_id::text,
    'Desafío "' || v_c.title || '": ' || replace(p_action, '_', ' '),
    jsonb_build_object('de', v_c.status, 'a', v_to, 'nota', p_note, 'autoaprobado', v_self));
  return jsonb_build_object('ok', true, 'status', v_to, 'self_approved', v_self);
end $$;

create function public.admin_challenge_versions(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_roles;
begin
  v_role := private.require_staff();
  if not (v_role.role = 'ceo' or 'desafios.editar' = any (v_role.perms) or 'desafios.aprobar' = any (v_role.perms)) then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'ts', v.ts,
            'by', private.actor_name(v.actor), 'snapshot', v.snapshot - 'created_by' - 'approved_by' - 'submitted_by')
            order by v.version desc), '[]'::jsonb)
          from public.row_versions v where v.table_name = 'challenges' and v.row_id = p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Propuestas de comercios
-- ---------------------------------------------------------------------------
create function public.admin_list_proposals(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_roles;
begin
  v_role := private.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'payload', p.payload,
        'status', p.status, 'review_note', p.review_note, 'merchant_id', p.merchant_id,
        'merchant_name', m.name, 'created_at', p.created_at, 'reviewed_by_name', private.actor_name(p.reviewed_by))
        order by p.created_at desc), '[]'::jsonb)
    from public.proposals p join public.merchants m on m.id = p.merchant_id
    where (p_status is null or p.status = p_status)
      and (v_role.role = 'ceo'
           or (p.kind = 'campana' and ('desafios.editar' = any (v_role.perms) or 'desafios.aprobar' = any (v_role.perms)))
           or (p.kind = 'premio' and 'catalogo.gestionar' = any (v_role.perms)))
  );
end $$;

create function public.admin_review_proposal(p_id uuid, p_action text, p_note text default null,
                                             p_overrides jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_roles;
  v_p public.proposals;
  v_need text;
  v_pay jsonb;
  v_new uuid;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_role := private.require_staff();
  select * into v_p from public.proposals where id = p_id for update;
  if not found then return private.reject('propuesta_no_encontrada'); end if;
  if v_p.status in ('aprobada', 'rechazada') then return private.reject('propuesta_cerrada'); end if;

  v_need := case when v_p.kind = 'campana' then 'desafios.aprobar' else 'catalogo.gestionar' end;
  if not (v_role.role = 'ceo' or v_need = any (v_role.perms)) then
    raise exception 'sin_permiso' using errcode = 'PT403';
  end if;

  if p_action = 'tomar' then
    update public.proposals set status = 'en_revision', reviewed_by = auth.uid(), updated_at = now() where id = p_id;
  elsif p_action in ('solicitar_cambios', 'rechazar') then
    if char_length(v_note) < 3 then return private.reject('motivo_requerido'); end if;
    update public.proposals set status = case when p_action = 'rechazar' then 'rechazada' else 'cambios_solicitados' end,
      review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'aprobar' then
    if not exists (select 1 from public.merchants where id = v_p.merchant_id and status = 'activo') then
      return private.reject('comercio_no_disponible');
    end if;
    v_pay := v_p.payload || coalesce(p_overrides, '{}'::jsonb);
    if v_p.kind = 'campana' then
      insert into public.challenges (title, description, category, type, merchant_id, reward_pasos, repeat_rule,
          quota_total, starts_at, ends_at, status, proposal_id, created_by, approved_by)
      values (v_pay ->> 'title', nullif(v_pay ->> 'description', ''), 'visitas', 'visita', v_p.merchant_id,
              (v_pay ->> 'reward_pasos')::int, coalesce(v_pay ->> 'repeat_rule', 'una_vez'),
              nullif(v_pay ->> 'quota_total', '')::int, nullif(v_pay ->> 'starts_at', '')::timestamptz,
              nullif(v_pay ->> 'ends_at', '')::timestamptz, 'programado', p_id, v_p.created_by, auth.uid())
      returning id into v_new;
      update public.proposals set status = 'aprobada', review_note = nullif(v_note, ''), reviewed_by = auth.uid(),
        reviewed_at = now(), updated_at = now(), result_challenge_id = v_new where id = p_id;
    else
      insert into public.rewards (merchant_id, title, description, cost_pasos, stock, valid_days, conditions,
          status, proposal_id, created_by, approved_by)
      values (v_p.merchant_id, v_pay ->> 'title', nullif(v_pay ->> 'description', ''), (v_pay ->> 'cost_pasos')::int,
              nullif(v_pay ->> 'stock', '')::int, coalesce((v_pay ->> 'valid_days')::int, 30),
              nullif(v_pay ->> 'conditions', ''), 'activo', p_id, v_p.created_by, auth.uid())
      returning id into v_new;
      insert into public.reward_price_history (reward_id, old_cost, new_cost, changed_by)
      values (v_new, null, (v_pay ->> 'cost_pasos')::int, auth.uid());
      update public.proposals set status = 'aprobada', review_note = nullif(v_note, ''), reviewed_by = auth.uid(),
        reviewed_at = now(), updated_at = now(), result_reward_id = v_new where id = p_id;
    end if;
  else
    return private.reject('accion_invalida');
  end if;

  perform private.audit('propuesta_' || p_action, 'propuesta', p_id::text,
    'Propuesta de ' || case when v_p.kind = 'campana' then 'campaña' else 'premio' end || ': ' || replace(p_action, '_', ' '),
    jsonb_build_object('nota', nullif(v_note, ''), 'resultado', v_new));
  return jsonb_build_object('ok', true, 'result_id', v_new);
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  return jsonb_build_object('ok', false, 'reason', 'campo_invalido');
end $$;

-- ---------------------------------------------------------------------------
-- Premios y catálogo
-- ---------------------------------------------------------------------------
create function public.admin_list_rewards() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return (select coalesce(jsonb_agg(private.reward_json(r) order by r.created_at desc), '[]'::jsonb)
          from public.rewards r);
end $$;

create function public.admin_save_reward(p_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.rewards;
  v_id uuid := p_id;
  v_merchant uuid; v_title text; v_desc text; v_cat text; v_cost int; v_stock int; v_ppm int;
  v_days int; v_cond text; v_photo text; v_status text; v_has_stock boolean;
begin
  perform private.require_perm('catalogo.gestionar');
  begin
    v_merchant := (p_data ->> 'merchant_id')::uuid;
    v_title := btrim(coalesce(p_data ->> 'title', ''));
    v_desc := nullif(btrim(p_data ->> 'description'), '');
    v_cat := coalesce(nullif(btrim(p_data ->> 'category'), ''), 'otros');
    v_cost := (p_data ->> 'cost_pasos')::int;
    v_has_stock := p_data ? 'stock';
    v_stock := nullif(p_data ->> 'stock', '')::int;      -- null = ilimitado
    v_ppm := nullif(p_data ->> 'per_person_max', '')::int;
    v_days := coalesce(nullif(p_data ->> 'valid_days', '')::int, 30);
    v_cond := nullif(btrim(p_data ->> 'conditions'), '');
    v_photo := nullif(p_data ->> 'photo_path', '');
    v_status := coalesce(p_data ->> 'status', 'borrador');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'formato');
  end;
  if char_length(v_title) < 3 or char_length(v_title) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'title');
  end if;
  if v_cost is null or v_cost < 1 or v_cost > 10000000 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'cost_pasos');
  end if;
  if v_stock is not null and v_stock < 0 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'stock');
  end if;
  if v_ppm is not null and v_ppm < 1 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'per_person_max');
  end if;
  if v_days < 1 or v_days > 365 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'valid_days');
  end if;
  if v_status not in ('borrador', 'activo', 'pausado') then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'status');
  end if;
  if not exists (select 1 from public.merchants where id = v_merchant) then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'merchant_id');
  end if;
  perform private.assert_photo_path(v_photo);

  if p_id is null then
    insert into public.rewards (merchant_id, title, description, category, cost_pasos, stock, per_person_max,
        valid_days, conditions, photo_path, status, created_by, approved_by)
    values (v_merchant, v_title, v_desc, v_cat, v_cost, v_stock, v_ppm, v_days, v_cond, v_photo, v_status,
            auth.uid(), case when v_status = 'activo' then auth.uid() end)
    returning id into v_id;
    insert into public.reward_price_history (reward_id, old_cost, new_cost, changed_by)
    values (v_id, null, v_cost, auth.uid());
    perform private.audit('premio_creado', 'premio', v_id::text, 'Creó el premio ' || v_title,
      jsonb_build_object('costo', v_cost, 'stock', v_stock));
  else
    select * into v_old from public.rewards where id = p_id for update;
    if not found then return private.reject('premio_no_encontrado'); end if;
    update public.rewards set merchant_id = v_merchant, title = v_title, description = v_desc, category = v_cat,
      cost_pasos = v_cost, stock = case when v_has_stock then v_stock else stock end, per_person_max = v_ppm,
      valid_days = v_days, conditions = v_cond, photo_path = v_photo, status = v_status,
      approved_by = case when v_status = 'activo' and v_old.status <> 'activo' then auth.uid() else approved_by end
    where id = p_id;
    if v_old.cost_pasos <> v_cost then
      insert into public.reward_price_history (reward_id, old_cost, new_cost, changed_by)
      values (p_id, v_old.cost_pasos, v_cost, auth.uid());
    end if;
    perform private.audit('premio_editado', 'premio', p_id::text, 'Editó el premio ' || v_title,
      jsonb_build_object('costo_anterior', v_old.cost_pasos, 'costo_nuevo', v_cost,
                         'stock_anterior', v_old.stock, 'stock_nuevo', case when v_has_stock then v_stock else v_old.stock end,
                         'estado_anterior', v_old.status, 'estado_nuevo', v_status));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function public.admin_reward_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return jsonb_build_object(
    'prices', (select coalesce(jsonb_agg(jsonb_build_object('old_cost', h.old_cost, 'new_cost', h.new_cost,
                 'changed_at', h.changed_at, 'by', private.actor_name(h.changed_by)) order by h.id desc), '[]')
               from public.reward_price_history h where h.reward_id = p_id),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'ts', v.ts,
                 'by', private.actor_name(v.actor)) order by v.version desc), '[]')
                 from public.row_versions v where v.table_name = 'rewards' and v.row_id = p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Visitas y libro de PASOS
-- ---------------------------------------------------------------------------
create function public.admin_list_visits(p_status text default null, p_merchant uuid default null,
                                         p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_names boolean;
begin
  perform private.require_perm('visitas.ver');
  v_names := private.has_perm('personas.ver');
  return (
    select coalesce(jsonb_agg(t.j order by t.ts desc), '[]'::jsonb)
    from (
      select v.created_at as ts, jsonb_build_object('id', v.id, 'at', v.created_at, 'status', v.status,
        'pasos', v.pasos, 'fee_ars', v.fee_ars, 'challenge', ch.title, 'merchant', m.name, 'branch', b.name,
        'person_id', v.user_id,
        'person_name', case when v_names then (select p.display_name from public.profiles p where p.user_id = v.user_id) end,
        'gps_verified', v.gps_verified, 'void_reason', v.void_reason) as j
      from public.visits v
      join public.challenges ch on ch.id = v.challenge_id
      join public.merchants m on m.id = v.merchant_id
      left join public.branches b on b.id = v.branch_id
      where (p_status is null or v.status = p_status) and (p_merchant is null or v.merchant_id = p_merchant)
      order by v.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) t
  );
end $$;

-- Anular una visita: queda el registro original + movimiento compensatorio + ajuste de cobro
create function public.admin_void_visit(p_visit_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_v public.visits;
  v_led bigint;
  v_adj_period date;
begin
  perform private.require_ceo();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then return private.reject('motivo_requerido'); end if;

  select * into v_v from public.visits where id = p_visit_id for update;
  if not found then return private.reject('visita_no_encontrada'); end if;
  if v_v.status = 'anulada' then return private.reject('visita_ya_anulada'); end if;
  if v_v.user_id is not null then
    insert into public.wallets (user_id) values (v_v.user_id) on conflict do nothing;
    perform 1 from public.wallets where user_id = v_v.user_id for update;
  end if;

  v_led := private.ledger_add(v_v.user_id, 'reversion', -v_v.pasos, 'reversion:' || v_v.ledger_id,
                              'visita', v_v.id, btrim(p_reason), auth.uid(), v_v.ledger_id);
  update public.visits set status = 'anulada', void_reason = btrim(p_reason), voided_by = auth.uid(),
         voided_at = now(), reverse_ledger_id = v_led where id = p_visit_id;

  -- Si el mes de esa visita ya está facturado/pagado, el descuento va como ajuste en el primer período abierto
  if exists (select 1 from public.billing_periods
             where merchant_id = v_v.merchant_id and period = date_trunc('month', v_v.day)::date
               and status <> 'pendiente') then
    v_adj_period := private.open_period(v_v.merchant_id);
    insert into public.billing_adjustments (merchant_id, period, amount_ars, reason, visit_id, created_by)
    values (v_v.merchant_id, v_adj_period, -v_v.fee_ars,
            'Anulación de visita ' || v_v.id || ' de un período ya facturado', v_v.id, auth.uid());
  end if;

  perform private.audit('visita_anulada', 'visita', p_visit_id::text, 'Anuló una visita',
    jsonb_build_object('motivo', btrim(p_reason), 'pasos', v_v.pasos, 'ajuste_cobro', v_adj_period is not null));
  return jsonb_build_object('ok', true, 'adjusted_period', v_adj_period);
end $$;

create function public.admin_ledger(p_user uuid default null, p_limit int default 50, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_names boolean;
begin
  perform private.require_perm('visitas.ver');
  v_names := private.has_perm('personas.ver');
  return (
    select coalesce(jsonb_agg(t.j order by t.id desc), '[]'::jsonb)
    from (
      select l.id, jsonb_build_object('id', l.id, 'kind', l.kind, 'amount', l.amount, 'created_at', l.created_at,
        'reason', l.reason, 'reverses_id', l.reverses_id, 'person_id', l.user_id, 'source', l.source,
        'actor_name', private.actor_name(l.actor),
        'person_name', case when v_names then (select p.display_name from public.profiles p where p.user_id = l.user_id) end) as j
      from public.pasos_ledger l
      where (p_user is null or l.user_id = p_user) and (p_before is null or l.id < p_before)
      order by l.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) t
  );
end $$;

-- Ajuste excepcional: siempre un movimiento NUEVO con motivo (el saldo no se edita)
create function public.admin_adjust_pasos(p_user uuid, p_amount int, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_led bigint;
begin
  perform private.require_ceo();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then return private.reject('monto_invalido'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then return private.reject('motivo_requerido'); end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then
    return private.reject('persona_no_encontrada');
  end if;
  insert into public.wallets (user_id) values (p_user) on conflict do nothing;
  perform 1 from public.wallets where user_id = p_user for update;
  v_led := private.ledger_add(p_user, 'ajuste', p_amount, 'ajuste:' || gen_random_uuid(),
                              'ajuste', null, btrim(p_reason), auth.uid());
  perform private.audit('pasos_ajuste', 'persona', p_user::text, 'Ajuste excepcional de PASOS',
    jsonb_build_object('monto', p_amount, 'motivo', btrim(p_reason), 'movimiento', v_led));
  return jsonb_build_object('ok', true, 'ledger_id', v_led, 'balance', private.balance_of(p_user));
end $$;

-- ---------------------------------------------------------------------------
-- Cupones
-- ---------------------------------------------------------------------------
create function public.admin_list_coupons(p_status text default null, p_search text default null,
                                          p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_names boolean;
begin
  perform private.require_perm('cupones.ver');
  v_names := private.has_perm('personas.ver');
  return (
    select coalesce(jsonb_agg(t.j order by t.ts desc), '[]'::jsonb)
    from (
      select c.created_at as ts, jsonb_build_object('id', c.id, 'code', c.code, 'reward_title', c.reward_title,
        'merchant', m.name, 'cost_pasos', c.cost_pasos,
        'status', case when c.status = 'pendiente' and c.expires_at <= now() then 'vencido' else c.status end,
        'created_at', c.created_at, 'expires_at', c.expires_at, 'redeemed_at', c.redeemed_at,
        'cancel_reason', c.cancel_reason, 'person_id', c.user_id,
        'person_name', case when v_names then (select p.display_name from public.profiles p where p.user_id = c.user_id) end) as j
      from public.coupons c join public.merchants m on m.id = c.merchant_id
      where (p_status is null
             or (p_status = 'vencido' and c.status = 'pendiente' and c.expires_at <= now())
             or (p_status = 'pendiente' and c.status = 'pendiente' and c.expires_at > now())
             or (p_status not in ('vencido', 'pendiente') and c.status = p_status))
        and (p_search is null or p_search = '' or c.code ilike '%' || p_search || '%' or c.reward_title ilike '%' || p_search || '%')
      order by c.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) t
  );
end $$;

create function public.admin_cancel_coupon(p_id uuid, p_reason text, p_refund boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.coupons; v_led bigint;
begin
  perform private.require_ceo();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then return private.reject('motivo_requerido'); end if;
  select * into v_c from public.coupons where id = p_id;
  if not found then return private.reject('cupon_no_encontrado'); end if;
  if v_c.user_id is not null then
    insert into public.wallets (user_id) values (v_c.user_id) on conflict do nothing;
    perform 1 from public.wallets where user_id = v_c.user_id for update;
  end if;
  select * into v_c from public.coupons where id = p_id for update;
  if v_c.status = 'canjeado' then return private.reject('cupon_ya_utilizado'); end if;
  if v_c.status in ('cancelado', 'anulado') then return private.reject('cupon_no_cancelable'); end if;

  if coalesce(p_refund, true) and v_c.user_id is not null then
    v_led := private.ledger_add(v_c.user_id, 'devolucion', v_c.cost_pasos, 'devolucion:' || v_c.id,
                                'cupon', v_c.id, btrim(p_reason), auth.uid(), v_c.debit_ledger_id);
  end if;
  update public.coupons set status = 'anulado', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = btrim(p_reason), refund_ledger_id = v_led where id = p_id;
  update public.rewards set stock = stock + 1 where id = v_c.reward_id and stock is not null;
  perform private.audit('cupon_anulado', 'cupon', p_id::text, 'Anuló el cupón ' || v_c.code,
    jsonb_build_object('motivo', btrim(p_reason), 'devolvio_pasos', v_led is not null));
  return jsonb_build_object('ok', true, 'refunded', v_led is not null);
end $$;

-- ---------------------------------------------------------------------------
-- Cobros a comercios (solo CEO)
-- ---------------------------------------------------------------------------
create function public.admin_billing(p_period date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('merchant_id', b.merchant_id, 'merchant_name', m.name,
      'period', b.period, 'visits', b.visits, 'visits_amount', b.visits_amount, 'adjustments', b.adjustments,
      'total', b.total, 'status', b.status, 'invoice_ref', b.invoice_ref, 'frozen', b.frozen)
      order by b.period desc, m.name), '[]'::jsonb)
    from private.billing_rows(null) b join public.merchants m on m.id = b.merchant_id
    where p_period is null or b.period = date_trunc('month', p_period)::date
  );
end $$;

create function public.admin_set_billing_status(p_merchant uuid, p_period date, p_status text,
                                                p_invoice_ref text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_per date := date_trunc('month', p_period)::date;
  v_cur text;
  v_row record;
begin
  perform private.require_ceo();
  select coalesce((select status from public.billing_periods where merchant_id = p_merchant and period = v_per), 'pendiente')
    into v_cur;
  if not ((v_cur = 'pendiente' and p_status = 'facturado') or (v_cur = 'facturado' and p_status = 'pagado')) then
    return private.reject('transicion_invalida');
  end if;
  if v_per >= date_trunc('month', private.today())::date and p_status = 'facturado' then
    return private.reject('periodo_en_curso');   -- no se factura un mes que todavía no cerró
  end if;
  select * into v_row from private.billing_rows(p_merchant) where period = v_per;

  insert into public.billing_periods (merchant_id, period, status, invoice_ref, frozen_visits, frozen_amount,
                                      updated_by, updated_at)
  values (p_merchant, v_per, p_status, nullif(btrim(p_invoice_ref), ''),
          case when p_status = 'facturado' then coalesce(v_row.visits, 0) end,
          case when p_status = 'facturado' then coalesce(v_row.visits_amount, 0) end, auth.uid(), now())
  on conflict (merchant_id, period) do update
    set status = excluded.status,
        invoice_ref = coalesce(excluded.invoice_ref, public.billing_periods.invoice_ref),
        frozen_visits = coalesce(public.billing_periods.frozen_visits, excluded.frozen_visits),
        frozen_amount = coalesce(public.billing_periods.frozen_amount, excluded.frozen_amount),
        updated_by = auth.uid(), updated_at = now();
  perform private.audit('cobro_' || p_status, 'cobro', p_merchant::text || ':' || v_per::text,
    'Cobro ' || v_per::text || ' marcado como ' || p_status,
    jsonb_build_object('factura', nullif(btrim(p_invoice_ref), '')));
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_add_billing_adjustment(p_merchant uuid, p_period date, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_per date := date_trunc('month', p_period)::date;
begin
  perform private.require_ceo();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 then return private.reject('monto_invalido'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then return private.reject('motivo_requerido'); end if;
  if exists (select 1 from public.billing_periods where merchant_id = p_merchant and period = v_per and status <> 'pendiente') then
    return private.reject('periodo_cerrado');
  end if;
  insert into public.billing_adjustments (merchant_id, period, amount_ars, reason, created_by)
  values (p_merchant, v_per, p_amount, btrim(p_reason), auth.uid());
  perform private.audit('cobro_ajuste', 'cobro', p_merchant::text || ':' || v_per::text, 'Ajuste de cobro',
    jsonb_build_object('monto', p_amount, 'motivo', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Fotos (logo, banner, comercios, desafíos y premios)
-- ---------------------------------------------------------------------------
create function public.admin_set_photo(p_target text, p_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require_perm('fotos.gestionar');
  perform private.assert_photo_path(p_path);
  if p_target = 'logo' then
    update public.app_config set logo_path = p_path, updated_at = now(); v_n := 1;
  elsif p_target = 'banner' then
    update public.app_config set banner_path = p_path, updated_at = now(); v_n := 1;
  elsif p_target = 'merchant' then
    update public.merchants set photo_path = p_path, updated_at = now() where id = p_id; get diagnostics v_n = row_count;
  elsif p_target = 'challenge' then
    update public.challenges set photo_path = p_path where id = p_id; get diagnostics v_n = row_count;
  elsif p_target = 'reward' then
    update public.rewards set photo_path = p_path where id = p_id; get diagnostics v_n = row_count;
  else
    return private.reject('destino_invalido');
  end if;
  if v_n = 0 then return private.reject('no_encontrado'); end if;
  perform private.audit('foto_cambiada', p_target, p_id::text, 'Cambió una foto (' || p_target || ')');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Equipo y cuentas (solo CEO)
-- ---------------------------------------------------------------------------
create function public.admin_list_team() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'role', r.role,
      'merchant_id', r.merchant_id, 'merchant_name', m.name, 'display_name', r.display_name, 'phone', r.phone,
      'perms', case when r.role = 'ceo' then to_jsonb(private.perm_catalog()) else to_jsonb(r.perms) end,
      'active', r.active, 'suspended_reason', r.suspended_reason, 'must_change_password', r.must_change_password,
      'last_access_at', r.last_access_at, 'created_at', r.created_at, 'created_by_name', private.actor_name(r.created_by))
      order by (r.role = 'ceo') desc, r.role, r.display_name), '[]'::jsonb)
    from public.user_roles r left join public.merchants m on m.id = r.merchant_id
  );
end $$;

-- Lo llama la Edge Function "admin-create-account" con la sesión del CEO,
-- después de crear el usuario de acceso (que necesita la clave de servicio).
create function public.admin_register_role(p_user uuid, p_role text, p_merchant uuid, p_perms text[],
                                           p_display_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_perms text[] := coalesce(p_perms, '{}'); v_id uuid; v_name text := btrim(coalesce(p_display_name, ''));
begin
  perform private.require_ceo();
  if p_role not in ('equipo', 'comercio') then return private.reject('rol_invalido'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'display_name');
  end if;
  if not exists (select 1 from auth.users where id = p_user) then return private.reject('usuario_no_existe'); end if;
  if p_role = 'comercio' then
    v_perms := '{}';
    if p_merchant is null or not exists (select 1 from public.merchants where id = p_merchant) then
      return private.reject('comercio_no_encontrado');
    end if;
  else
    p_merchant := null;
    if exists (select 1 from unnest(v_perms) x where x <> all (private.perm_catalog())) then
      return private.reject('permiso_invalido');
    end if;
  end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role = p_role
             and merchant_id is not distinct from p_merchant) then
    return private.reject('ya_existe');
  end if;
  insert into public.user_roles (user_id, role, merchant_id, perms, display_name, phone, must_change_password, created_by)
  values (p_user, p_role, p_merchant, v_perms, v_name, nullif(btrim(p_phone), ''), true, auth.uid())
  returning id into v_id;
  perform private.audit('cuenta_creada', 'cuenta', v_id::text,
    'Creó una cuenta de ' || p_role || ': ' || v_name, jsonb_build_object('permisos', v_perms, 'comercio', p_merchant));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function public.admin_update_role(p_id uuid, p_perms text[], p_active boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.user_roles; v_new text[]; v_added text[]; v_removed text[];
begin
  perform private.require_ceo();
  select * into v_r from public.user_roles where id = p_id for update;
  if not found then return private.reject('cuenta_no_encontrada'); end if;
  if v_r.role = 'ceo' then return private.reject('cuenta_protegida'); end if;
  if not p_active and char_length(btrim(coalesce(p_reason, ''))) < 3 then return private.reject('motivo_requerido'); end if;
  v_new := case when v_r.role = 'equipo' then coalesce(p_perms, v_r.perms) else '{}' end;
  if exists (select 1 from unnest(v_new) x where x <> all (private.perm_catalog())) then
    return private.reject('permiso_invalido');
  end if;
  select coalesce(array_agg(x), '{}') into v_added from unnest(v_new) x where x <> all (v_r.perms);
  select coalesce(array_agg(x), '{}') into v_removed from unnest(v_r.perms) x where x <> all (v_new);
  update public.user_roles set perms = v_new, active = p_active,
    suspended_reason = case when p_active then null else btrim(p_reason) end where id = p_id;
  perform private.audit('cuenta_editada', 'cuenta', p_id::text, 'Editó la cuenta ' || v_r.display_name,
    jsonb_build_object('permisos_agregados', v_added, 'permisos_quitados', v_removed,
                       'activa', p_active, 'motivo', nullif(btrim(p_reason), '')));
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_flag_password_reset(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  update public.user_roles set must_change_password = true where user_id = p_user and role <> 'ceo';
  if not found then return private.reject('cuenta_no_encontrada'); end if;
  perform private.audit('cuenta_clave_restablecida', 'cuenta', p_user::text, 'Restableció el acceso de una cuenta');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Control y seguridad (solo CEO)
-- ---------------------------------------------------------------------------
create function public.admin_list_alerts(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'ts', a.ts, 'kind', a.kind, 'severity', a.severity,
      'entity_type', a.entity_type, 'entity_id', a.entity_id, 'summary', a.summary, 'status', a.status,
      'assignee_name', case when a.assignee is null then null else private.actor_name(a.assignee) end,
      'notes', a.notes, 'updated_at', a.updated_at)
      order by (a.status in ('nueva', 'en_revision')) desc,
               array_position(array['critica','alta','media','baja','informativa'], a.severity), a.ts desc), '[]'::jsonb)
    from public.alerts a where p_status is null or a.status = p_status
  );
end $$;

create function public.admin_update_alert(p_id bigint, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.alerts;
begin
  perform private.require_ceo();
  if p_status not in ('nueva', 'en_revision', 'cerrada', 'confirmada') then return private.reject('estado_invalido'); end if;
  select * into v_a from public.alerts where id = p_id for update;
  if not found then return private.reject('alerta_no_encontrada'); end if;
  if p_status in ('cerrada', 'confirmada') and char_length(btrim(coalesce(p_note, ''))) < 3 then
    return private.reject('motivo_requerido');
  end if;
  update public.alerts set status = p_status, assignee = auth.uid(), updated_at = now(),
    notes = notes || case when nullif(btrim(coalesce(p_note, '')), '') is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('ts', now(), 'by', private.actor_name(auth.uid()), 'text', btrim(p_note))) end
  where id = p_id;
  perform private.audit('alerta_' || p_status, 'alerta', p_id::text, 'Alerta #' || p_id || ': ' || p_status,
    jsonb_build_object('nota', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('ok', true);
end $$;

-- Verificación de integridad: saldo de cada billetera = suma de sus movimientos; cadena de auditoría intacta
create function public.admin_integrity_check() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_bad int; v_orphan int;
begin
  perform private.require_ceo();
  select count(*) into v_bad from public.wallets w
   where w.balance <> coalesce((select sum(l.amount) from public.pasos_ledger l where l.user_id = w.user_id), 0);
  select count(distinct l.user_id) into v_orphan from public.pasos_ledger l
   where l.user_id is not null and not exists (select 1 from public.wallets w where w.user_id = l.user_id);
  return jsonb_build_object(
    'wallets_mismatch', v_bad, 'ledger_without_wallet', v_orphan,
    'negative_balances', (select count(*) from public.wallets where balance < 0),
    'audit_chain', private.verify_audit_chain(),
    'ok', v_bad = 0 and v_orphan = 0 and (private.verify_audit_chain() ->> 'ok')::boolean);
end $$;

create function public.admin_control_panel() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  return jsonb_build_object(
    'alerts_new', (select count(*) from public.alerts where status = 'nueva'),
    'alerts_review', (select count(*) from public.alerts where status = 'en_revision'),
    'visits_voided_30d', (select count(*) from public.visits where status = 'anulada' and voided_at > now() - interval '30 days'),
    'coupons_cancelled_30d', (select count(*) from public.coupons where status in ('cancelado', 'anulado') and cancelled_at > now() - interval '30 days'),
    'failed_attempts_24h', (select count(*) from public.visit_attempts where ts > now() - interval '24 hours')
                          + (select count(*) from public.coupon_attempts where ts > now() - interval '24 hours'),
    'suspended_people', (select count(*) from public.profiles where status = 'suspendido'),
    'suspended_accounts', (select count(*) from public.user_roles where not active),
    'sensitive_actions_7d', (select count(*) from public.audit_log where ts > now() - interval '7 days'
                              and action in ('pasos_ajuste', 'visita_anulada', 'cupon_anulado', 'config_cambiada', 'pausa_activada', 'pausa_desactivada', 'cuenta_creada', 'cuenta_editada')));
end $$;

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
create function public.admin_list_audit(p_limit int default 50, p_before bigint default null, p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm('auditoria.ver');
  return (
    select coalesce(jsonb_agg(t.j order by t.id desc), '[]'::jsonb)
    from (
      select a.id, jsonb_build_object('id', a.id, 'ts', a.ts, 'actor_name', private.actor_name(a.actor),
        'actor_role', a.actor_role, 'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
        'summary', a.summary, 'details', a.details) as j
      from public.audit_log a
      where (p_before is null or a.id < p_before)
        and (p_search is null or p_search = '' or a.action ilike '%' || p_search || '%' or a.summary ilike '%' || p_search || '%')
      order by a.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) t
  );
end $$;

-- ---------------------------------------------------------------------------
-- Configuración y pausa de emergencia (solo CEO)
-- ---------------------------------------------------------------------------
create function public.admin_get_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.app_config;
begin
  perform private.require_ceo();
  select * into v from public.app_config;
  return to_jsonb(v);
end $$;

create function public.admin_update_config(p_changes jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_key text;
  v_val text;
  v_old text;
  v_type text;
  v_min numeric; v_max numeric;
  v_changed jsonb := '[]'::jsonb;
  -- clave -> tipo|mínimo|máximo
  v_spec constant jsonb := jsonb_build_object(
    'daily_cap', 'int|1|50', 'fee_per_visit', 'numeric|0|1000000', 'max_uses_per_code', 'int|1|200',
    'code_rotation_s', 'int|20|600', 'acceptance_hours', 'int|1|168', 'code_grace_s', 'int|0|300', 'claim_window_s', 'int|30|3600',
    'heartbeat_s', 'int|20|600', 'max_failed_attempts', 'int|3|30', 'coupon_valid_days', 'int|1|365',
    'require_merchant_active', 'boolean', 'require_gps', 'boolean', 'mfa_required', 'boolean',
    'refund_on_expiry', 'boolean', 'test_mode', 'boolean', 'terms_version', 'text', 'privacy_version', 'text');
  v_parts text[];
begin
  perform private.require_ceo();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return private.reject('motivo_requerido'); end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    return private.reject('sin_cambios');
  end if;
  select * into v_cfg from public.app_config;

  for v_key, v_val in select key, value from jsonb_each_text(p_changes) loop
    if not v_spec ? v_key then return jsonb_build_object('ok', false, 'reason', 'clave_invalida', 'field', v_key); end if;
    v_parts := string_to_array(v_spec ->> v_key, '|');
    v_type := v_parts[1];
    if v_type in ('int', 'numeric') then
      begin
        if v_val::numeric < v_parts[2]::numeric or v_val::numeric > v_parts[3]::numeric
           or (v_type = 'int' and v_val::numeric <> trunc(v_val::numeric)) then
          return jsonb_build_object('ok', false, 'reason', 'valor_fuera_de_rango', 'field', v_key);
        end if;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'reason', 'valor_invalido', 'field', v_key);
      end;
    elsif v_type = 'boolean' then
      if v_val not in ('true', 'false') then
        return jsonb_build_object('ok', false, 'reason', 'valor_invalido', 'field', v_key);
      end if;
      if v_key = 'test_mode' and v_val = 'true' and v_cfg.environment = 'produccion' then
        return private.reject('modo_prueba_prohibido_en_produccion');
      end if;
    else
      if char_length(btrim(v_val)) < 1 or char_length(v_val) > 40 then
        return jsonb_build_object('ok', false, 'reason', 'valor_invalido', 'field', v_key);
      end if;
    end if;
  end loop;

  for v_key, v_val in select key, value from jsonb_each_text(p_changes) loop
    execute format('select %I::text from public.app_config', v_key) into v_old;
    if v_old is distinct from v_val then
      v_type := split_part(v_spec ->> v_key, '|', 1);
      execute format('update public.app_config set %I = %L::%s, updated_at = now()', v_key, v_val,
                     case when v_type = 'int' then 'int' when v_type = 'numeric' then 'numeric' when v_type = 'boolean' then 'boolean' else 'text' end);
      insert into public.config_history (actor, key, old_value, new_value, reason)
      values (auth.uid(), v_key, v_old, v_val, btrim(p_reason));
      v_changed := v_changed || jsonb_build_array(jsonb_build_object('clave', v_key, 'antes', v_old, 'despues', v_val));
    end if;
  end loop;

  if jsonb_array_length(v_changed) > 0 then
    perform private.audit('config_cambiada', 'configuracion', null, 'Cambió la configuración',
      jsonb_build_object('cambios', v_changed, 'motivo', btrim(p_reason)));
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end $$;

create function public.admin_config_history(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ceo();
  return (select coalesce(jsonb_agg(jsonb_build_object('ts', h.ts, 'by', private.actor_name(h.actor), 'key', h.key,
            'old_value', h.old_value, 'new_value', h.new_value, 'reason', h.reason) order by h.id desc), '[]'::jsonb)
          from (select * from public.config_history order by id desc
                limit least(greatest(coalesce(p_limit, 50), 1), 200)) h);
end $$;

-- Pausa general de emergencia. Reactivar exige completar el checklist.
create function public.admin_set_pause(p_paused boolean, p_reason text, p_checklist jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.app_config;
  v_item text;
begin
  perform private.require_ceo();
  select * into v_cfg from public.app_config;
  if p_paused then
    if char_length(btrim(coalesce(p_reason, ''))) < 5 then return private.reject('motivo_requerido'); end if;
    if v_cfg.paused then return private.reject('ya_en_pausa'); end if;
    update public.app_config set paused = true, pause_reason = btrim(p_reason), paused_at = now(),
           paused_by = auth.uid(), updated_at = now();
    perform private.raise_alert('pausa_general', 'critica', 'sistema', 'global',
      'ANDÁ está en pausa: ' || btrim(p_reason));
    perform private.audit('pausa_activada', 'sistema', null, 'Pausó las operaciones de ANDÁ',
      jsonb_build_object('motivo', btrim(p_reason)));
  else
    if not v_cfg.paused then return private.reject('no_esta_en_pausa'); end if;
    foreach v_item in array array['causa_identificada', 'incidencia_resuelta', 'validaciones_tecnicas',
                                  'reglas_comprobadas', 'cupones_revisados', 'comunicacion_preparada'] loop
      if coalesce(p_checklist ->> v_item, 'false') <> 'true' then
        return jsonb_build_object('ok', false, 'reason', 'checklist_incompleto', 'missing', v_item);
      end if;
    end loop;
    update public.app_config set paused = false, pause_reason = null, paused_at = null, paused_by = null, updated_at = now();
    update public.alerts set status = 'cerrada', updated_at = now()
     where kind = 'pausa_general' and status in ('nueva', 'en_revision');
    perform private.audit('pausa_desactivada', 'sistema', null, 'Reactivó las operaciones de ANDÁ',
      jsonb_build_object('checklist', p_checklist, 'motivo_original', v_cfg.pause_reason));
  end if;
  return jsonb_build_object('ok', true, 'paused', p_paused);
end $$;

-- ---------------------------------------------------------------------------
-- Alta del primer CEO y pasaje a producción: SOLO desde el editor SQL (no por API)
-- ---------------------------------------------------------------------------
create function private.bootstrap_ceo(p_email text, p_name text default 'CEO') returns text
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    return 'No existe ese usuario. Ingresá primero a la app con esa cuenta (Google/Apple) y volvé a ejecutar.';
  end if;
  insert into public.user_roles (user_id, role, perms, display_name)
  values (v_user, 'ceo', '{}', p_name)
  on conflict do nothing;
  insert into public.audit_log (actor, actor_role, action, target_type, target_id, summary)
  values (null, 'sistema', 'ceo_creado', 'cuenta', v_user::text, 'Se asignó el rol CEO desde el editor SQL');
  return 'Listo: ' || p_email || ' ahora es CEO.';
end $$;

create function private.set_environment(p_env text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_env not in ('prueba', 'produccion') then return 'Valor inválido'; end if;
  if p_env = 'produccion' then
    update public.app_config set environment = 'produccion', test_mode = false, updated_at = now();
  else
    update public.app_config set environment = 'prueba', updated_at = now();
  end if;
  insert into public.audit_log (actor, actor_role, action, target_type, summary)
  values (null, 'sistema', 'entorno_cambiado', 'sistema', 'Entorno: ' || p_env);
  return 'Entorno: ' || p_env;
end $$;
