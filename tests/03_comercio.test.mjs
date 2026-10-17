// Perfil COMERCIO: código dinámico, cupones, propuestas y cobros.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  sql, one, rpc, rpcFail, newUser, newPerson, balance, freshCode, setConfig, visit, end, U, M, B, C, R, uuid,
} from './helpers.mjs';

after(end);
const DEFAULTS = {
  paused: false, daily_cap: 3, require_gps: false, require_merchant_active: false, test_mode: true,
  environment: 'prueba', max_uses_per_code: 4, code_rotation_s: 45, code_grace_s: 30, max_failed_attempts: 5,
  mfa_required: false, fee_per_visit: 200,
};
beforeEach(async () => { await setConfig(DEFAULTS); });

/** Persona con un cupón de "Café con medialuna" listo para usar. */
async function personWithCoupon(reward = R.cafe, pasos = 3000) {
  const u = await newPerson({ pasos });
  const r = await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: reward });
  assert.equal(r.ok, true);
  return { user: u, code: r.code };
}
async function newMerchantAccount(merchant) {
  const u = await newUser('comercio');
  await sql(`insert into public.user_roles (user_id, role, merchant_id, display_name) values ($1, 'comercio', $2, 'Cajero de prueba')`, [u, merchant]);
  return u;
}

describe('código dinámico del local', () => {
  test('muestra un código de 6 dígitos con cuenta regresiva y usos', async () => {
    await freshCode(B.cafe);
    const r = await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    assert.equal(r.ok, true);
    assert.match(r.code, /^\d{6}$/);
    assert.equal(r.rotation_s, 45);
    assert.ok(r.expires_in_s > 0 && r.expires_in_s <= 45);
    assert.equal(r.uses, 0);
    assert.equal(r.max_uses, 4);
    assert.equal(r.validating, true);
    const again = await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    assert.equal(again.code, r.code, 'dentro del período el código no cambia');
  });

  test('rota solo después de la rotación configurada', async () => {
    const a = await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    await sql("update public.visit_codes set rotated_at = now() - interval '44 seconds' where branch_id = $1", [B.cafe]);
    assert.equal((await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe })).code, a.code);
    await sql("update public.visit_codes set rotated_at = now() - interval '46 seconds' where branch_id = $1", [B.cafe]);
    const b = await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    assert.notEqual(b.code, a.code);
    assert.ok(b.expires_in_s >= 44);
    await setConfig({ code_rotation_s: 90 });
    await sql("update public.visit_codes set rotated_at = now() - interval '60 seconds' where branch_id = $1", [B.cafe]);
    assert.equal((await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe })).code, b.code, 'la rotación es configurable');
  });

  test('marca al local como "validando" durante un rato', async () => {
    await sql('update public.visit_codes set active_until = null where branch_id = $1', [B.cafe]);
    await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    const vc = await one("select active_until > now() as vivo, active_until < now() + interval '2 minutes' as corto from public.visit_codes where branch_id = $1", [B.cafe]);
    assert.deepEqual([vc.vivo, vc.corto], [true, true]);
  });

  test('en pausa global no muestra código', async () => {
    await setConfig({ paused: true });
    const r = await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    assert.equal(r.paused, true);
    assert.ok(!('code' in r));
  });

  test('un local suspendido no entrega código y un comercio suspendido queda fuera', async () => {
    await sql("update public.branches set status = 'suspendido' where id = $1", [B.cafe2]);
    try {
      // el usuario del café tiene acceso a ambos locales del mismo comercio
      assert.equal((await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe2 })).reason, 'local_suspendido');
    } finally {
      await sql("update public.branches set status = 'activo' where id = $1", [B.cafe2]);
    }
    await sql("update public.merchants set status = 'suspendido' where id = $1", [M.cafe]);
    try {
      const e = await rpcFail(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
      assert.match(e.message, /comercio_suspendido/);
      const e2 = await rpcFail(U.cafe, 'merchant_summary', { p_merchant: M.cafe });
      assert.match(e2.message, /comercio_suspendido/);
    } finally {
      await sql("update public.merchants set status = 'activo' where id = $1", [M.cafe]);
    }
  });

  test('una cuenta desactivada pierde el acceso de inmediato', async () => {
    const u = await newMerchantAccount(M.cafe);
    assert.ok(await rpc(u, 'merchant_overview', { p_merchant: M.cafe }));
    await sql("update public.user_roles set active = false where user_id = $1", [u]);
    assert.match((await rpcFail(u, 'merchant_overview', { p_merchant: M.cafe })).message, /sin_permiso/);
  });
});

