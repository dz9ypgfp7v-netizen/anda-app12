-- ============================================================================
-- ANDÁ · 0004 · Funciones del perfil COMERCIO
-- El comercio solo ve datos agregados de SU comercio: nunca ubicación individual,
-- fecha de nacimiento, datos de salud ni identidad de las personas.
-- ============================================================================

-- Cobros: filas por comercio y mes (visitas verificadas x tarifa histórica + ajustes)
create function private.billing_rows(p_merchant uuid default null)
returns table (merchant_id uuid, period date, visits int, visits_amount numeric,
               adjustments numeric, total numeric, status text, invoice_ref text, frozen boolean)
language sql stable security definer set search_path = '' as $$
  with v as (
    select x.merchant_id, date_trunc('month', x.day)::date as period,
           count(*)::int as n, coalesce(sum(x.fee_ars), 0) as amt
    from public.visits x
    where x.status = 'valida' and (p_merchant is null or x.merchant_id = p_merchant)
    group by 1, 2
  ), a as (
    select y.merchant_id, y.period, sum(y.amount_ars) as adj
    from public.billing_adjustments y
    where (p_merchant is null or y.merchant_id = p_merchant)
    group by 1, 2
  ), k as (
    select merchant_id, period from v
    union select merchant_id, period from a
    union select b.merchant_id, b.period from public.billing_periods b
          where (p_merchant is null or b.merchant_id = p_merchant)
  )
  select k.merchant_id, k.period,
         case when bp.frozen_visits is not null then bp.frozen_visits else coalesce(v.n, 0) end,
         case when bp.frozen_amount is not null then bp.frozen_amount else coalesce(v.amt, 0) end,
         coalesce(a.adj, 0),
         (case when bp.frozen_amount is not null then bp.frozen_amount else coalesce(v.amt, 0) end)
           + coalesce(a.adj, 0),
         coalesce(bp.status, 'pendiente'), bp.invoice_ref, bp.frozen_visits is not null
  from k
  left join v on v.merchant_id = k.merchant_id and v.period = k.period
  left join a on a.merchant_id = k.merchant_id and a.period = k.period
  left join public.billing_periods bp on bp.merchant_id = k.merchant_id and bp.period = k.period
$$;

-- Primer período mensual todavía "pendiente" a partir de hoy (para ajustes por anulaciones)
create function private.open_period(p_merchant uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare v_p date := date_trunc('month', private.today())::date; v_i int := 0;
begin
  while exists (select 1 from public.billing_periods
                where merchant_id = p_merchant and period = v_p and status <> 'pendiente') and v_i < 24 loop
    v_p := (v_p + interval '1 month')::date; v_i := v_i + 1;
  end loop;
  return v_p;
end $$;

-- ---------------------------------------------------------------------------
create function public.merchant_overview(p_merchant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_m public.merchants;
begin
  perform private.require_merchant(p_merchant);
  select * into v_m from public.merchants where id = p_merchant;
  return jsonb_build_object(
    'id', v_m.id, 'name', v_m.name, 'category', v_m.category, 'neighborhood', v_m.neighborhood,
    'photo_path', v_m.photo_path, 'is_example', v_m.is_example,
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name,
                   'address', b.address, 'status', b.status) order by b.name), '[]'::jsonb)
                 from public.branches b where b.merchant_id = p_merchant),
    'paused', (select paused from public.app_config)
  );
end $$;

create function public.merchant_summary(p_merchant uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.today();
  v_n int := least(greatest(coalesce(p_days, 30), 1), 90);
begin
  perform private.require_merchant(p_merchant);
  return jsonb_build_object(
    'visits_today', (select count(*) from public.visits v
                     where v.merchant_id = p_merchant and v.status = 'valida' and v.day = v_today),
    'visits_7d', (select count(*) from public.visits v
                  where v.merchant_id = p_merchant and v.status = 'valida' and v.day > v_today - 7),
    'visits_period', (select count(*) from public.visits v
                      where v.merchant_id = p_merchant and v.status = 'valida' and v.day > v_today - v_n),
    'coupons_issued', (select count(*) from public.coupons c
                       where c.merchant_id = p_merchant and c.created_at > now() - make_interval(days => v_n)),
    'coupons_redeemed', (select count(*) from public.coupons c
                         where c.merchant_id = p_merchant and c.status = 'canjeado'
                           and c.redeemed_at > now() - make_interval(days => v_n)),
    'coupons_pending', (select count(*) from public.coupons c
                        where c.merchant_id = p_merchant and c.status = 'pendiente' and c.expires_at > now()),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', v_today - i,
                  'visits', (select count(*) from public.visits v
                             where v.merchant_id = p_merchant and v.status = 'valida' and v.day = v_today - i))
                  order by i desc), '[]'::jsonb)
               from generate_series(0, 13) i),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title,
                    'state', private.challenge_state(c), 'reward_pasos', c.reward_pasos,
                    'visits', (select count(*) from public.visits v
                               where v.challenge_id = c.id and v.status = 'valida'
                                 and v.day > v_today - v_n)) order by c.created_at), '[]'::jsonb)
                  from public.challenges c
                  where c.merchant_id = p_merchant and private.challenge_state(c) in ('activo','pausado','programado')),
    'paused', (select paused from public.app_config)
  );
