// Ayudas para las pruebas de la base de datos.
// Cada llamada a rpc() imita a PostgREST/Supabase: una transacción propia,
// rol "authenticated" (o "anon") y los datos de la sesión (JWT) en request.jwt.claims.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const pool = new pg.Pool({
  host: '127.0.0.1',
  port: Number(process.env.ANDA_PGPORT || 54329),
  user: 'postgres',
  database: process.env.ANDA_DB || 'anda_test',
  max: 40,
});

export const U = {
  ceo: 'e0000000-0000-4000-8000-000000000001',
  gestor: 'e0000000-0000-4000-8000-000000000002',
  aprobador: 'e0000000-0000-4000-8000-000000000003',
  cafe: 'e0000000-0000-4000-8000-000000000011',
  pan: 'e0000000-0000-4000-8000-000000000012',
  nueva: 'e0000000-0000-4000-8000-000000000021',
  sofia: 'e0000000-0000-4000-8000-000000000022',
};
export const M = {
  cafe: 'a1000000-0000-4000-8000-000000000001',
  pan: 'a1000000-0000-4000-8000-000000000002',
  lib: 'a1000000-0000-4000-8000-000000000003',
};
export const B = {
  cafe: 'b1000000-0000-4000-8000-000000000001',
  cafe2: 'b1000000-0000-4000-8000-000000000004',
  pan: 'b1000000-0000-4000-8000-000000000002',
  lib: 'b1000000-0000-4000-8000-000000000003',
};
export const C = {
  cafe: 'c1000000-0000-4000-8000-000000000001',
  media: 'c1000000-0000-4000-8000-000000000002',
  pasos: 'c1000000-0000-4000-8000-000000000003',
  lib: 'c1000000-0000-4000-8000-000000000004',
};
export const R = {
  cafe: 'd1000000-0000-4000-8000-000000000001',
  fact: 'd1000000-0000-4000-8000-000000000002',
  libro: 'd1000000-0000-4000-8000-000000000003',
};

export const uuid = () => randomUUID();

/** Consulta como superusuario (dueño de la base). */
export async function sql(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows;
}
export async function one(text, params = []) {
  const rows = await sql(text, params);
  return rows[0];
}

/** Llama a una función pública como lo haría la API. */
export async function rpc(uid, fn, args = {}, opts = {}) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${opts.role || 'authenticated'}`);
    const claims = uid ? { sub: uid, role: 'authenticated', aal: opts.aal || 'aal1' } : { role: 'anon' };
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const names = Object.keys(args);
    const call = `select public.${fn}(${names.map((n, i) => `${n} := $${i + 1}`).join(', ')}) as r`;
    const vals = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v;
    });
    const res = await c.query(call, vals);
    await c.query('commit');
    return res.rows[0].r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Llama y espera que falle; devuelve {code, message}. */
export async function rpcFail(uid, fn, args = {}, opts = {}) {
  try {
    await rpc(uid, fn, args, opts);
  } catch (e) {
    return { code: e.code, message: e.message };
  }
  throw new Error(`Se esperaba un error al llamar ${fn} pero funcionó`);
}

/** Crea un usuario de acceso (en auth.users). */
export async function newUser(label = 'u') {
  const id = uuid();
  await sql('insert into auth.users (id, email) values ($1, $2)', [id, `${label}-${id.slice(0, 8)}@test.anda`]);
  return id;
}

/** Crea una persona registrada de verdad (usa register_profile) con saldo inicial opcional. */
export async function newPerson({ name = 'Persona de prueba', pasos = 0, birth = '1990-06-01' } = {}) {
  const id = await newUser('persona');
  const r = await rpc(id, 'register_profile', {
    p_name: name, p_birth: birth, p_adult: true, p_terms: true, p_privacy: true,
  });
  if (!r.ok) throw new Error('registro falló: ' + JSON.stringify(r));
  if (pasos) await grant(id, pasos);
  return id;
}

export async function grant(uid, amount, key = null) {
  await sql(`select private.ledger_add($1::uuid, 'prueba', $2::int, $3, 'prueba', null, 'saldo de prueba', null)`,
    [uid, amount, key || `t:${uuid()}`]);
}

export async function balance(uid) {
  return Number((await one('select coalesce((select balance from public.wallets where user_id = $1), 0) as b', [uid])).b);
}
export async function ledgerSum(uid) {
  return Number((await one('select coalesce(sum(amount), 0) as s from public.pasos_ledger where user_id = $1', [uid])).s);
}

/** Fuerza una rotación y devuelve un código nuevo (uses = 0) del local. */
export async function freshCode(branch) {
  await sql("update public.visit_codes set rotated_at = now() - interval '1 hour' where branch_id = $1", [branch]);
  return (await one('select (private.ensure_code($1::uuid)).code as code', [branch])).code;
}
export async function currentCode(branch) {
  return (await one('select (private.ensure_code($1::uuid)).code as code', [branch])).code;
}

/** Crea un desafío de visita activo para pruebas (como superusuario). */
export async function mkChallenge({ merchant = M.cafe, reward = 100, repeat = 'diaria', quota = null, perPerson = null,
  status = 'activo', start = null, end = null, title = null, type = 'visita', goal = null } = {}) {
  const id = uuid();
  await sql(
    `insert into public.challenges (id, title, type, merchant_id, reward_pasos, repeat_rule, quota_total, per_person_max,
        status, starts_at, ends_at, goal_steps)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, title || `Desafío ${id.slice(0, 6)}`, type, type === 'visita' ? merchant : null, reward, repeat, quota, perPerson,
      status, start, end, goal]);
  return id;
}

export async function mkReward({ merchant = M.cafe, cost = 1000, stock = 5, perPerson = null, status = 'activo', days = 30 } = {}) {
  const id = uuid();
  await sql(
    `insert into public.rewards (id, merchant_id, title, cost_pasos, stock, per_person_max, status, valid_days)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, merchant, `Premio ${id.slice(0, 6)}`, cost, stock, perPerson, status, days]);
  return id;
}

export async function setConfig(changes) {
  const sets = Object.keys(changes).map((k, i) => `${k} = $${i + 1}`).join(', ');
  await sql(`update public.app_config set ${sets}`, Object.values(changes));
}
export async function getConfig() {
  return one('select * from public.app_config');
}

/** Hace una visita válida y devuelve la respuesta. */
export async function visit(uid, challenge, branch, extra = {}) {
  const code = extra.code ?? (await freshCode(branch));
  return rpc(uid, 'claim_visit', { p_claim_id: extra.claim ?? uuid(), p_challenge_id: challenge, p_code: code,
    ...(extra.args || {}) });
}

export async function end() {
  await pool.end();
}