describe('cupones: validar y entregar', () => {
  test('flujo completo: validar, entregar y queda registrado', async () => {
    const { user, code } = await personWithCoupon();
    const lk = await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: code });
    assert.equal(lk.ok, true);
    assert.equal(lk.coupon.reward_title, 'Café con medialuna');
    assert.ok(!JSON.stringify(lk).includes(user), 'no se revela quién es la persona');
    const r = await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: code });
    assert.equal(r.ok, true);
    const c = await one('select * from public.coupons where code = $1', [code]);
    assert.equal(c.status, 'canjeado');
    assert.equal(c.redeemed_by, U.cafe);
    assert.equal(c.redeemed_branch_id, B.cafe);
    const mine = await rpc(user, 'my_coupons');
    assert.equal(mine[0].status, 'canjeado');
    const list = await rpc(U.cafe, 'merchant_redemptions', { p_merchant: M.cafe });
    assert.equal(list.length >= 1, true);
    assert.equal(list[0].code, code);
  });

  test('el código se acepta en minúsculas, sin guion y con espacios', async () => {
    const { code } = await personWithCoupon();
    const raw = ' ' + code.toLowerCase().replace('-', ' ') + ' ';
    assert.equal((await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: raw })).ok, true);
  });

  test('un cupón no se puede usar dos veces (otro empleado) y el doble toque propio no duplica', async () => {
    const { code } = await personWithCoupon();
    const otro = await newMerchantAccount(M.cafe);
    const a = await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code });
    assert.equal(a.ok, true);
    const dobleToque = await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code });
    assert.deepEqual([dobleToque.ok, dobleToque.replay], [true, true]);
    const empleado = await rpc(otro, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code });
    assert.deepEqual([empleado.ok, empleado.reason], [false, 'ya_utilizado']);
    assert.ok(empleado.redeemed_at);
    // pasado un rato, ni siquiera el mismo usuario
    await sql("update public.coupons set redeemed_at = now() - interval '1 minute' where code = $1", [code]);
    assert.equal((await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code })).reason, 'ya_utilizado');
    assert.equal((await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: code })).reason, 'ya_utilizado');
  });

  test('un cupón solo sirve en su comercio', async () => {
    const { code } = await personWithCoupon();
    const r = await rpc(U.pan, 'lookup_coupon', { p_merchant: M.pan, p_code: code });
    assert.equal(r.reason, 'otro_comercio');
    assert.ok(!JSON.stringify(r).includes('Café'), 'no revela datos del otro comercio');
    const r2 = await rpc(U.pan, 'redeem_coupon', { p_merchant: M.pan, p_branch: null, p_code: code });
    assert.equal(r2.reason, 'otro_comercio');
    assert.equal((await one('select status from public.coupons where code = $1', [code])).status, 'pendiente');
  });

  test('códigos inexistentes, vencidos y de otros estados', async () => {
    assert.equal((await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: 'ZZZZ-ZZZZ' })).reason, 'codigo_inexistente');
    assert.equal((await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: '' })).reason, 'codigo_inexistente');
    const { code } = await personWithCoupon();
    await sql("update public.coupons set expires_at = now() - interval '1 second' where code = $1", [code]);
    assert.equal((await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: code })).reason, 'cupon_vencido');
    assert.equal((await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code })).reason, 'cupon_vencido');
    assert.equal((await one('select status from public.coupons where code = $1', [code])).status, 'pendiente');
  });

  test('con la pausa global no se entregan premios', async () => {
    const { code } = await personWithCoupon();
    await setConfig({ paused: true });
    assert.equal((await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code })).reason, 'pausa');
    assert.equal((await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: code })).reason, 'pausa');
    await setConfig({ paused: false });
    assert.equal((await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code })).ok, true);
  });

  test('el local indicado tiene que ser del comercio', async () => {
    const { code } = await personWithCoupon();
    const r = await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.pan, p_code: code });
    assert.equal(r.reason, 'local_invalido');
    assert.equal((await one('select status from public.coupons where code = $1', [code])).status, 'pendiente');
  });

  test('probar muchos códigos al azar bloquea y avisa', async () => {
    const u = await newMerchantAccount(M.lib);
    for (let i = 0; i < 10; i++) {
      assert.equal((await rpc(u, 'lookup_coupon', { p_merchant: M.lib, p_code: `AAAA-${String(1000 + i).replace(/0/g, 'X')}` })).reason, 'codigo_inexistente');
    }
    assert.equal((await rpc(u, 'lookup_coupon', { p_merchant: M.lib, p_code: 'AAAA-AAAA' })).reason, 'demasiados_intentos');
    const a = await one("select * from public.alerts where kind = 'intentos_cupon' and entity_id = $1", [u]);
    assert.ok(a);
  });

  test('entregar un cupón no mueve los PASOS (ya se descontaron al reclamar)', async () => {
    const { user, code } = await personWithCoupon();
    const before = await balance(user);
    await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: null, p_code: code });
    assert.equal(await balance(user), before);
  });
});