end $$;

-- Código dinámico del local. Mientras esta pantalla lo consulta, el local "está validando".
create function public.merchant_current_code(p_branch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.branches; v_cfg public.app_config; v_vc public.visit_codes; v_left numeric;
begin
  select * into v_b from public.branches where id = p_branch;
  if not found then raise exception 'sin_permiso' using errcode = 'PT403'; end if;
  perform private.require_merchant(v_b.merchant_id);
  select * into v_cfg from public.app_config;

  if v_cfg.paused then
    return jsonb_build_object('ok', true, 'paused', true, 'validating', false, 'branch_name', v_b.name);
  end if;
  if v_b.status <> 'activo' then return private.reject('local_suspendido'); end if;

  v_vc := private.ensure_code(p_branch);
  update public.visit_codes set active_until = now() + make_interval(secs => v_cfg.heartbeat_s)
   where branch_id = p_branch;
  v_left := greatest(0, v_cfg.code_rotation_s - extract(epoch from (now() - v_vc.rotated_at)));
  return jsonb_build_object('ok', true, 'paused', false, 'validating', true, 'code', v_vc.code,
    'rotation_s', v_cfg.code_rotation_s, 'expires_in_s', ceil(v_left)::int,
    'uses', v_vc.uses, 'max_uses', v_cfg.max_uses_per_code, 'branch_name', v_b.name);
end $$;

create function public.merchant_recent_validations(p_merchant uuid, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_merchant(p_merchant);
  return (
    select coalesce(jsonb_agg(t.j order by t.ts desc), '[]'::jsonb)
    from (
      select v.created_at as ts, jsonb_build_object('id', v.id, 'at', v.created_at,
               'challenge', ch.title, 'branch', b.name, 'status', v.status, 'pasos', v.pasos) as j
      from public.visits v
      join public.challenges ch on ch.id = v.challenge_id
      left join public.branches b on b.id = v.branch_id
      where v.merchant_id = p_merchant
      order by v.created_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) t
  );
end $$;

create function public.merchant_challenges(p_merchant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_merchant(p_merchant);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'title', c.title, 'description', c.description, 'type', c.type,
      'state', private.challenge_state(c), 'reward_pasos', c.reward_pasos, 'repeat_rule', c.repeat_rule,
      'quota_total', c.quota_total, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'photo_path', c.photo_path, 'is_example', c.is_example,
      'visits', (select count(*) from public.visits v where v.challenge_id = c.id and v.status = 'valida')
    ) order by c.created_at desc), '[]'::jsonb)
    from public.challenges c
    where c.merchant_id = p_merchant and c.status in ('programado','activo','pausado','finalizado')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Cupones: validar y entregar
