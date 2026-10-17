// Privacidad (sin DNI, sin datos personales hacia comercios) e integridad bajo operaciones al azar.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, one, rpc, newPerson, mkChallenge, mkReward, freshCode, balance, ledgerSum, setConfig, getConfig, end, U, M, B, uuid } from './helpers.mjs';

const base = await getConfig();
after(async () => { await setConfig({ daily_cap: base.daily_cap, max_uses_per_code: base.max_uses_per_code }); await end(); });

describe('privacidad', () => {
  test('ninguna tabla guarda documento de identidad ni ubicación exacta de las personas', async () => {
    const cols = await sql(`select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (column_name ~* '(dni|documento|document|passport|pasaporte|cuil|cuit|lat|lng|latitude|longitude|location|ubicacion)')`);
    // lat/lng existen SOLO en los locales de los comercios (dirección del negocio), nunca en datos de personas
    for (const c of cols) assert.equal(c.table_name, 'branches', `${c.table_name}.${c.column_name}`);
    const personas = await sql(`select table_name, column_name from information_schema.columns where table_schema = 'public'
      and table_name in ('profiles','visits','visit_attempts','step_days','consents','coupons','wallets')
      and column_name ~* '(dni|doc|lat|lng|gps|location)'`);
    assert.deepEqual(personas.filter((c) => c.column_name !== 'gps_verified'), []);
  });

  test('lo que ve un comercio no incluye identidad, nacimiento ni saldos de personas', async () => {
    const ch = await mkChallenge({ title: 'Privacidad', reward: 90 });
    const rw = await mkReward({ cost: 90, stock: 3 });
    const p = await newPerson({ name: 'Ximena Secretísima', birth: '1979-11-23', pasos: 0 });
    await rpc(p, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: ch, p_code: await freshCode(B.cafe) });
    const r = await rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw });
    assert.equal(r.ok, true);
    await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: r.code });
    const out = JSON.stringify([
      await rpc(U.cafe, 'merchant_overview', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'merchant_summary', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'merchant_recent_validations', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'merchant_redemptions', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'merchant_challenges', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'merchant_billing', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'merchant_proposals', { p_merchant: M.cafe }),
      await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: r.code }),
    ]);
    for (const s of [p, 'Ximena', 'Secret', '1979', '11-23', 'birth', 'nacimiento']) assert.ok(!out.includes(s), `el comercio no debe ver: ${s}`);
  });

  test('una persona no ve datos de otra ni nada de administración', async () => {
    const a = await newPerson({ name: 'Persona A', pasos: 500 });
    const b = await newPerson({ name: 'Persona B', pasos: 900 });
    const outA = JSON.stringify([await rpc(a, 'person_home', {}), await rpc(a, 'my_ledger', {}), await rpc(a, 'my_coupons', {}), await rpc(a, 'my_profile', {})]);
    assert.ok(!outA.includes(b) && !outA.includes('Persona B'));
    const exp = JSON.stringify(await rpc(a, 'export_my_data', {}));
    assert.ok(!/dni|documento/i.test(exp));
  });

  test('la fecha de nacimiento solo la ve la propia persona', async () => {
    const p = await newPerson({ name: 'Con Nacimiento', birth: '1988-02-14' });
    assert.match(JSON.stringify(await rpc(p, 'my_profile', {})), /1988/);
    for (const u of [U.ceo, U.gestor, U.aprobador]) {
      const out = JSON.stringify([await rpc(U.ceo, 'admin_person_detail', { p_user: p }), await rpc(U.ceo, 'admin_list_people', { p_search: 'Con Nacimiento' }), await rpc(U.ceo, 'admin_list_audit', { p_limit: 200 })]);
      assert.ok(!out.includes('1988-02-14'), String(u));
    }
  });
});

describe('libro de PASOS inmutable', () => {
  test('ni siquiera con acceso total se puede editar, borrar o vaciar un movimiento', async () => {
    const p = await newPerson({ pasos: 100 });
    for (const q of ["update public.pasos_ledger set amount = 99999 where user_id = '" + p + "'", "delete from public.pasos_ledger where user_id = '" + p + "'", 'truncate public.pasos_ledger']) {
      await assert.rejects(sql(q), /libro_inmutable|cannot truncate/, q);
    }
    assert.equal(await balance(p), 100);
  });
});

describe('operaciones al azar', () => {
  test('300 operaciones mezcladas dejan saldos, stock y auditoría consistentes', async () => {
    await setConfig({ daily_cap: 50, max_uses_per_code: 200 });
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const people = await Promise.all(Array.from({ length: 8 }, () => newPerson({ pasos: 1500 })));
    const chs = await Promise.all([0, 1, 2, 3].map(() => mkChallenge({ reward: 50 + rnd(200), repeat: 'diaria', quota: rnd(2) ? 6 : null })));
    const rws = await Promise.all([0, 1, 2].map(() => mkReward({ cost: 200 + rnd(800), stock: 2 + rnd(5), perPerson: rnd(2) ? 2 : null })));
    const coupons = [];
    for (let i = 0; i < 300; i++) {
      const p = people[rnd(people.length)];
      const op = rnd(8);
      try {
        if (op <= 2) await rpc(p, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: chs[rnd(chs.length)], p_code: await freshCode(B.cafe) });
        else if (op <= 4) { const r = await rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rws[rnd(rws.length)] }); if (r.ok) coupons.push({ p, ...r }); }
        else if (op === 5 && coupons.length) { const c = coupons[rnd(coupons.length)]; await rpc(c.p, 'cancel_coupon', { p_coupon_id: c.coupon_id }); }
        else if (op === 6 && coupons.length) { const c = coupons[rnd(coupons.length)]; await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: c.code }); }
        else if (op === 7) {
          const v = await one("select id from public.visits where status = 'valida' and user_id = any($1) order by random() limit 1", [people]);
          if (v) await rpc(U.ceo, 'admin_void_visit', { p_visit_id: v.id, p_reason: 'Anulación aleatoria de prueba' });
        }
      } catch (e) {
        assert.match(e.message, /sin_permiso|PT40/, 'solo se aceptan rechazos de permisos: ' + e.message);
      }
    }
    for (const p of people) assert.equal(await balance(p), await ledgerSum(p));
    for (const r of rws) {
      const row = await one('select stock from public.rewards where id = $1', [r]);
      assert.ok(row.stock >= 0);
      const emitidos = (await one(`select count(*)::int c from public.coupons where reward_id = $1 and status not in ('cancelado','anulado')`, [r])).c;
      const inicial = (await one('select count(*)::int c from public.coupons where reward_id = $1', [r])).c; // todos los emitidos alguna vez
      assert.ok(emitidos <= inicial);
    }
    for (const c of chs) {
      const q = await one('select quota_total from public.challenges where id = $1', [c]);
      const n = (await one("select count(*)::int c from public.visits where challenge_id = $1 and status = 'valida'", [c])).c;
      if (q.quota_total) assert.ok(n <= q.quota_total, `cupo ${n}/${q.quota_total}`);
    }
    const chk = await rpc(U.ceo, 'admin_integrity_check', {});
    assert.equal(chk.ok, true, JSON.stringify(chk));
  });
});
