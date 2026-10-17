-- ============================================================================
-- ANDÁ · 0001 · Tablas
-- Diseño: TODA la lectura y escritura pasa por funciones del servidor (RPC).
-- Las tablas no son accesibles directamente desde la app (ver 0009_seguridad.sql).
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Configuración global (una sola fila)
-- ---------------------------------------------------------------------------
create table public.app_config (
  id boolean primary key default true check (id),
  environment text not null default 'prueba' check (environment in ('prueba','produccion')),
  test_mode boolean not null default false,
  paused boolean not null default false,
  pause_reason text,
  paused_at timestamptz,
  paused_by uuid,
  daily_cap int not null default 3 check (daily_cap between 1 and 50),
  fee_per_visit numeric(12,2) not null default 200 check (fee_per_visit >= 0),
  max_uses_per_code int not null default 4 check (max_uses_per_code between 1 and 200),
  code_rotation_s int not null default 45 check (code_rotation_s between 20 and 600),
  code_grace_s int not null default 30 check (code_grace_s between 0 and 300),
  claim_window_s int not null default 300 check (claim_window_s between 30 and 3600),
  acceptance_hours int not null default 24 check (acceptance_hours between 1 and 168),
  heartbeat_s int not null default 90 check (heartbeat_s between 20 and 600),
  max_failed_attempts int not null default 5 check (max_failed_attempts between 3 and 30),
  require_merchant_active boolean not null default true,
  require_gps boolean not null default false,
  mfa_required boolean not null default false,
  refund_on_expiry boolean not null default false,
  coupon_valid_days int not null default 30 check (coupon_valid_days between 1 and 365),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  terms_version text not null default '0.1-borrador',
  privacy_version text not null default '0.1-borrador',
  logo_path text,
  banner_path text,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (true);

create table public.config_history (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor uuid,
  key text not null,
  old_value text,
  new_value text,
  reason text
);

-- ---------------------------------------------------------------------------
-- Comercios y locales
-- ---------------------------------------------------------------------------
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  category text not null default 'otros',
  description text check (description is null or char_length(description) <= 500),
  neighborhood text,
  photo_path text,
  status text not null default 'activo' check (status in ('activo','suspendido')),
  status_reason text,
  fee_per_visit numeric(12,2) check (fee_per_visit is null or fee_per_visit >= 0),
  is_example boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  address text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  radius_m int not null default 80 check (radius_m between 20 and 1000),
  status text not null default 'activo' check (status in ('activo','suspendido')),
  created_at timestamptz not null default now()
);
create index branches_merchant_idx on public.branches (merchant_id);

-- ---------------------------------------------------------------------------
-- Personas (perfil privado) y aceptaciones legales
-- NO se guarda DNI. La fecha de nacimiento es privada: ninguna función de
-- Comercio ni de Equipo la devuelve.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  birth_date date not null,
  adult_declared_at timestamptz not null,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null,
  status text not null default 'activo' check (status in ('activo','suspendido')),
  status_reason text,
  last_activity_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('terminos','privacidad')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, kind, version)
);