-- ---------------------------------------------------------------------------
-- Diagnóstico de un código para este comercio (sin cambiar nada)
create function private.coupon_diagnose(p_merchant uuid, p_code text, out o_coupon public.coupons, out o_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  select * into o_coupon from public.coupons where code = private.normalize_coupon_code(p_code);
  if not found then
    o_reason := 'codigo_inexistente';
  elsif o_coupon.merchant_id <> p_merchant then
    o_reason := 'otro_comercio';
  elsif o_coupon.status = 'canjeado' then
    o_reason := 'ya_utilizado';
  elsif o_coupon.status in ('cancelado','anulado') then
    o_reason := 'cupon_cancelado';
  elsif o_coupon.status = 'vencido' or o_coupon.expires_at <= now() then
    o_reason := 'cupon_vencido';
  else
    o_reason := null;
  end if;
end $$;

create function public.lookup_coupon(p_merchant uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_d record;
  v_fails int;
begin
  perform private.require_merchant(p_merchant);
  select * into v_cfg from public.app_config;
  if v_cfg.paused then return private.reject('pausa'); end if;

  select count(*) into v_fails from public.coupon_attempts
   where actor = v_me and ts > now() - interval '10 minutes';
  if v_fails >= v_cfg.max_failed_attempts * 2 then return private.reject('demasiados_intentos'); end if;

  select * into v_d from private.coupon_diagnose(p_merchant, p_code);
  if v_d.o_reason is not null then
    -- los códigos inexistentes o de otro comercio cuentan como intento fallido
    if v_d.o_reason in ('codigo_inexistente','otro_comercio') then
      insert into public.coupon_attempts (actor, merchant_id, reason) values (v_me, p_merchant, v_d.o_reason);
      if v_fails + 1 >= v_cfg.max_failed_attempts * 2 then
        perform private.raise_alert('intentos_cupon', 'media', 'usuario', v_me::text,
          'Muchos códigos de cupón inválidos desde una cuenta de comercio');
      end if;
    end if;
    return private.reject(v_d.o_reason, case when v_d.o_reason = 'ya_utilizado'
      then jsonb_build_object('redeemed_at', (v_d.o_coupon).redeemed_at) else '{}'::jsonb end);
  end if;

  return jsonb_build_object('ok', true, 'coupon', jsonb_build_object(
    'id', (v_d.o_coupon).id, 'code', (v_d.o_coupon).code, 'reward_title', (v_d.o_coupon).reward_title,
    'conditions', (v_d.o_coupon).reward_conditions, 'expires_at', (v_d.o_coupon).expires_at,
    'issued_at', (v_d.o_coupon).created_at));
end $$;

-- Entrega atómica: dos empleados o dos toques no pueden canjear el mismo cupón dos veces
create function public.redeem_coupon(p_merchant uuid, p_branch uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_cfg public.app_config;
  v_c public.coupons;
  v_d record;
begin
  perform private.require_merchant(p_merchant);
  select * into v_cfg from public.app_config;
  if v_cfg.paused then return private.reject('pausa'); end if;
  if p_branch is not null and not exists (
       select 1 from public.branches where id = p_branch and merchant_id = p_merchant and status = 'activo') then
    return private.reject('local_invalido');
  end if;

  update public.coupons
     set status = 'canjeado', redeemed_at = now(), redeemed_by = v_me, redeemed_branch_id = p_branch
   where code = private.normalize_coupon_code(p_code)
     and merchant_id = p_merchant and status = 'pendiente' and expires_at > now()
  returning * into v_c;

  if found then
    return jsonb_build_object('ok', true, 'coupon_id', v_c.id, 'reward_title', v_c.reward_title,
                              'redeemed_at', v_c.redeemed_at);
  end if;

  -- no se pudo: ¿fue este mismo usuario hace instantes (doble toque / reintento)?
  select * into v_d from private.coupon_diagnose(p_merchant, p_code);
  if v_d.o_reason = 'ya_utilizado' and (v_d.o_coupon).redeemed_by = v_me
     and (v_d.o_coupon).redeemed_at > now() - interval '15 seconds' then
    return jsonb_build_object('ok', true, 'replay', true, 'coupon_id', (v_d.o_coupon).id,
                              'reward_title', (v_d.o_coupon).reward_title,
                              'redeemed_at', (v_d.o_coupon).redeemed_at);
  end if;
  return private.reject(coalesce(v_d.o_reason, 'cupon_no_disponible'),
    case when v_d.o_reason = 'ya_utilizado'
      then jsonb_build_object('redeemed_at', (v_d.o_coupon).redeemed_at) else '{}'::jsonb end);
end $$;

create function public.merchant_redemptions(p_merchant uuid, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_merchant(p_merchant);
  return (
    select coalesce(jsonb_agg(t.j order by t.ts desc), '[]'::jsonb)
    from (
      select c.redeemed_at as ts, jsonb_build_object('id', c.id, 'code', c.code,
               'reward_title', c.reward_title, 'redeemed_at', c.redeemed_at, 'branch', b.name) as j
      from public.coupons c left join public.branches b on b.id = c.redeemed_branch_id
      where c.merchant_id = p_merchant and c.status = 'canjeado'
      order by c.redeemed_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 200)
    ) t
  );
end $$;

-- ---------------------------------------------------------------------------
-- Propuestas (campañas y premios) del comercio
-- ---------------------------------------------------------------------------
create function private.check_proposal(p_kind text, p_payload jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_desc text := btrim(coalesce(p_payload ->> 'description', ''));
  v_out jsonb;
begin
  if char_length(v_title) < 3 or char_length(v_title) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'title');
  end if;
  if char_length(v_desc) > 600 then
    return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'description');
  end if;
  if p_kind = 'campana' then
    if coalesce((p_payload ->> 'reward_pasos')::int, 0) not between 1 and 100000 then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'reward_pasos');
    end if;
    if coalesce(p_payload ->> 'repeat_rule', 'una_vez') not in ('una_vez', 'diaria') then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'repeat_rule');
    end if;
    if p_payload ->> 'quota_total' is not null and (p_payload ->> 'quota_total')::int < 1 then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'quota_total');
    end if;
    v_out := jsonb_build_object('title', v_title, 'description', v_desc,
      'reward_pasos', (p_payload ->> 'reward_pasos')::int,
      'repeat_rule', coalesce(p_payload ->> 'repeat_rule', 'una_vez'),
      'quota_total', (p_payload ->> 'quota_total')::int,
      'starts_at', p_payload ->> 'starts_at', 'ends_at', p_payload ->> 'ends_at');
  else
    if coalesce((p_payload ->> 'cost_pasos')::int, 0) not between 1 and 1000000 then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'cost_pasos');
    end if;
    if p_payload ->> 'stock' is not null and (p_payload ->> 'stock')::int < 0 then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'stock');
    end if;
    if coalesce((p_payload ->> 'valid_days')::int, 30) not between 1 and 365 then
      return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'valid_days');
    end if;
    v_out := jsonb_build_object('title', v_title, 'description', v_desc,
      'cost_pasos', (p_payload ->> 'cost_pasos')::int, 'stock', (p_payload ->> 'stock')::int,
      'valid_days', coalesce((p_payload ->> 'valid_days')::int, 30),
      'conditions', btrim(coalesce(p_payload ->> 'conditions', '')));
  end if;
  return jsonb_build_object('ok', true, 'payload', v_out);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok', false, 'reason', 'campo_invalido', 'field', 'formato');
