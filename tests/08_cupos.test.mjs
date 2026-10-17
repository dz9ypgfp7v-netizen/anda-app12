// Desafíos con cupo: aceptar = reservar un lugar con vencimiento; el desafío desaparece para el resto cuando se ocupa todo.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, one, rpc, newPerson, balance, mkChallenge, setConfig, visit, end, B } from './helpers.mjs';

after(end);
beforeEach(() => setConfig({ paused: false, daily_cap: 3, max_uses_per_code: 50, acceptance_hours: 24, test_mode: true }));

const listed = async (uid) => (await rpc(uid, 'list_challenges')).map((c) => c.id);
const find = async (uid, id) => (await rpc(uid, 'list_challenges')).find((c) => c.id === id);

describe('desafíos con cupo', () => {
  test('sin cupo no hay nada que aceptar', async () => {
    const ch = await mkChallenge({});
    const p = await newPerson();
    assert.equal((await rpc(p, 'accept_challenge', { p_challenge_id: ch })).reason, 'no_requiere_aceptar');
    assert.equal((await find(p, ch)).requires_acceptance, false);
  });

  test('aceptar reserva un lugar con vencimiento y descuenta del cupo visible', async () => {
    const ch = await mkChallenge({ quota: 3 });
    const [a, b] = [await newPerson(), await newPerson()];
    assert.equal((await find(a, ch)).quota_left, 3);
    const r = await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    assert.equal(r.ok, true);
    assert.equal(r.slots_left, 2);
    const horas = (new Date(r.expires_at) - Date.now()) / 3600000;
    assert.ok(horas > 23 && horas <= 24, `vence en ${horas} h`);
    assert.equal((await find(b, ch)).quota_left, 2);
    assert.ok((await find(a, ch)).my_acceptance);
    assert.equal((await find(b, ch)).my_acceptance, null);
  });

  test('aceptar dos veces no ocupa dos lugares', async () => {
    const ch = await mkChallenge({ quota: 2 });
    const a = await newPerson();
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    const r2 = await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    assert.equal(r2.ok, true);
    assert.equal(r2.already, true);
    assert.equal((await find(await newPerson(), ch)).quota_left, 1);
  });

  test('sin aceptar no se puede reclamar, aunque haya lugar', async () => {
    const ch = await mkChallenge({ quota: 5 });
    const p = await newPerson();
    assert.equal((await visit(p, ch, B.cafe)).reason, 'requiere_aceptar');
    assert.equal(await balance(p), 0);
  });

  test('cuando se ocupan todos los lugares el desafío desaparece para quien no lo aceptó, pero no para quien sí', async () => {
    const ch = await mkChallenge({ quota: 2 });
    const [a, b, c] = [await newPerson(), await newPerson(), await newPerson()];
    assert.ok((await listed(c)).includes(ch));
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    await rpc(b, 'accept_challenge', { p_challenge_id: ch });
    assert.ok(!(await listed(c)).includes(ch), 'a la tercera persona ya no le aparece');
    assert.ok((await listed(a)).includes(ch), 'quien aceptó lo sigue viendo');
    assert.equal((await rpc(c, 'accept_challenge', { p_challenge_id: ch })).reason, 'cupo_agotado');
    // el mapa de comercios tampoco lo muestra
    const mapa = await rpc(c, 'list_merchants_map');
    assert.ok(!mapa.flatMap((m) => m.challenges.map((x) => x.id)).includes(ch));
  });

  test('si alguien suelta su lugar, queda libre para otra persona', async () => {
    const ch = await mkChallenge({ quota: 1 });
    const [a, b] = [await newPerson(), await newPerson()];
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    assert.equal((await rpc(b, 'accept_challenge', { p_challenge_id: ch })).reason, 'cupo_agotado');
    assert.equal((await rpc(a, 'cancel_acceptance', { p_challenge_id: ch })).ok, true);
    assert.ok((await listed(b)).includes(ch));
    assert.equal((await rpc(b, 'accept_challenge', { p_challenge_id: ch })).ok, true);
    assert.equal((await rpc(a, 'cancel_acceptance', { p_challenge_id: ch })).reason, 'aceptacion_no_encontrada');
  });

  test('una reserva vencida libera el lugar y ya no permite reclamar', async () => {
    const ch = await mkChallenge({ quota: 1 });
    const [a, b] = [await newPerson(), await newPerson()];
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    await sql("update public.challenge_acceptances set expires_at = now() - interval '1 minute' where challenge_id = $1", [ch]);
    assert.ok((await listed(b)).includes(ch), 'el lugar vencido vuelve a estar disponible');
    assert.equal((await visit(a, ch, B.cafe)).reason, 'aceptacion_vencida');
    assert.equal(await balance(a), 0);
    assert.equal((await rpc(b, 'accept_challenge', { p_challenge_id: ch })).ok, true);
  });

  test('completar el desafío consume el lugar para siempre (no se libera ni vence)', async () => {
    const ch = await mkChallenge({ quota: 1, repeat: 'una_vez' });
    const [a, b] = [await newPerson(), await newPerson()];
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    assert.equal((await visit(a, ch, B.cafe)).ok, true);
    await sql("update public.challenge_acceptances set expires_at = now() - interval '1 day' where challenge_id = $1", [ch]);
    assert.equal((await rpc(b, 'accept_challenge', { p_challenge_id: ch })).reason, 'cupo_agotado');
    assert.ok(!(await listed(b)).includes(ch));
  });

  test('respeta las reglas por persona: no se puede aceptar si ya lo completó (una vez)', async () => {
    const ch = await mkChallenge({ quota: 5, repeat: 'una_vez' });
    const a = await newPerson();
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    await visit(a, ch, B.cafe);
    await sql("update public.challenge_acceptances set status = 'cancelada' where challenge_id = $1", [ch]);
    assert.equal((await rpc(a, 'accept_challenge', { p_challenge_id: ch })).reason, 'ya_acreditado');
  });

  test('en pausa no se acepta; un desafío no activo tampoco', async () => {
    const ch = await mkChallenge({ quota: 2 });
    const borrador = await mkChallenge({ quota: 2, status: 'borrador' });
    const p = await newPerson();
    assert.equal((await rpc(p, 'accept_challenge', { p_challenge_id: borrador })).reason, 'desafio_no_disponible');
    await setConfig({ paused: true });
    assert.equal((await rpc(p, 'accept_challenge', { p_challenge_id: ch })).reason, 'pausa');
  });

  test('meta de pasos con cupo: también exige aceptar y consume el lugar', async () => {
    const ch = await mkChallenge({ type: 'meta_pasos', merchant: null, goal: 1000, quota: 1, reward: 70 });
    const [p, q] = [await newPerson(), await newPerson()];
    await rpc(p, 'test_add_steps', { p_amount: 2000 });
    const claim = () => rpc(p, 'claim_step_goal', { p_claim_id: crypto.randomUUID(), p_challenge_id: ch });
    assert.equal((await claim()).reason, 'requiere_aceptar');
    assert.equal(await balance(p), 0);
    assert.equal((await rpc(p, 'accept_challenge', { p_challenge_id: ch })).ok, true);
    assert.equal((await claim()).ok, true);
    assert.equal(await balance(p), 70);
    assert.equal((await rpc(q, 'accept_challenge', { p_challenge_id: ch })).reason, 'cupo_agotado');
  });

  test('8 personas aceptan a la vez un desafío con 3 lugares: solo 3 lo consiguen', async () => {
    const ch = await mkChallenge({ quota: 3 });
    const ps = await Promise.all(Array.from({ length: 8 }, () => newPerson()));
    const rs = await Promise.allSettled(ps.map((p) => rpc(p, 'accept_challenge', { p_challenge_id: ch })));
    assert.ok(rs.every((r) => r.status === 'fulfilled'));
    assert.equal(rs.filter((r) => r.value.ok).length, 3);
    assert.equal(rs.filter((r) => r.value.reason === 'cupo_agotado').length, 5);
    assert.equal(Number((await one("select count(*) c from public.challenge_acceptances where challenge_id = $1 and status = 'activa'", [ch])).c), 3);
  });

  test('una persona no puede ver ni soltar la reserva de otra', async () => {
    const ch = await mkChallenge({ quota: 2 });
    const [a, b] = [await newPerson(), await newPerson()];
    await rpc(a, 'accept_challenge', { p_challenge_id: ch });
    assert.equal((await rpc(b, 'cancel_acceptance', { p_challenge_id: ch })).reason, 'aceptacion_no_encontrada');
    assert.ok((await find(a, ch)).my_acceptance);
  });
});