-- ---------------------------------------------------------------------------
-- Roles: ceo / equipo / comercio (una persona puede tener perfil Persona y además un rol)
-- ---------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('ceo','equipo','comercio')),
  merchant_id uuid references public.merchants(id) on delete cascade,
  perms text[] not null default '{}',
  display_name text not null check (char_length(display_name) between 1 and 80),
  phone text,
  active boolean not null default true,
  suspended_reason text,
  must_change_password boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_access_at timestamptz,
  constraint user_roles_merchant_iff_comercio check ((role = 'comercio') = (merchant_id is not null))
);
create unique index user_roles_unique
  on public.user_roles (user_id, role, coalesce(merchant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------------
-- Desafíos y premios
-- ---------------------------------------------------------------------------
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 600),
  category text not null default 'visitas',
  type text not null check (type in ('visita','meta_pasos')),
  merchant_id uuid references public.merchants(id) on delete restrict,
  reward_pasos int not null check (reward_pasos between 1 and 1000000),
  repeat_rule text not null default 'una_vez' check (repeat_rule in ('una_vez','diaria')),
  per_person_max int check (per_person_max is null or per_person_max >= 1),
  quota_total int check (quota_total is null or quota_total >= 1),
  goal_steps int check (goal_steps is null or goal_steps between 1000 and 100000),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'borrador'
    check (status in ('borrador','revision','programado','activo','pausado','finalizado')),
  photo_path text,
  proposal_id uuid,
  created_by uuid,
  submitted_by uuid,
  approved_by uuid,
  self_approved boolean not null default false,
  version int not null default 1,
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenges_visit_needs_merchant check (type <> 'visita' or merchant_id is not null),
  constraint challenges_goal_needs_steps check (type <> 'meta_pasos' or goal_steps is not null),
  constraint challenges_dates check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index challenges_status_idx on public.challenges (status);
create index challenges_merchant_idx on public.challenges (merchant_id);

-- Lugares reservados: en un desafío con cupo, la persona "acepta" y ocupa un lugar por un plazo.
-- Al completarlo pasa a 'completada'; si no lo cumple a tiempo, 'vencida' (el lugar se libera).
create table public.challenge_acceptances (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'activa' check (status in ('activa','completada','vencida','cancelada')),
  accepted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);
create unique index challenge_acceptances_one_active
  on public.challenge_acceptances (challenge_id, user_id) where status = 'activa';
create index challenge_acceptances_user_idx on public.challenge_acceptances (user_id);
create index challenge_acceptances_open_idx on public.challenge_acceptances (challenge_id) where status = 'activa';

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 600),
  category text not null default 'otros',
  cost_pasos int not null check (cost_pasos between 1 and 10000000),
  stock int check (stock is null or stock >= 0),          -- null = ilimitado
  per_person_max int check (per_person_max is null or per_person_max >= 1),
  valid_days int not null default 30 check (valid_days between 1 and 365),
  conditions text check (conditions is null or char_length(conditions) <= 600),
  photo_path text,
  status text not null default 'borrador' check (status in ('borrador','activo','pausado')),
  proposal_id uuid,
  created_by uuid,
  approved_by uuid,
  version int not null default 1,
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rewards_merchant_idx on public.rewards (merchant_id);

create table public.reward_price_history (
  id bigint generated always as identity primary key,
  reward_id uuid not null references public.rewards(id) on delete cascade,
  old_cost int,
  new_cost int not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

-- Historial de versiones de desafíos y premios (copia de la fila anterior)
create table public.row_versions (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid not null,
  version int not null,
  snapshot jsonb not null,
  actor uuid,
  ts timestamptz not null default now()
);
create index row_versions_idx on public.row_versions (table_name, row_id);

-- ---------------------------------------------------------------------------
-- Billetera y libro de PASOS (append-only)
-- ---------------------------------------------------------------------------
create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table public.pasos_ledger (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('visita','meta_pasos','canje','devolucion','reversion','ajuste','prueba')),
  amount int not null check (amount <> 0),
  ref_type text,
  ref_id uuid,
  idem_key text not null unique,
  reverses_id bigint references public.pasos_ledger(id),
  reason text,
  actor uuid,
  source text not null default 'web',
  created_at timestamptz not null default now()
);
create index pasos_ledger_user_idx on public.pasos_ledger (user_id, id desc);
create unique index pasos_ledger_one_reversal on public.pasos_ledger (reverses_id) where reverses_id is not null;

-- Pasos caminados: solo se muestran como actividad (no son PASOS de premio)
create table public.step_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  steps int not null default 0 check (steps between 0 and 100000),
  source text not null default 'prueba' check (source in ('prueba','dispositivo')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, source)
);

