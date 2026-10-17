// Concurrencia: muchas operaciones a la vez no pueden duplicar PASOS, cupones, visitas ni pasarse de stock o cupo.
import { test, describe, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, one, rpc, newPerson, mkChallenge, mkReward, freshCode, balance, ledgerSum, setConfig, getConfig, end, U, M, B, uuid } from './helpers.mjs';

const base = await getConfig();
afterEach(() => setConfig({ daily_cap: base.daily_cap, max_uses_per_code: base.max_uses_per_code, max_failed_attempts: base.max_failed_attempts, paused: false }));
after(end);

const all = (arr) => Promise.allSettled(arr);
const oks = (rs) => rs.filter((r) => r.status === 'fulfilled' && r.value.ok === true).length;
const errs = (rs) => rs.filter((r) => r.status === 'rejected').map((r) => r.reason.message);

describe('PASOS y premios', () => {
  test('una persona lanzando 6 canjes a la vez nunca gasta más de lo que tiene', async () => {
    const p = await newPerson({ pasos: 3500 });
    const rw = await mkReward({ cost: 1000, stock: 50 });
    const rs = await all(Array.from({ length: 6 }, () => rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 3);
    assert.equal(await balance(p), 500);
    assert.equal(await balance(p), await ledgerSum(p));
    assert.equal((await one('select stock from public.rewards where id = $1', [rw])).stock, 47);
  });

  test('stock 2 y 8 personas a la vez: salen exactamente 2 cupones', async () => {
    const rw = await mkReward({ cost: 500, stock: 2 });
    const ps = await Promise.all(Array.from({ length: 8 }, () => newPerson({ pasos: 1000 })));
    const rs = await all(ps.map((p) => rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 2);
    assert.equal((await one('select stock from public.rewards where id = $1', [rw])).stock, 0);
    assert.equal((await one('select count(*)::int c from public.coupons where reward_id = $1', [rw])).c, 2);
    let gastados = 0;
    for (const p of ps) { const b = await balance(p); assert.equal(b, await ledgerSum(p)); gastados += 1000 - b; }
    assert.equal(gastados, 1000);
  });

  test('el mismo reclamo repetido 5 veces a la vez descuenta una sola vez', async () => {
    const p = await newPerson({ pasos: 2000 });
    const rw = await mkReward({ cost: 700, stock: 5 });
    const claim = uuid();
    const rs = await all(Array.from({ length: 5 }, () => rpc(p, 'claim_reward', { p_claim_id: claim, p_reward_id: rw })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 5);
    assert.equal(new Set(rs.map((r) => r.value.code)).size, 1);
    assert.equal(await balance(p), 1300);
    assert.equal((await one('select count(*)::int c from public.coupons where user_id = $1', [p])).c, 1);
  });

  test('límite por persona: 6 canjes simultáneos con tope 2', async () => {
    const p = await newPerson({ pasos: 10000 });
    const rw = await mkReward({ cost: 100, stock: 20, perPerson: 2 });
    const rs = await all(Array.from({ length: 6 }, () => rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw })));
    assert.equal(oks(rs), 2);
  });
});

describe('visitas', () => {
  test('el mismo reclamo de visita 5 veces a la vez acredita una vez', async () => {
    await setConfig({ max_uses_per_code: 50 });
    const ch = await mkChallenge({ reward: 120 });
    const p = await newPerson();
    const code = await freshCode(B.cafe);
    const claim = uuid();
    const rs = await all(Array.from({ length: 5 }, () => rpc(p, 'claim_visit', { p_claim_id: claim, p_challenge_id: ch, p_code: code })));
    assert.deepEqual(errs(rs), []);
    assert.equal(await balance(p), 120);
    assert.equal((await one('select count(*)::int c from public.visits where user_id = $1', [p])).c, 1);
  });

  test('un desafío diario, varios reclamos distintos a la vez: una sola visita por día', async () => {
    await setConfig({ max_uses_per_code: 50 });
    const ch = await mkChallenge({ reward: 80, repeat: 'diaria' });
    const p = await newPerson();
    const code = await freshCode(B.cafe);
    const rs = await all(Array.from({ length: 6 }, () => rpc(p, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: ch, p_code: code })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 1);
    assert.equal(await balance(p), 80);
  });

  test('cupo total 3 con 8 personas a la vez: aceptan 3 y se acreditan 3', async () => {
    await setConfig({ max_uses_per_code: 50 });
    const ch = await mkChallenge({ reward: 60, quota: 3 });
    const ps = await Promise.all(Array.from({ length: 8 }, () => newPerson()));
    // 8 personas intentan aceptar a la vez: solo 3 consiguen lugar
    const acc = await all(ps.map((p) => rpc(p, 'accept_challenge', { p_challenge_id: ch })));
    assert.deepEqual(errs(acc), []);
    assert.equal(oks(acc), 3);
    const code = await freshCode(B.cafe);
    const rs = await all(ps.map((p) => rpc(p, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: ch, p_code: code })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 3);
    assert.equal((await one("select count(*)::int c from public.visits where challenge_id = $1 and status = 'valida'", [ch])).c, 3);
  });

  test('un código con 3 usos máximos acepta a 3 de 8 personas', async () => {
    await setConfig({ max_uses_per_code: 3 });
    const ch = await mkChallenge({ reward: 50 });
    const ps = await Promise.all(Array.from({ length: 8 }, () => newPerson()));
    const code = await freshCode(B.cafe);
    const rs = await all(ps.map((p) => rpc(p, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: ch, p_code: code })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 3);
  });

  test('tope diario 2 con 6 desafíos a la vez: solo 2 se acreditan', async () => {
    await setConfig({ daily_cap: 2, max_uses_per_code: 50 });
    const chs = await Promise.all(Array.from({ length: 6 }, () => mkChallenge({ reward: 40 })));
    const p = await newPerson();
    const code = await freshCode(B.cafe);
    const rs = await all(chs.map((c) => rpc(p, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: c, p_code: code })));
    assert.deepEqual(errs(rs), []);
    assert.equal(oks(rs), 2);
    assert.equal(await balance(p), 80);
  });
});