describe('resumen y listados: solo datos agregados', () => {
  test('resumen con visitas, cupones y campañas', async () => {
    const a = await newPerson(), b = await newPerson();
    await visit(a, C.cafe, B.cafe);
    await visit(b, C.cafe, B.cafe);
    const s = await rpc(U.cafe, 'merchant_summary', { p_merchant: M.cafe, p_days: 30 });
    assert.ok(s.visits_today >= 2);
    assert.ok(s.visits_7d >= s.visits_today);
    assert.equal(s.series.length, 14);
    assert.ok(s.campaigns.some((c) => c.id === C.cafe));
    assert.ok(!s.campaigns.some((c) => c.id === C.media), 'solo campañas propias');
    assert.equal(typeof s.coupons_pending, 'number');
  });

  test('últimas validaciones sin identidad de las personas', async () => {
    const p = await newPerson({ name: 'Nombre Secreto Zeta' });
    await visit(p, C.cafe, B.cafe);
    const v = await rpc(U.cafe, 'merchant_recent_validations', { p_merchant: M.cafe });
    assert.ok(v.length >= 1);
    const txt = JSON.stringify(v);
    assert.ok(!txt.includes(p) && !txt.includes('Secreto'));
    assert.deepEqual(Object.keys(v[0]).sort(), ['at', 'branch', 'challenge', 'id', 'pasos', 'status']);
  });

  test('los desafíos aprobados se ven pero no hay forma de modificarlos desde Comercio', async () => {
    const list = await rpc(U.cafe, 'merchant_challenges', { p_merchant: M.cafe });
    assert.ok(list.every((c) => ['activo', 'programado', 'pausado', 'finalizado'].includes(c.state)));
    assert.ok(!list.some((c) => c.id === C.lib));
    const fns = await sql(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (proname like 'merchant%' or proname in ('submit_proposal','update_proposal','lookup_coupon','redeem_coupon'))`);
    const names = fns.map((f) => f.proname);
    assert.ok(!names.some((n) => /challenge/.test(n) && /(save|update|set|edit|activate)/.test(n)));
  });
});

describe('propuestas de campañas y premios', () => {
  const campana = { title: 'Desayuno completo', description: 'Visitanos de 8 a 10.', reward_pasos: 700, repeat_rule: 'diaria', quota_total: 100 };
  const premio = { title: 'Café gratis', description: 'Un café.', cost_pasos: 2000, stock: 10, valid_days: 30, conditions: 'Hasta agotar stock.' };

  test('se envía una propuesta y queda "enviada"', async () => {
    const a = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'campana', p_payload: campana });
    assert.equal(a.ok, true);
    const b = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'premio', p_payload: premio });
    assert.equal(b.ok, true);
    const mine = await rpc(U.cafe, 'merchant_proposals', { p_merchant: M.cafe });
    assert.ok(mine.find((p) => p.id === a.id && p.status === 'enviada'));
    // no se creó ningún desafío ni premio: eso lo decide el CEO
    assert.equal((await one("select count(*)::int c from public.challenges where title = 'Desayuno completo'")).c, 0);
    assert.equal((await one("select count(*)::int c from public.rewards where title = 'Café gratis'")).c, 0);
    // otro comercio no ve estas propuestas
    const other = await rpc(U.pan, 'merchant_proposals', { p_merchant: M.pan });
    assert.ok(!other.some((p) => p.id === a.id));
  });

  test('validaciones del formulario', async () => {
    const bad = [
      ['campana', { ...campana, title: 'ab' }, 'title'],
      ['campana', { ...campana, reward_pasos: 0 }, 'reward_pasos'],
      ['campana', { ...campana, reward_pasos: 'mucho' }, 'formato'],
      ['campana', { ...campana, repeat_rule: 'siempre' }, 'repeat_rule'],
      ['campana', { ...campana, quota_total: 0 }, 'quota_total'],
      ['premio', { ...premio, cost_pasos: -5 }, 'cost_pasos'],
      ['premio', { ...premio, stock: -1 }, 'stock'],
      ['premio', { ...premio, valid_days: 1000 }, 'valid_days'],
      ['premio', { ...premio, description: 'x'.repeat(601) }, 'description'],
    ];
    for (const [kind, payload, field] of bad) {
      const r = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: kind, p_payload: payload });
      assert.deepEqual([r.ok, r.reason], [false, 'campo_invalido'], `${kind} ${field}`);
      assert.equal(r.field, field);
    }
    assert.equal((await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'otra', p_payload: campana })).reason, 'tipo_invalido');
  });

  test('solo se edita mientras no la revisaron o si piden cambios', async () => {
    const a = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'campana', p_payload: campana });
    assert.equal((await rpc(U.cafe, 'update_proposal', { p_merchant: M.cafe, p_id: a.id, p_payload: { ...campana, reward_pasos: 650 } })).ok, true);
    await sql("update public.proposals set status = 'aprobada' where id = $1", [a.id]);
    assert.equal((await rpc(U.cafe, 'update_proposal', { p_merchant: M.cafe, p_id: a.id, p_payload: campana })).reason, 'propuesta_no_editable');
    await sql("update public.proposals set status = 'cambios_solicitados' where id = $1", [a.id]);
    assert.equal((await rpc(U.cafe, 'update_proposal', { p_merchant: M.cafe, p_id: a.id, p_payload: campana })).ok, true);
    assert.equal((await one('select status from public.proposals where id = $1', [a.id])).status, 'enviada');
    // y no se puede editar la de otro comercio
    assert.equal((await rpc(U.pan, 'update_proposal', { p_merchant: M.pan, p_id: a.id, p_payload: campana })).reason, 'propuesta_no_encontrada');
  });
});

describe('cobros del comercio', () => {
  test('visitas verificadas x tarifa vigente de cada visita, y el estado', async () => {
    const m = (await one("select id from public.merchants where id = $1", [M.lib])).id;
    const before = (await rpc(U.cafe, 'merchant_billing', { p_merchant: M.cafe }));
    const base = before.find((p) => p.period === new Date().toISOString().slice(0, 7) + '-01') || { visits: 0, total: 0 };
    const a = await newPerson(), b = await newPerson();
    await visit(a, C.cafe, B.cafe);
    await setConfig({ fee_per_visit: 300 });
    await visit(b, C.cafe, B.cafe);
    const after = await rpc(U.cafe, 'merchant_billing', { p_merchant: M.cafe });
    const cur = after[0];
    assert.equal(cur.visits - base.visits, 2);
    assert.equal(Number(cur.total) - Number(base.total), 500);
    assert.equal(cur.status, 'pendiente');
    assert.ok(m);
    // el comercio ve solo lo suyo
    assert.match((await rpcFail(U.cafe, 'merchant_billing', { p_merchant: M.pan })).message, /sin_permiso/);
  });
});

describe('cambio obligatorio de contraseña', () => {
  test('la bandera se apaga una vez cambiada', async () => {
    const u = await newUser('nuevo-comercio');
    await sql(`insert into public.user_roles (user_id, role, merchant_id, display_name, must_change_password) values ($1, 'comercio', $2, 'Nuevo', true)`, [u, M.cafe]);
    assert.equal((await rpc(u, 'my_context')).roles[0].must_change_password, true);
    assert.equal((await rpc(u, 'mark_password_changed')).ok, true);
    assert.equal((await rpc(u, 'my_context')).roles[0].must_change_password, false);
  });
});
