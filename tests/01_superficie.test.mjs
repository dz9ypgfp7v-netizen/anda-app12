// Superficie de la API: qué puede tocar cada tipo de usuario.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, rpc, rpcFail, newPerson, newUser, end, U, uuid } from './helpers.mjs';

after(end);

const ANON_OK = new Set(['public_config']);
// Funciones que cualquier usuario con sesión puede llamar sin tener perfil ni rol
const SESSION_OK = new Set(['public_config', 'can_manage_photos', 'my_context', 'register_profile', 'mark_password_changed']);

async function functions() {
  return sql(`
    select p.oid, p.proname as name, p.proargnames as names, p.proargtypes::oid[] as types,
           (select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes::oid[]) with ordinality as x(t, o)) as typenames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' order by p.proname`);
}

function dummy(typename) {
  switch (typename) {
    case 'uuid': return uuid();
    case 'text': return 'x';
    case 'integer': case 'bigint': return 1;
    case 'numeric': case 'double precision': return 1;
    case 'boolean': return true;
    case 'jsonb': return {};
    case 'date': return '2026-01-01';
    case 'text[]': return [];
    default: return null;
  }
}

describe('privilegios', () => {
  test('anon solo puede ejecutar public_config', async () => {
    const rows = await sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')`);
    assert.deepEqual(rows.map((r) => r.proname).sort(), [...ANON_OK].sort());
  });

  test('nadie (anon ni authenticated) tiene acceso directo a tablas', async () => {
    const rows = await sql(`
      select c.relname, r.rolname, p.priv
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) r(rolname)
      cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
      where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p')
        and has_table_privilege(r.rolname, c.oid, p.priv)`);
    assert.deepEqual(rows, [], 'tablas expuestas: ' + JSON.stringify(rows));
  });

  test('todas las tablas de public tienen RLS activado', async () => {
    const rows = await sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(rows, []);
  });

  test('el esquema private y sus funciones no son accesibles desde la API', async () => {
    const rows = await sql(`
      select 'schema' as what, r.rolname from (values ('anon'), ('authenticated')) r(rolname)
        where has_schema_privilege(r.rolname, 'private', 'usage')
      union all
      select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated')) r(rolname)
        where n.nspname = 'private' and has_function_privilege(r.rolname, p.oid, 'execute')`);
    assert.deepEqual(rows, []);
  });

  test('intentos directos desde la sesión de un usuario son rechazados por permisos', async () => {
    for (const q of [
      'select * from public.pasos_ledger',
      "insert into public.pasos_ledger (user_id, kind, amount, idem_key) values (null, 'ajuste', 99999, 'hack')",
      'update public.app_config set paused = true',
      'update public.wallets set balance = 999999',
      'select * from public.profiles',
      'select private.me()',
      'delete from public.audit_log',
    ]) {
      const c = await (await import('./helpers.mjs')).pool.connect();
      try {
        await c.query('begin');
        await c.query('set local role authenticated');
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.sofia, role: 'authenticated' })]);
        await assert.rejects(c.query(q), (e) => e.code === '42501', q);
      } finally {
        await c.query('rollback');
        c.release();
      }
    }
  });
});

describe('autenticación', () => {
  test('sin sesión (anon) no se puede usar la API de datos', async () => {
    const e = await rpcFail(null, 'my_context', {}, { role: 'anon' });
    assert.equal(e.code, '42501');
  });

  test('con rol authenticated pero sin usuario, my_context responde no_autenticado (401)', async () => {
    const c = await (await import('./helpers.mjs')).pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'authenticated' })]);
      await assert.rejects(c.query('select public.my_context()'), (e) => e.code === 'PT401' && /no_autenticado/.test(e.message));
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  test('public_config funciona sin sesión y no expone datos internos', async () => {
    const r = await rpc(null, 'public_config', {}, { role: 'anon' });
    assert.equal(typeof r.paused, 'boolean');
    for (const k of ['pause_reason', 'paused_by', 'fee_per_visit', 'daily_cap', 'mfa_required']) {
      assert.ok(!(k in r), `public_config no debe incluir ${k}`);
    }
  });
});