describe('cupones en el comercio', () => {
  async function cupon(cost = 200) {
    const p = await newPerson({ pasos: 1000 });
    const rw = await mkReward({ cost, stock: 5 });
    const r = await rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw });
    assert.equal(r.ok, true);
    return { p, code: r.code, id: r.coupon_id };
  }

  test('6 empleados entregando el mismo cupón a la vez: solo uno lo logra', async () => {
    const c = await cupon();
    const rs = await all(Array.from({ length: 6 }, (_, i) => rpc(i % 2 ? U.cafe : U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: c.code })));
    assert.deepEqual(errs(rs), []);
    assert.ok(oks(rs) >= 1);
    assert.equal((await one("select count(*)::int n from public.coupons where id = $1 and status = 'canjeado'", [c.id])).n, 1);
    // los demás no registran un segundo canje
    assert.equal((await one('select count(*)::int n from public.coupons where id = $1 and redeemed_at is not null', [c.id])).n, 1);
  });

  test('anular desde el panel y entregar a la vez: queda un solo resultado coherente', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await cupon(300);
      const [a, b] = await all([
        rpc(U.ceo, 'admin_cancel_coupon', { p_id: c.id, p_reason: 'Anulación por prueba' }),
        rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: c.code }),
      ]);
      assert.ok(a.status === 'fulfilled' && b.status === 'fulfilled');
      const row = await one('select status from public.coupons where id = $1', [c.id]);
      const bal = await balance(c.p);
      assert.equal(bal, await ledgerSum(c.p));
      if (row.status === 'canjeado') assert.equal(bal, 700, 'se entregó: no hay devolución');
      else { assert.equal(row.status, 'anulado'); assert.equal(bal, 1000, 'se anuló: devolvió los PASOS'); }
    }
  });

  test('la persona cancela su cupón y el comercio lo entrega a la vez', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await cupon(300);
      await all([
        rpc(c.p, 'cancel_coupon', { p_coupon_id: c.id }),
        rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: c.code }),
      ]);
      const row = await one('select status from public.coupons where id = $1', [c.id]);
      const bal = await balance(c.p);
      assert.equal(bal, await ledgerSum(c.p));
      assert.equal(bal, row.status === 'canjeado' ? 700 : 1000, row.status);
    }
  });
});

test('al final, la integridad general está intacta', async () => {
  const chk = await rpc(U.ceo, 'admin_integrity_check', {});
  assert.equal(chk.wallets_mismatch, 0);
  assert.equal(chk.ledger_without_wallet, 0);
  assert.equal(chk.audit_chain.ok, true);
});