end $$;

create function public.submit_proposal(p_merchant uuid, p_kind text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_chk jsonb; v_id uuid;
begin
  perform private.require_merchant(p_merchant);
  if p_kind not in ('campana','premio') then return private.reject('tipo_invalido'); end if;
  v_chk := private.check_proposal(p_kind, coalesce(p_payload, '{}'::jsonb));
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;
  insert into public.proposals (merchant_id, kind, payload, created_by)
  values (p_merchant, p_kind, v_chk -> 'payload', auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Reenviar una propuesta a la que el CEO pidió cambios (o editarla antes de que la revisen)
create function public.update_proposal(p_merchant uuid, p_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.proposals; v_chk jsonb;
begin
  perform private.require_merchant(p_merchant);
  select * into v_p from public.proposals where id = p_id and merchant_id = p_merchant for update;
  if not found then return private.reject('propuesta_no_encontrada'); end if;
  if v_p.status not in ('enviada','cambios_solicitados') then return private.reject('propuesta_no_editable'); end if;
  v_chk := private.check_proposal(v_p.kind, coalesce(p_payload, '{}'::jsonb));
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;
  update public.proposals set payload = v_chk -> 'payload', status = 'enviada', updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function public.merchant_proposals(p_merchant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_merchant(p_merchant);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'payload', p.payload,
      'status', p.status, 'review_note', p.review_note, 'created_at', p.created_at,
      'updated_at', p.updated_at) order by p.created_at desc), '[]'::jsonb)
    from public.proposals p where p.merchant_id = p_merchant
  );
end $$;

-- ---------------------------------------------------------------------------
-- Cobros del comercio (solo lectura)
-- ---------------------------------------------------------------------------
create function public.merchant_billing(p_merchant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_merchant(p_merchant);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('period', b.period, 'visits', b.visits,
      'visits_amount', b.visits_amount, 'adjustments', b.adjustments, 'total', b.total,
      'status', b.status, 'invoice_ref', b.invoice_ref) order by b.period desc), '[]'::jsonb)
    from private.billing_rows(p_merchant) b
  );
end $$;

-- ---------------------------------------------------------------------------
-- Cambio de contraseña temporal (la contraseña en sí la cambia Supabase Auth)
-- ---------------------------------------------------------------------------
create function public.mark_password_changed() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.user_roles set must_change_password = false where user_id = private.me();
  return jsonb_build_object('ok', true);
end $$;