-- ---------------------------------------------------------------------------
-- Código dinámico de visita (uno por local)
-- ---------------------------------------------------------------------------
create table public.visit_codes (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  code text not null,
  rotated_at timestamptz not null default now(),
  uses int not null default 0,
  prev_code text,
  prev_valid_until timestamptz,
  prev_uses int not null default 0,
  old_codes text[] not null default '{}',
  active_until timestamptz
);

create table public.visit_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid,
  reason text not null,
  ts timestamptz not null default now()
);
create index visit_attempts_idx on public.visit_attempts (user_id, ts desc);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  challenge_id uuid not null references public.challenges(id),
  merchant_id uuid not null references public.merchants(id),
  branch_id uuid references public.branches(id),
  day date not null,
  pasos int not null check (pasos > 0),
  fee_ars numeric(12,2) not null check (fee_ars >= 0),
  gps_verified boolean not null default false,
  status text not null default 'valida' check (status in ('valida','anulada')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  ledger_id bigint references public.pasos_ledger(id),
  reverse_ledger_id bigint references public.pasos_ledger(id),
  created_at timestamptz not null default now()
);
create unique index visits_claim_idx on public.visits (user_id, claim_id);
create unique index visits_one_per_day on public.visits (user_id, challenge_id, day)
  where status = 'valida' and user_id is not null;
create index visits_merchant_idx on public.visits (merchant_id, created_at desc);
create index visits_challenge_idx on public.visits (challenge_id) where status = 'valida';

-- ---------------------------------------------------------------------------
-- Cupones
-- ---------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  claim_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  reward_id uuid not null references public.rewards(id),
  merchant_id uuid not null references public.merchants(id),
  reward_title text not null,
  reward_conditions text,
  cost_pasos int not null,
  status text not null default 'pendiente'
    check (status in ('pendiente','canjeado','vencido','cancelado','anulado')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid,
  redeemed_branch_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  debit_ledger_id bigint references public.pasos_ledger(id),
  refund_ledger_id bigint references public.pasos_ledger(id)
);
create unique index coupons_claim_idx on public.coupons (user_id, claim_id);
create index coupons_user_idx on public.coupons (user_id, created_at desc);
create index coupons_merchant_idx on public.coupons (merchant_id, created_at desc);

create table public.coupon_attempts (
  id bigint generated always as identity primary key,
  actor uuid not null,
  merchant_id uuid,
  reason text not null,
  ts timestamptz not null default now()
);
create index coupon_attempts_idx on public.coupon_attempts (actor, ts desc);

-- ---------------------------------------------------------------------------
-- Propuestas de comercios, cobros, alertas y auditoría
-- ---------------------------------------------------------------------------
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  kind text not null check (kind in ('campana','premio')),
  payload jsonb not null,
  status text not null default 'enviada'
    check (status in ('enviada','en_revision','cambios_solicitados','aprobada','rechazada')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  result_challenge_id uuid,
  result_reward_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_periods (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  period date not null,                       -- primer día del mes
  status text not null default 'pendiente' check (status in ('pendiente','facturado','pagado')),
  invoice_ref text,
  frozen_visits int,
  frozen_amount numeric(14,2),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (merchant_id, period)
);

create table public.billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  period date not null,
  amount_ars numeric(14,2) not null check (amount_ars <> 0),
  reason text not null check (char_length(reason) between 3 and 300),
  visit_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.alerts (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  kind text not null,
  severity text not null check (severity in ('informativa','baja','media','alta','critica')),
  entity_type text,
  entity_id text,
  summary text not null,
  status text not null default 'nueva' check (status in ('nueva','en_revision','cerrada','confirmada')),
  assignee uuid,
  notes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index alerts_open_dedupe on public.alerts (kind, entity_id)
  where status in ('nueva','en_revision');

create table public.audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor uuid,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  summary text,
  details jsonb,
  prev_hash text,
  hash text
);
create index audit_log_ts_idx on public.audit_log (ts desc);

-- Seguridad en profundidad: RLS activado en todo y SIN políticas => ningún acceso directo.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