describe('barrido de autorización', () => {
  test('toda función de la API rechaza a quien no corresponde', async () => {
    const fns = await functions();
    const persona = await newPerson();         // con perfil, sin roles
    const sinPerfil = await newUser('sinperfil'); // sin perfil ni roles
    const checked = { admin: 0, comercio: 0, persona: 0 };

    for (const f of fns) {
      if (SESSION_OK.has(f.name)) continue;
      const args = {};
      (f.names || []).forEach((n, i) => { args[n] = dummy(f.typenames[i]); });

      const isAdmin = f.name.startsWith('admin_');
      const isMerchant = ['merchant_overview', 'merchant_summary', 'merchant_current_code', 'merchant_recent_validations',
        'merchant_challenges', 'merchant_redemptions', 'merchant_proposals', 'merchant_billing',
        'lookup_coupon', 'redeem_coupon', 'submit_proposal', 'update_proposal'].includes(f.name);

      if (isAdmin || isMerchant) {
        // una persona con perfil no es staff ni comercio
        const e = await rpcFail(persona, f.name, args);
        assert.match(e.message, /sin_permiso/, `${f.name} debería rechazar a una persona (dio: ${e.message})`);
        assert.equal(e.code, 'PT403', f.name);
        checked[isAdmin ? 'admin' : 'comercio']++;
      } else {
        // funciones de persona: sin perfil no entra nadie
        const e = await rpcFail(sinPerfil, f.name, args);
        assert.match(e.message, /sin_perfil/, `${f.name} debería exigir perfil (dio: ${e.message})`);
        checked.persona++;
      }
    }
    assert.ok(checked.admin >= 35, `se revisaron ${checked.admin} funciones de admin`);
    assert.ok(checked.comercio >= 10, `se revisaron ${checked.comercio} funciones de comercio`);
    assert.ok(checked.persona >= 15, `se revisaron ${checked.persona} funciones de persona`);
  });

  test('un comercio no puede usar funciones de admin ni de otro comercio', async () => {
    const fns = await functions();
    for (const f of fns.filter((x) => x.name.startsWith('admin_'))) {
      const args = {};
      (f.names || []).forEach((n, i) => { args[n] = dummy(f.typenames[i]); });
      const e = await rpcFail(U.cafe, f.name, args);
      assert.match(e.message, /sin_permiso/, f.name);
    }
    const otra = { p_merchant: (await sql("select id from public.merchants where name like 'Panader%' limit 1"))[0].id };
    for (const fn of ['merchant_overview', 'merchant_summary', 'merchant_recent_validations', 'merchant_challenges',
      'merchant_redemptions', 'merchant_proposals', 'merchant_billing']) {
      const e = await rpcFail(U.cafe, fn, otra);
      assert.match(e.message, /sin_permiso/, fn);
    }
    const e = await rpcFail(U.cafe, 'lookup_coupon', { ...otra, p_code: 'AAAA-BBBB' });
    assert.match(e.message, /sin_permiso/);
    const e2 = await rpcFail(U.cafe, 'merchant_current_code', { p_branch: 'b1000000-0000-4000-8000-000000000002' });
    assert.match(e2.message, /sin_permiso/);
  });

  test('un equipo sin permisos no puede hacer lo que requiere permiso o es solo del CEO', async () => {
    const u = await newUser('equipo-vacio');
    await sql(`insert into public.user_roles (user_id, role, perms, display_name) values ($1, 'equipo', '{}', 'Equipo sin permisos')`, [u]);
    const soloCeo = ['admin_list_team', 'admin_register_role', 'admin_update_role', 'admin_billing', 'admin_set_billing_status',
      'admin_add_billing_adjustment', 'admin_list_alerts', 'admin_update_alert', 'admin_integrity_check', 'admin_control_panel',
      'admin_get_config', 'admin_update_config', 'admin_config_history', 'admin_set_pause', 'admin_save_merchant',
      'admin_save_branch', 'admin_set_merchant_status', 'admin_void_visit', 'admin_adjust_pasos', 'admin_cancel_coupon',
      'admin_set_person_status', 'admin_flag_password_reset'];
    const conPermiso = ['admin_list_people', 'admin_person_detail', 'admin_save_challenge', 'admin_save_reward', 'admin_set_photo',
      'admin_list_visits', 'admin_ledger', 'admin_list_coupons', 'admin_list_audit', 'admin_list_challenges'];
    const fns = await functions();
    for (const name of [...soloCeo, ...conPermiso]) {
      const f = fns.find((x) => x.name === name);
      assert.ok(f, `no existe ${name}`);
      const args = {};
      (f.names || []).forEach((n, i) => { args[n] = dummy(f.typenames[i]); });
      const e = await rpcFail(u, name, args);
      assert.match(e.message, /sin_permiso/, name);
    }
    // sí puede ver el panel de inicio y la lista de comercios (cualquier staff)
    assert.equal((await rpc(u, 'admin_dashboard', {})).role, 'equipo');
    assert.ok(Array.isArray(await rpc(u, 'admin_list_merchants', {})));
  });
});
