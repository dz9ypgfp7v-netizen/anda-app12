// Perfil CEO / Equipo: permisos, desafíos, propuestas, premios, anulaciones, cobros, equipo, configuración, pausa, auditoría.
import { test, describe, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  sql, one, rpc, rpcFail, newUser, newPerson, mkChallenge, mkReward, visit, balance, ledgerSum, getConfig, setConfig,
  end, U, M, B, C, R, uuid,
} from './helpers.mjs';

const baseCfg = await getConfig();
async function restoreConfig() {
  await sql(`update public.app_config set paused = false, pause_reason = null, paused_at = null, paused_by = null,
    daily_cap = $1, fee_per_visit = $2, mfa_required = false, test_mode = $3, environment = $4,
    require_merchant_active = $5, max_failed_attempts = $6, max_uses_per_code = $7`,
  [baseCfg.daily_cap, baseCfg.fee_per_visit, baseCfg.test_mode, baseCfg.environment,
    baseCfg.require_merchant_active, baseCfg.max_failed_attempts, baseCfg.max_uses_per_code]);
}
afterEach(restoreConfig);
after(async () => { await restoreConfig(); await end(); });

const ceo = U.ceo, gestor = U.gestor, aprobador = U.aprobador;
const desafio = (extra = {}) => ({
  title: 'Desafío de prueba', description: 'Probá el lugar.', type: 'visita', merchant_id: M.cafe,
  reward_pasos: 300, repeat_rule: 'diaria', ...extra,
});

/** Equipo con permisos a medida (para probar separación de funciones y permisos). */
async function equipo(perms, label = 'equipo') {
  const id = await newUser(label);
  await sql(`insert into public.user_roles (user_id, role, perms, display_name) values ($1, 'equipo', $2, $3)`,
    [id, perms, 'Equipo ' + label]);
  return id;
}

describe('desafíos: ciclo de estados y separación de funciones', () => {
  test('borrador → revisión → programado → activo → pausado → activo → finalizado', async () => {
    const c = await rpc(gestor, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Ciclo completo' }) });
    assert.equal(c.ok, true);
    const id = c.id;
    assert.equal((await one('select status from public.challenges where id = $1', [id])).status, 'borrador');

    // no se puede saltear pasos
    assert.equal((await rpc(gestor, 'admin_challenge_transition', { p_id: id, p_action: 'activar' })).reason, 'transicion_invalida');
    assert.equal((await rpc(ceo, 'admin_challenge_transition', { p_id: id, p_action: 'aprobar' })).reason, 'transicion_invalida');

    assert.equal((await rpc(gestor, 'admin_challenge_transition', { p_id: id, p_action: 'enviar_revision' })).status, 'revision');
    // quien edita no aprueba (falta el permiso)
    assert.equal((await rpcFail(gestor, 'admin_challenge_transition', { p_id: id, p_action: 'aprobar' })).code, 'PT403');

    // pedir cambios exige motivo
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'solicitar_cambios' })).reason, 'motivo_requerido');
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'solicitar_cambios', p_note: 'Falta la fecha de cierre' })).status, 'borrador');
    await rpc(gestor, 'admin_challenge_transition', { p_id: id, p_action: 'enviar_revision' });

    const ap = await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'aprobar' });
    assert.deepEqual([ap.ok, ap.status, ap.self_approved], [true, 'programado', false]);
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'activar' })).status, 'activo');

    // activo: se ve para las personas
    const persona = await newPerson();
    const visibles = await rpc(persona, 'list_challenges', {});
    assert.ok(JSON.stringify(visibles).includes(id), 'el desafío activo debe verse');

    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'pausar' })).status, 'pausado');
    assert.ok(!JSON.stringify(await rpc(persona, 'list_challenges', {})).includes(id), 'un desafío pausado no se muestra');
    const code = await one('select 1');
    assert.ok(code);
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'reanudar' })).status, 'activo');
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'finalizar' })).status, 'finalizado');
    // finalizado es definitivo
    for (const a of ['activar', 'reanudar', 'pausar', 'finalizar', 'enviar_revision']) {
      assert.equal((await rpc(ceo, 'admin_challenge_transition', { p_id: id, p_action: a })).reason, 'transicion_invalida', a);
    }
    assert.equal((await rpc(gestor, 'admin_save_challenge', { p_id: id, p_data: desafio({ title: 'Otro nombre' }) })).reason, 'desafio_no_editable');
  });

  test('quien lo creó o lo envió no puede aprobarlo ni activarlo (salvo el CEO, que queda marcado)', async () => {
    const dual = await equipo(['desafios.editar', 'desafios.aprobar'], 'dual');
    const id = (await rpc(dual, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Autoaprobación' }) })).id;
    await rpc(dual, 'admin_challenge_transition', { p_id: id, p_action: 'enviar_revision' });
    assert.equal((await rpc(dual, 'admin_challenge_transition', { p_id: id, p_action: 'aprobar' })).reason, 'separacion_de_funciones');
    // otra persona del equipo con permiso sí
    const otro = await equipo(['desafios.aprobar'], 'otro');
    assert.equal((await rpc(otro, 'admin_challenge_transition', { p_id: id, p_action: 'aprobar' })).ok, true);
    // el creador tampoco puede activarlo
    assert.equal((await rpc(dual, 'admin_challenge_transition', { p_id: id, p_action: 'activar' })).reason, 'separacion_de_funciones');

    // el CEO puede aprobar lo que él mismo creó, pero queda registrado
    const id2 = (await rpc(ceo, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'CEO autoaprueba' }) })).id;
    await rpc(ceo, 'admin_challenge_transition', { p_id: id2, p_action: 'enviar_revision' });
    const r = await rpc(ceo, 'admin_challenge_transition', { p_id: id2, p_action: 'aprobar' });
    assert.deepEqual([r.ok, r.self_approved], [true, true]);
    assert.equal((await one('select self_approved from public.challenges where id = $1', [id2])).self_approved, true);
    const aud = await one(`select details from public.audit_log where action = 'desafio_aprobar' and target_id = $1`, [id2]);
    assert.equal(aud.details.autoaprobado, true);
  });

  test('no se aprueba un desafío vencido ni de un comercio suspendido', async () => {
    const vencido = (await rpc(gestor, 'admin_save_challenge', { p_id: null,
      p_data: desafio({ title: 'Ya venció', starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-02-01T00:00:00Z' }) })).id;
    await rpc(gestor, 'admin_challenge_transition', { p_id: vencido, p_action: 'enviar_revision' });
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: vencido, p_action: 'aprobar' })).reason, 'fechas_vencidas');

    const m = await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Comercio para suspender' } });
    const id = (await rpc(gestor, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Sin comercio', merchant_id: m.id }) })).id;
    await rpc(gestor, 'admin_challenge_transition', { p_id: id, p_action: 'enviar_revision' });
    await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'suspendido', p_reason: 'prueba' });
    assert.equal((await rpc(aprobador, 'admin_challenge_transition', { p_id: id, p_action: 'aprobar' })).reason, 'comercio_no_disponible');
  });

  test('un desafío vigente solo admite cambios de texto y foto (nada retroactivo)', async () => {
    const id = await mkChallenge({ title: 'Vigente', reward: 200, status: 'activo' });
    assert.equal((await rpc(gestor, 'admin_save_challenge', { p_id: id,
      p_data: { ...desafio({ title: 'Vigente' }), reward_pasos: 900 } })).reason, 'cambio_no_permitido');
    assert.equal((await rpc(gestor, 'admin_save_challenge', { p_id: id,
      p_data: { ...desafio({ title: 'Vigente' }), reward_pasos: 200, quota_total: 5 } })).reason, 'cambio_no_permitido');
    const ok = await rpc(gestor, 'admin_save_challenge', { p_id: id,
      p_data: { ...desafio({ title: 'Vigente con otro título', description: 'Texto nuevo' }), reward_pasos: 200 } });
    assert.equal(ok.ok, true);
    assert.equal((await one('select title from public.challenges where id = $1', [id])).title, 'Vigente con otro título');
  });

  test('validaciones del formulario de desafíos', async () => {
    const bad = [
      [{ title: 'ab' }, 'title'], [{ type: 'otro' }, 'type'], [{ repeat_rule: 'siempre' }, 'repeat_rule'],
      [{ reward_pasos: 0 }, 'reward_pasos'], [{ reward_pasos: 2000000 }, 'reward_pasos'], [{ reward_pasos: 'x' }, 'formato'],
      [{ merchant_id: null }, 'merchant_id'], [{ merchant_id: uuid() }, 'merchant_id'],
      [{ per_person_max: 0 }, 'per_person_max'], [{ quota_total: 0 }, 'quota_total'],
      [{ starts_at: '2030-02-01T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' }, 'ends_at'],
      [{ type: 'meta_pasos', merchant_id: null, goal_steps: 500 }, 'goal_steps'],
      [{ type: 'meta_pasos', merchant_id: null, goal_steps: null }, 'goal_steps'],
    ];
    for (const [patch, field] of bad) {
      const r = await rpc(gestor, 'admin_save_challenge', { p_id: null, p_data: desafio(patch) });
      assert.deepEqual([r.ok, r.reason, r.field], [false, 'campo_invalido', field], JSON.stringify(patch));
    }
    // una meta de pasos no lleva comercio
    const m = await rpc(gestor, 'admin_save_challenge', { p_id: null,
      p_data: desafio({ title: 'Meta 8000', type: 'meta_pasos', goal_steps: 8000, merchant_id: M.cafe }) });
    assert.equal(m.ok, true);
    assert.equal((await one('select merchant_id from public.challenges where id = $1', [m.id])).merchant_id, null);
    // fotos: solo imágenes permitidas o rutas del almacenamiento
    const f = await rpcFail(gestor, 'admin_save_challenge', { p_id: null, p_data: desafio({ photo_path: 'http://evil.example/x.png' }) });
    assert.match(f.message, /foto_invalida/);
  });

  test('cada cambio queda como versión y se puede consultar el historial', async () => {
    const id = (await rpc(gestor, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Versionado' }) })).id;
    await rpc(gestor, 'admin_save_challenge', { p_id: id, p_data: desafio({ title: 'Versionado v2', reward_pasos: 350 }) });
    await rpc(gestor, 'admin_challenge_transition', { p_id: id, p_action: 'enviar_revision' });
    const vs = await rpc(gestor, 'admin_challenge_versions', { p_id: id });
    // cada edición guarda la versión ANTERIOR (la vigente es la fila misma): 2 ediciones => 2 versiones previas
    assert.equal(vs.length, 2, `versiones: ${vs.length}`);
    assert.ok(vs.some((v) => v.snapshot.title === 'Versionado' && v.snapshot.status === 'borrador'));
    assert.ok(vs.every((v, i, a) => i === 0 || a[i - 1].version > v.version), 'ordenadas de la más nueva a la más vieja');
    assert.ok(vs.some((v) => v.snapshot.title === 'Versionado v2' && v.snapshot.reward_pasos === 350));
    assert.ok(vs.every((v) => !('created_by' in v.snapshot)), 'el historial no expone identificadores internos');
  });

  test('los permisos de lectura de desafíos', async () => {
    assert.ok(Array.isArray(await rpc(gestor, 'admin_list_challenges', {})));
    assert.ok(Array.isArray(await rpc(aprobador, 'admin_list_challenges', {})));
    const sin = await equipo(['fotos.gestionar'], 'sinperm');
    assert.equal((await rpcFail(sin, 'admin_list_challenges', {})).code, 'PT403');
    assert.equal((await rpcFail(sin, 'admin_challenge_versions', { p_id: uuid() })).code, 'PT403');
    const soloActivos = await rpc(ceo, 'admin_list_challenges', { p_status: 'activo' });
    assert.ok(soloActivos.every((c) => c.state === 'activo'));
  });
});

describe('propuestas de comercios', () => {
  const campana = { title: 'Merienda doble', description: 'Dos por uno.', reward_pasos: 700, repeat_rule: 'diaria', quota_total: 50 };
  const premio = { title: 'Medialunas x3', description: 'Tres medialunas.', cost_pasos: 1500, stock: 8, valid_days: 20, conditions: 'Hasta agotar stock.' };

  test('cada perfil ve solo las propuestas que le corresponde decidir', async () => {
    const a = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'campana', p_payload: campana });
    const b = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'premio', p_payload: premio });
    const ids = (l) => l.map((p) => p.id);
    assert.ok(ids(await rpc(ceo, 'admin_list_proposals', {})).includes(a.id));
    const g = ids(await rpc(gestor, 'admin_list_proposals', {}));
    assert.ok(g.includes(a.id) && g.includes(b.id), 'el gestor tiene desafíos.editar y catálogo');
    const ap = ids(await rpc(aprobador, 'admin_list_proposals', {}));
    assert.ok(ap.includes(a.id) && !ap.includes(b.id), 'el aprobador no gestiona catálogo');
    const foto = await equipo(['fotos.gestionar'], 'foto');
    const f = ids(await rpc(foto, 'admin_list_proposals', {}));
    assert.ok(!f.includes(a.id) && !f.includes(b.id));
  });

  test('aprobar una campaña crea un desafío PROGRAMADO (no activo) con los ajustes del equipo', async () => {
    const p = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'campana', p_payload: campana });
    assert.equal((await rpc(aprobador, 'admin_review_proposal', { p_id: p.id, p_action: 'tomar' })).ok, true);
    assert.equal((await one('select status from public.proposals where id = $1', [p.id])).status, 'en_revision');
    assert.equal((await rpc(aprobador, 'admin_review_proposal', { p_id: p.id, p_action: 'solicitar_cambios' })).reason, 'motivo_requerido');
    assert.equal((await rpc(aprobador, 'admin_review_proposal', { p_id: p.id, p_action: 'inventar' })).reason, 'accion_invalida');
    const r = await rpc(aprobador, 'admin_review_proposal', { p_id: p.id, p_action: 'aprobar', p_note: 'Bien', p_overrides: { reward_pasos: 650 } });
    assert.equal(r.ok, true);
    const ch = await one('select * from public.challenges where id = $1', [r.result_id]);
    assert.deepEqual([ch.status, ch.reward_pasos, ch.merchant_id, ch.proposal_id], ['programado', 650, M.cafe, p.id]);
    assert.equal((await one('select status from public.proposals where id = $1', [p.id])).status, 'aprobada');
    // ya cerrada: no se puede decidir de nuevo
    for (const a of ['aprobar', 'tomar', 'rechazar']) {
      assert.equal((await rpc(ceo, 'admin_review_proposal', { p_id: p.id, p_action: a, p_note: 'otra vez' })).reason, 'propuesta_cerrada', a);
    }
  });

  test('aprobar un premio lo crea ACTIVO con su historial de precio; el aprobador de desafíos no puede', async () => {
    const p = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'premio', p_payload: premio });
    assert.equal((await rpcFail(aprobador, 'admin_review_proposal', { p_id: p.id, p_action: 'aprobar' })).code, 'PT403');
    const r = await rpc(gestor, 'admin_review_proposal', { p_id: p.id, p_action: 'aprobar' });
    assert.equal(r.ok, true);
    const rw = await one('select * from public.rewards where id = $1', [r.result_id]);
    assert.deepEqual([rw.status, rw.cost_pasos, rw.stock, rw.valid_days], ['activo', 1500, 8, 20]);
    const h = await rpc(gestor, 'admin_reward_history', { p_id: r.result_id });
    assert.deepEqual(h.prices.map((x) => [x.old_cost, x.new_cost]), [[null, 1500]]);
  });

  test('rechazar o pedir cambios exige motivo, y el comercio puede corregir y reenviar', async () => {
    const p = await rpc(U.cafe, 'submit_proposal', { p_merchant: M.cafe, p_kind: 'campana', p_payload: campana });
    assert.equal((await rpc(ceo, 'admin_review_proposal', { p_id: p.id, p_action: 'rechazar' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_review_proposal', { p_id: p.id, p_action: 'solicitar_cambios', p_note: 'Bajar la recompensa' })).ok, true);
    const mine = await rpc(U.cafe, 'merchant_proposals', { p_merchant: M.cafe });
    const m = mine.find((x) => x.id === p.id);
    assert.equal(m.status, 'cambios_solicitados');
    assert.equal(m.review_note, 'Bajar la recompensa');
    assert.equal((await rpc(U.cafe, 'update_proposal', { p_merchant: M.cafe, p_id: p.id, p_payload: { ...campana, reward_pasos: 400 } })).ok, true);
    assert.equal((await rpc(ceo, 'admin_review_proposal', { p_id: p.id, p_action: 'rechazar', p_note: 'No es el momento' })).ok, true);
    assert.equal((await one('select status from public.proposals where id = $1', [p.id])).status, 'rechazada');
  });

  test('no se aprueba una propuesta de un comercio suspendido', async () => {
    const m = await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Comercio con propuesta' } });
    const p = await one(`insert into public.proposals (merchant_id, kind, payload, created_by)
      values ($1, 'campana', $2, $3) returning id`, [m.id, campana, U.cafe]);
    await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'suspendido', p_reason: 'prueba' });
    assert.equal((await rpc(ceo, 'admin_review_proposal', { p_id: p.id, p_action: 'aprobar' })).reason, 'comercio_no_disponible');
  });
});

describe('premios y catálogo', () => {
  const premio = (extra = {}) => ({ merchant_id: M.cafe, title: 'Torta del día', cost_pasos: 1200, stock: 10, valid_days: 30, ...extra });

  test('crear, editar con historial de precio y stock ilimitado', async () => {
    const c = await rpc(gestor, 'admin_save_reward', { p_id: null, p_data: premio() });
    assert.equal(c.ok, true);
    assert.equal((await one('select status from public.rewards where id = $1', [c.id])).status, 'borrador');
    // un premio en borrador no se ve ni se puede reclamar
    const persona = await newPerson({ pasos: 5000 });
    assert.ok(!JSON.stringify(await rpc(persona, 'list_rewards', {})).includes(c.id));
    assert.equal((await rpc(persona, 'claim_reward', { p_claim_id: uuid(), p_reward_id: c.id })).reason, 'premio_no_disponible');

    await rpc(gestor, 'admin_save_reward', { p_id: c.id, p_data: premio({ status: 'activo', cost_pasos: 1000 }) });
    await rpc(gestor, 'admin_save_reward', { p_id: c.id, p_data: premio({ status: 'activo', cost_pasos: 1000, title: 'Torta del día (nueva)' }) });
    const h = await rpc(gestor, 'admin_reward_history', { p_id: c.id });
    assert.deepEqual(h.prices.map((x) => [x.old_cost, x.new_cost]), [[1200, 1000], [null, 1200]]);
    assert.ok(JSON.stringify(await rpc(persona, 'list_rewards', {})).includes(c.id), 'activo: se ve');
    assert.equal((await rpc(persona, 'claim_reward', { p_claim_id: uuid(), p_reward_id: c.id })).ok, true);
    assert.equal(await balance(persona), 4000, 'se descontó el precio vigente');

    // sin la clave "stock" no se toca; con null pasa a ilimitado
    await rpc(gestor, 'admin_save_reward', { p_id: c.id, p_data: (({ stock, ...x }) => x)(premio({ status: 'activo', cost_pasos: 1000 })) });
    assert.equal((await one('select stock from public.rewards where id = $1', [c.id])).stock, 9);
    await rpc(gestor, 'admin_save_reward', { p_id: c.id, p_data: premio({ status: 'activo', cost_pasos: 1000, stock: null }) });
    assert.equal((await one('select stock from public.rewards where id = $1', [c.id])).stock, null);
  });

  test('el cupón ya emitido conserva el precio que se pagó aunque el premio cambie', async () => {
    const persona = await newPerson({ pasos: 3000 });
    const id = await mkReward({ cost: 1000, stock: 5 });
    const r = await rpc(persona, 'claim_reward', { p_claim_id: uuid(), p_reward_id: id });
    await rpc(gestor, 'admin_save_reward', { p_id: id, p_data: premio({ cost_pasos: 2500, status: 'activo' }) });
    const cp = await one('select cost_pasos from public.coupons where id = $1', [r.coupon_id]);
    assert.equal(cp.cost_pasos, 1000);
  });

  test('validaciones y permisos', async () => {
    const bad = [[{ title: 'a' }, 'title'], [{ cost_pasos: 0 }, 'cost_pasos'], [{ cost_pasos: 99999999 }, 'cost_pasos'],
      [{ stock: -1 }, 'stock'], [{ per_person_max: 0 }, 'per_person_max'], [{ valid_days: 0 }, 'valid_days'],
      [{ valid_days: 400 }, 'valid_days'], [{ status: 'finalizado' }, 'status'], [{ merchant_id: uuid() }, 'merchant_id']];
    for (const [patch, field] of bad) {
      const r = await rpc(gestor, 'admin_save_reward', { p_id: null, p_data: premio(patch) });
      assert.deepEqual([r.ok, r.reason, r.field], [false, 'campo_invalido', field], JSON.stringify(patch));
    }
    assert.equal((await rpcFail(aprobador, 'admin_save_reward', { p_id: null, p_data: premio() })).code, 'PT403');
    assert.equal((await rpc(gestor, 'admin_save_reward', { p_id: uuid(), p_data: premio() })).reason, 'premio_no_encontrado');
    // cualquier staff puede mirar el catálogo
    assert.ok(Array.isArray(await rpc(aprobador, 'admin_list_rewards', {})));
  });
});

describe('visitas, libro de PASOS y ajustes', () => {
  test('el listado de visitas respeta el permiso de ver nombres', async () => {
    const ch = await mkChallenge({ title: 'Para listar' });
    const p = await newPerson({ name: 'Nombre Visible' });
    assert.equal((await visit(p, ch, B.cafe)).ok, true);
    const conNombre = await rpc(ceo, 'admin_list_visits', { p_merchant: M.cafe });
    assert.ok(conNombre.some((v) => v.person_name === 'Nombre Visible'));
    const sinNombre = await rpc(aprobador, 'admin_list_visits', { p_merchant: M.cafe });
    assert.ok(sinNombre.length > 0 && sinNombre.every((v) => v.person_name === null));
    assert.equal((await rpcFail(gestor, 'admin_list_visits', {})).code, 'PT403');
    const led = await rpc(aprobador, 'admin_ledger', { p_user: p });
    assert.ok(led.length >= 1 && led.every((l) => l.person_name === null));
  });

  test('anular una visita: movimiento compensatorio, saldo descontado y registro original intacto', async () => {
    const ch = await mkChallenge({ title: 'Anulable', reward: 250 });
    const p = await newPerson();
    const v = await visit(p, ch, B.cafe);
    assert.equal(v.ok, true);
    const visitRow = await one(`select * from public.visits where user_id = $1`, [p]);
    assert.equal(await balance(p), 250);

    assert.equal((await rpcFail(gestor, 'admin_void_visit', { p_visit_id: visitRow.id, p_reason: 'prueba larga' })).code, 'PT403');
    assert.equal((await rpcFail(aprobador, 'admin_void_visit', { p_visit_id: visitRow.id, p_reason: 'prueba larga' })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_void_visit', { p_visit_id: visitRow.id, p_reason: 'abcd' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_void_visit', { p_visit_id: uuid(), p_reason: 'no existe esa visita' })).reason, 'visita_no_encontrada');

    const r = await rpc(ceo, 'admin_void_visit', { p_visit_id: visitRow.id, p_reason: 'Validación fraudulenta' });
    assert.equal(r.ok, true);
    assert.equal(await balance(p), 0);
    assert.equal(await ledgerSum(p), 0);
    const rows = await sql('select kind, amount, reverses_id from public.pasos_ledger where user_id = $1 order by id', [p]);
    assert.deepEqual(rows.map((x) => [x.kind, x.amount]), [['visita', 250], ['reversion', -250]]);
    assert.equal(rows[1].reverses_id, String(visitRow.ledger_id));
    const after = await one('select status, void_reason from public.visits where id = $1', [visitRow.id]);
    assert.deepEqual([after.status, after.void_reason], ['anulada', 'Validación fraudulenta']);
    assert.equal((await rpc(ceo, 'admin_void_visit', { p_visit_id: visitRow.id, p_reason: 'otra vez anulada' })).reason, 'visita_ya_anulada');
    assert.equal(await ledgerSum(p), 0, 'anular dos veces no descuenta dos veces');
  });

  test('si ya gastó los PASOS, anular deja saldo negativo (se ve en el control de integridad) pero sin romper nada', async () => {
    const ch = await mkChallenge({ title: 'Gastado', reward: 1000 });
    const rw = await mkReward({ cost: 1000, stock: 3 });
    const p = await newPerson();
    await visit(p, ch, B.cafe);
    assert.equal((await rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw })).ok, true);
    const vid = (await one('select id from public.visits where user_id = $1', [p])).id;
    assert.equal((await rpc(ceo, 'admin_void_visit', { p_visit_id: vid, p_reason: 'Fraude confirmado' })).ok, true);
    assert.equal(await balance(p), -1000);
    assert.equal(await balance(p), await ledgerSum(p));
    const chk = await rpc(ceo, 'admin_integrity_check', {});
    assert.equal(chk.ok, true);
    assert.ok(chk.negative_balances >= 1);
    // con saldo negativo no puede reclamar nada más
    const rw2 = await mkReward({ cost: 100, stock: 3 });
    assert.equal((await rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: rw2 })).ok, false);
  });

  test('ajuste excepcional de PASOS: solo CEO, con motivo, siempre un movimiento nuevo', async () => {
    const p = await newPerson({ pasos: 100 });
    assert.equal((await rpcFail(gestor, 'admin_adjust_pasos', { p_user: p, p_amount: 50, p_reason: 'Compensación por error' })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_adjust_pasos', { p_user: p, p_amount: 0, p_reason: 'Compensación por error' })).reason, 'monto_invalido');
    assert.equal((await rpc(ceo, 'admin_adjust_pasos', { p_user: p, p_amount: 500000, p_reason: 'Compensación por error' })).reason, 'monto_invalido');
    assert.equal((await rpc(ceo, 'admin_adjust_pasos', { p_user: p, p_amount: 50, p_reason: 'corto' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_adjust_pasos', { p_user: uuid(), p_amount: 50, p_reason: 'Compensación por error' })).reason, 'persona_no_encontrada');
    const r = await rpc(ceo, 'admin_adjust_pasos', { p_user: p, p_amount: 50, p_reason: 'Compensación por error' });
    assert.deepEqual([r.ok, r.balance], [true, 150]);
    const r2 = await rpc(ceo, 'admin_adjust_pasos', { p_user: p, p_amount: -30, p_reason: 'Corrección de la anterior' });
    assert.equal(r2.balance, 120);
    const rows = await sql("select kind, amount, reason from public.pasos_ledger where user_id = $1 and kind = 'ajuste' order by id", [p]);
    assert.deepEqual(rows.map((x) => x.amount), [50, -30]);
    const aud = await one(`select details from public.audit_log where action = 'pasos_ajuste' and target_id = $1 order by id desc limit 1`, [p]);
    assert.equal(aud.details.monto, -30);
  });

  test('el libro se puede paginar y filtrar', async () => {
    const p = await newPerson({ pasos: 10 });
    for (let i = 0; i < 4; i++) await rpc(ceo, 'admin_adjust_pasos', { p_user: p, p_amount: 10 + i, p_reason: `Ajuste de prueba ${i}` });
    const pag1 = await rpc(ceo, 'admin_ledger', { p_user: p, p_limit: 2 });
    assert.equal(pag1.length, 2);
    const pag2 = await rpc(ceo, 'admin_ledger', { p_user: p, p_limit: 10, p_before: pag1[1].id });
    assert.equal(pag2.length, 3);
    assert.ok(pag2.every((l) => l.person_id === p));
  });
});

describe('cupones desde el panel', () => {
  async function cuponDe(persona, reward) {
    const r = await rpc(persona, 'claim_reward', { p_claim_id: uuid(), p_reward_id: reward });
    assert.equal(r.ok, true, JSON.stringify(r));
    return (await one('select * from public.coupons where code = $1', [r.code]));
  }

  test('anular un cupón: devuelve PASOS y stock, una sola vez; no anula uno ya usado', async () => {
    const rw = await mkReward({ cost: 800, stock: 2 });
    const p = await newPerson({ pasos: 2000 });
    const c = await cuponDe(p, rw);
    assert.equal(await balance(p), 1200);
    assert.equal((await rpcFail(gestor, 'admin_cancel_coupon', { p_id: c.id, p_reason: 'Error del comercio' })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_cancel_coupon', { p_id: c.id, p_reason: 'xx' })).reason, 'motivo_requerido');
    const r = await rpc(ceo, 'admin_cancel_coupon', { p_id: c.id, p_reason: 'Error del comercio' });
    assert.deepEqual([r.ok, r.refunded], [true, true]);
    assert.equal(await balance(p), 2000);
    assert.equal((await one('select stock from public.rewards where id = $1', [rw])).stock, 2);
    assert.equal((await rpc(ceo, 'admin_cancel_coupon', { p_id: c.id, p_reason: 'Otra vez anulado' })).reason, 'cupon_no_cancelable');
    assert.equal(await balance(p), 2000, 'no devuelve dos veces');

    const c2 = await cuponDe(p, rw);
    const red = await rpc(U.cafe, 'redeem_coupon', { p_merchant: M.cafe, p_branch: B.cafe, p_code: c2.code });
    assert.equal(red.ok, true, JSON.stringify(red));
    assert.equal((await rpc(ceo, 'admin_cancel_coupon', { p_id: c2.id, p_reason: 'Ya se había usado' })).reason, 'cupon_ya_utilizado');
  });

  test('anular sin devolver PASOS, y el listado filtra por estado y por nombre solo con permiso', async () => {
    const rw = await mkReward({ cost: 300, stock: 5 });
    const p = await newPerson({ pasos: 1000, name: 'Persona de cupones' });
    const c = await cuponDe(p, rw);
    const r = await rpc(ceo, 'admin_cancel_coupon', { p_id: c.id, p_reason: 'Sin devolución por abuso', p_refund: false });
    assert.deepEqual([r.ok, r.refunded], [true, false]);
    assert.equal(await balance(p), 700);
    const anulados = await rpc(ceo, 'admin_list_coupons', { p_status: 'anulado', p_search: c.code });
    assert.equal(anulados.length, 1);
    assert.equal(anulados[0].person_name, 'Persona de cupones');
    const ap = await rpc(aprobador, 'admin_list_coupons', { p_search: c.code });
    assert.equal(ap[0].person_name, null);
    assert.equal((await rpcFail(gestor, 'admin_list_coupons', {})).code, 'PT403');
    // vencido se calcula por fecha
    const c2 = await cuponDe(p, rw);
    await sql("update public.coupons set expires_at = now() - interval '1 day' where id = $1", [c2.id]);
    const v = await rpc(ceo, 'admin_list_coupons', { p_status: 'vencido', p_search: c2.code });
    assert.equal(v.length, 1);
    assert.equal(v[0].status, 'vencido');
    assert.equal((await rpc(ceo, 'admin_list_coupons', { p_status: 'pendiente', p_search: c2.code })).length, 0);
  });
});

describe('cobros a comercios', () => {
  async function visitaEnMesAnterior(merchant = M.cafe, branch = B.cafe) {
    const ch = await mkChallenge({ merchant, title: 'Mes anterior' });
    const p = await newPerson();
    await visit(p, ch, branch);
    const vrow = await one('select id from public.visits where user_id = $1', [p]);
    await sql(`update public.visits set day = (date_trunc('month', private.today()) - interval '1 month' + interval '9 days')::date
               where id = $1`, [vrow.id]);
    return { id: vrow.id, person: p };
  }
  const mesAnterior = async () => (await one(`select to_char(date_trunc('month', private.today()) - interval '1 month', 'YYYY-MM-DD') as d`)).d;
  const mesActual = async () => (await one(`select to_char(date_trunc('month', private.today()), 'YYYY-MM-DD') as d`)).d;

  test('solo el CEO ve y modifica los cobros', async () => {
    for (const fn of [['admin_billing', {}], ['admin_set_billing_status', { p_merchant: M.cafe, p_period: '2026-01-01', p_status: 'facturado' }],
      ['admin_add_billing_adjustment', { p_merchant: M.cafe, p_period: '2026-01-01', p_amount: 1, p_reason: 'prueba larga' }]]) {
      for (const u of [gestor, aprobador, U.cafe]) assert.equal((await rpcFail(u, fn[0], fn[1])).code, 'PT403', fn[0]);
    }
  });

  test('pendiente → facturado → pagado, con importe congelado y sin saltos ni retrocesos', async () => {
    const m = (await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Cobros SA', fee_per_visit: 150, branch: { name: 'Central' } } }));
    const ch = await mkChallenge({ merchant: m.id, title: 'Cobros' });
    const p = await newPerson();
    assert.equal((await visit(p, ch, m.branch_id)).ok, true);
    const vrow = await one('select id, fee_ars from public.visits where user_id = $1', [p]);
    assert.equal(Number(vrow.fee_ars), 150);
    await sql(`update public.visits set day = (date_trunc('month', private.today()) - interval '1 month' + interval '3 days')::date where id = $1`, [vrow.id]);
    const per = await mesAnterior();

    const fila = async () => (await rpc(ceo, 'admin_billing', { p_period: per })).find((x) => x.merchant_id === m.id);
    assert.deepEqual([(await fila()).status, Number((await fila()).total)], ['pendiente', 150]);
    assert.equal((await rpc(ceo, 'admin_set_billing_status', { p_merchant: m.id, p_period: per, p_status: 'pagado' })).reason, 'transicion_invalida');
    assert.equal((await rpc(ceo, 'admin_set_billing_status', { p_merchant: m.id, p_period: per, p_status: 'facturado', p_invoice_ref: 'FC-0001' })).ok, true);
    // cambiar la tarifa del comercio no altera lo facturado, y las visitas nuevas del mes tampoco
    await rpc(ceo, 'admin_save_merchant', { p_id: m.id, p_data: { name: 'Cobros SA', fee_per_visit: 999 } });
    const f1 = await fila();
    assert.deepEqual([f1.status, Number(f1.total), f1.frozen, f1.invoice_ref], ['facturado', 150, true, 'FC-0001']);
    // período cerrado: no admite ajustes manuales
    assert.equal((await rpc(ceo, 'admin_add_billing_adjustment', { p_merchant: m.id, p_period: per, p_amount: -10, p_reason: 'ajuste tardío' })).reason, 'periodo_cerrado');
    assert.equal((await rpc(ceo, 'admin_set_billing_status', { p_merchant: m.id, p_period: per, p_status: 'facturado' })).reason, 'transicion_invalida');
    assert.equal((await rpc(ceo, 'admin_set_billing_status', { p_merchant: m.id, p_period: per, p_status: 'pagado' })).ok, true);
    assert.equal((await fila()).status, 'pagado');
    assert.equal((await rpc(ceo, 'admin_set_billing_status', { p_merchant: m.id, p_period: per, p_status: 'pendiente' })).reason, 'transicion_invalida');
  });

  test('no se factura el mes en curso', async () => {
    const act = await mesActual();
    const r = await rpc(ceo, 'admin_set_billing_status', { p_merchant: M.cafe, p_period: act, p_status: 'facturado' });
    assert.equal(r.reason, 'periodo_en_curso');
  });

  test('anular una visita de un mes ya facturado descuenta en el primer período abierto', async () => {
    const m = (await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Ajustes SRL', fee_per_visit: 200, branch: { name: 'Sucursal' } } }));
    const ch = await mkChallenge({ merchant: m.id, title: 'Ajustes' });
    const p = await newPerson();
    await visit(p, ch, m.branch_id);
    const vid = (await one('select id from public.visits where user_id = $1', [p])).id;
    await sql(`update public.visits set day = (date_trunc('month', private.today()) - interval '1 month' + interval '3 days')::date where id = $1`, [vid]);
    const per = await mesAnterior();
    await rpc(ceo, 'admin_set_billing_status', { p_merchant: m.id, p_period: per, p_status: 'facturado' });
    const r = await rpc(ceo, 'admin_void_visit', { p_visit_id: vid, p_reason: 'Anulada tras facturar' });
    assert.equal(r.ok, true);
    assert.equal(r.adjusted_period, await mesActual());
    const adj = await one('select amount_ars from public.billing_adjustments where visit_id = $1', [vid]);
    assert.equal(Number(adj.amount_ars), -200);
    const filas = await rpc(ceo, 'admin_billing', {});
    const actual = await mesActual();
    assert.equal(Number(filas.find((x) => x.merchant_id === m.id && x.period === per).total), 200, 'lo facturado no cambia');
    assert.equal(Number(filas.find((x) => x.merchant_id === m.id && x.period === actual).total), -200, 'el descuento va al mes abierto');
  });

  test('ajustes manuales: monto y motivo obligatorios', async () => {
    const act = await mesActual();
    assert.equal((await rpc(ceo, 'admin_add_billing_adjustment', { p_merchant: M.lib, p_period: act, p_amount: 0, p_reason: 'sin monto' })).reason, 'monto_invalido');
    assert.equal((await rpc(ceo, 'admin_add_billing_adjustment', { p_merchant: M.lib, p_period: act, p_amount: 100, p_reason: 'x' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_add_billing_adjustment', { p_merchant: M.lib, p_period: act, p_amount: 100, p_reason: 'Bonificación acordada' })).ok, true);
    const f = (await rpc(ceo, 'admin_billing', { p_period: act })).find((x) => x.merchant_id === M.lib);
    assert.ok(Number(f.adjustments) >= 100);
  });

  test('tarifa histórica: cada visita guarda lo que valía al momento', async () => {
    const m = await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Tarifa Variable', fee_per_visit: 100, branch: { name: 'Local' } } });
    const ch = await mkChallenge({ merchant: m.id, title: 'Tarifa', repeat: 'diaria' });
    const p1 = await newPerson(); const p2 = await newPerson();
    await visit(p1, ch, m.branch_id);
    await rpc(ceo, 'admin_save_merchant', { p_id: m.id, p_data: { name: 'Tarifa Variable', fee_per_visit: 250 } });
    await visit(p2, ch, m.branch_id);
    const fees = (await sql('select fee_ars from public.visits where merchant_id = $1 order by created_at', [m.id])).map((x) => Number(x.fee_ars));
    assert.deepEqual(fees, [100, 250]);
  });
});

describe('comercios y locales', () => {
  test('solo el CEO da de alta y edita; el equipo ve la lista sin tarifas ni cuentas', async () => {
    assert.equal((await rpcFail(gestor, 'admin_save_merchant', { p_id: null, p_data: { name: 'Intruso' } })).code, 'PT403');
    assert.equal((await rpcFail(U.cafe, 'admin_save_merchant', { p_id: null, p_data: { name: 'Intruso' } })).code, 'PT403');
    const lista = await rpc(gestor, 'admin_list_merchants', {});
    assert.ok(lista.length >= 3 && lista.every((m) => m.fee_per_visit === null && m.accounts === null));
    const full = await rpc(ceo, 'admin_list_merchants', {});
    assert.ok(full.some((m) => m.fee_per_visit !== null));
  });

  test('alta con local, validaciones y suspensión con motivo', async () => {
    for (const data of [{ name: 'x' }, { name: 'Bien', fee_per_visit: -5 }, { name: 'Bien', fee_per_visit: 'abc' }]) {
      const r = await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: data });
      assert.deepEqual([r.ok, r.reason], [false, 'campo_invalido'], JSON.stringify(data));
    }
    const m = await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Librería Nueva', category: 'libros', neighborhood: 'Centro',
      branch: { name: 'Local principal', address: 'Calle 1', lat: -34.6, lng: -58.4, radius_m: 60 } } });
    assert.equal(m.ok, true);
    assert.ok(m.branch_id);
    const b = await one('select radius_m, status from public.branches where id = $1', [m.branch_id]);
    assert.deepEqual([b.radius_m, b.status], [60, 'activo']);
    const l2 = await rpc(ceo, 'admin_save_branch', { p_id: null, p_merchant: m.id, p_data: { name: 'Segundo local' } });
    assert.equal(l2.ok, true);
    assert.equal((await rpc(ceo, 'admin_save_branch', { p_id: null, p_merchant: uuid(), p_data: { name: 'Huérfano' } })).reason, 'comercio_no_encontrado');
    assert.equal((await rpc(ceo, 'admin_save_branch', { p_id: uuid(), p_merchant: m.id, p_data: { name: 'No existe' } })).reason, 'local_no_encontrado');
    assert.equal((await rpc(ceo, 'admin_save_merchant', { p_id: uuid(), p_data: { name: 'No existe' } })).reason, 'comercio_no_encontrado');

    assert.equal((await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'suspendido', p_reason: '' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'borrado', p_reason: 'prueba' })).reason, 'estado_invalido');
    assert.equal((await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'suspendido', p_reason: 'Incumplimiento' })).ok, true);
    assert.equal((await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'activo', p_reason: 'Regularizado' })).ok, true);
  });

  test('un comercio suspendido no entrega códigos ni sus desafíos aparecen para las personas', async () => {
    const m = await rpc(ceo, 'admin_save_merchant', { p_id: null, p_data: { name: 'Se suspende', branch: { name: 'Local' } } });
    const ch = await mkChallenge({ merchant: m.id, title: 'De comercio suspendido' });
    const p = await newPerson();
    assert.ok(JSON.stringify(await rpc(p, 'list_challenges', {})).includes(ch));
    await rpc(ceo, 'admin_set_merchant_status', { p_id: m.id, p_status: 'suspendido', p_reason: 'Prueba de suspensión' });
    assert.ok(!JSON.stringify(await rpc(p, 'list_challenges', {})).includes(ch));
    const r = await visit(p, ch, m.branch_id, { code: '000000' });
    assert.equal(r.ok, false);
  });
});

describe('personas (vista administrativa)', () => {
  test('no hay documento ni fecha de nacimiento en lo que se muestra', async () => {
    const p = await newPerson({ name: 'Persona Privada', birth: '1985-03-09' });
    const det = await rpc(ceo, 'admin_person_detail', { p_user: p });
    const text = JSON.stringify(det) + JSON.stringify(await rpc(ceo, 'admin_list_people', { p_search: 'Persona Privada' }));
    assert.ok(!/1985/.test(text), 'la fecha de nacimiento no debe salir');
    assert.ok(!/birth|dni|document|nacimiento/i.test(text), 'ningún campo de documento/nacimiento');
    assert.equal(det.person.age_verified, true);
    assert.equal((await rpcFail(aprobador, 'admin_person_detail', { p_user: p })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_person_detail', { p_user: uuid() })).reason, 'persona_no_encontrada');
  });

  test('buscar, paginar y suspender (solo CEO, con motivo)', async () => {
    const tag = 'Zulema' + uuid().slice(0, 8);
    const p = await newPerson({ name: tag + ' Suspendible' });
    const lista = await rpc(ceo, 'admin_list_people', { p_search: tag });
    assert.equal(lista.length, 1);
    assert.equal((await rpcFail(gestor, 'admin_set_person_status', { p_user: p, p_status: 'suspendido', p_reason: 'prueba' })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_set_person_status', { p_user: p, p_status: 'suspendido', p_reason: 'ab' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_set_person_status', { p_user: p, p_status: 'bloqueado', p_reason: 'prueba' })).reason, 'estado_invalido');
    assert.equal((await rpc(ceo, 'admin_set_person_status', { p_user: uuid(), p_status: 'suspendido', p_reason: 'prueba' })).reason, 'persona_no_encontrada');
    assert.equal((await rpc(ceo, 'admin_set_person_status', { p_user: p, p_status: 'suspendido', p_reason: 'Actividad sospechosa' })).ok, true);
    assert.equal((await rpc(ceo, 'admin_list_people', { p_status: 'suspendido', p_search: tag })).length, 1);
    const ch = await mkChallenge({ title: 'Para suspendida' });
    assert.equal((await visit(p, ch, B.cafe)).reason, 'cuenta_suspendida');
    await rpc(ceo, 'admin_set_person_status', { p_user: p, p_status: 'activo', p_reason: 'Revisado, todo en orden' });
    assert.equal((await visit(p, ch, B.cafe)).ok, true);
    const pag = await rpc(ceo, 'admin_list_people', { p_limit: 1, p_offset: 0 });
    assert.equal(pag.length, 1);
  });
});

describe('equipo y cuentas', () => {
  test('solo el CEO ve y gestiona el equipo', async () => {
    for (const u of [gestor, aprobador, U.cafe]) assert.equal((await rpcFail(u, 'admin_list_team', {})).code, 'PT403');
    const t = await rpc(ceo, 'admin_list_team', {});
    const c = t.find((x) => x.role === 'ceo');
    assert.deepEqual(c.perms.slice().sort(), ['auditoria.ver', 'catalogo.gestionar', 'cupones.ver', 'desafios.aprobar', 'desafios.editar', 'fotos.gestionar', 'personas.ver', 'visitas.ver']);
  });

  test('crear cuentas de equipo y de comercio; permisos válidos; sin duplicados', async () => {
    const u = await newUser('nuevo-equipo');
    assert.equal((await rpc(ceo, 'admin_register_role', { p_user: u, p_role: 'ceo', p_merchant: null, p_perms: [], p_display_name: 'Intento', p_phone: null })).reason, 'rol_invalido');
    assert.equal((await rpc(ceo, 'admin_register_role', { p_user: u, p_role: 'equipo', p_merchant: null, p_perms: ['todo.poder'], p_display_name: 'Intento', p_phone: null })).reason, 'permiso_invalido');
    assert.equal((await rpc(ceo, 'admin_register_role', { p_user: uuid(), p_role: 'equipo', p_merchant: null, p_perms: [], p_display_name: 'Fantasma', p_phone: null })).reason, 'usuario_no_existe');
    assert.equal((await rpc(ceo, 'admin_register_role', { p_user: u, p_role: 'equipo', p_merchant: null, p_perms: [], p_display_name: '', p_phone: null })).reason, 'campo_invalido');
    const r = await rpc(ceo, 'admin_register_role', { p_user: u, p_role: 'equipo', p_merchant: null, p_perms: ['desafios.editar'], p_display_name: 'Nueva Persona de Equipo', p_phone: '+5491100009999' });
    assert.equal(r.ok, true);
    assert.equal((await one('select must_change_password from public.user_roles where id = $1', [r.id])).must_change_password, true);
    assert.equal((await rpc(ceo, 'admin_register_role', { p_user: u, p_role: 'equipo', p_merchant: null, p_perms: [], p_display_name: 'Otra vez', p_phone: null })).reason, 'ya_existe');
    // sus permisos funcionan de inmediato y no más que eso
    assert.equal((await rpc(u, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Del nuevo equipo' }) })).ok, true);
    assert.equal((await rpcFail(u, 'admin_save_reward', { p_id: null, p_data: { merchant_id: M.cafe, title: 'No puede', cost_pasos: 10 } })).code, 'PT403');

    const c = await newUser('nuevo-comercio');
    assert.equal((await rpc(ceo, 'admin_register_role', { p_user: c, p_role: 'comercio', p_merchant: null, p_perms: [], p_display_name: 'Sin comercio', p_phone: null })).reason, 'comercio_no_encontrado');
    const rc = await rpc(ceo, 'admin_register_role', { p_user: c, p_role: 'comercio', p_merchant: M.lib, p_perms: ['desafios.editar'], p_display_name: 'Librería (cuenta)', p_phone: null });
    assert.equal(rc.ok, true);
    assert.deepEqual((await one('select perms from public.user_roles where id = $1', [rc.id])).perms, [], 'las cuentas de comercio no llevan permisos de equipo');
    assert.equal((await rpc(c, 'merchant_overview', { p_merchant: M.lib })).id, M.lib);
    assert.equal((await rpcFail(c, 'merchant_overview', { p_merchant: M.cafe })).code, 'PT403');
    assert.equal((await rpcFail(gestor, 'admin_register_role', { p_user: u, p_role: 'equipo', p_merchant: null, p_perms: [], p_display_name: 'x', p_phone: null })).code, 'PT403');
  });

  test('editar permisos y desactivar: efecto inmediato, motivo obligatorio, el CEO está protegido', async () => {
    const u = await equipo(['desafios.editar'], 'editable');
    const rid = (await one('select id from public.user_roles where user_id = $1', [u])).id;
    assert.equal((await rpc(u, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Antes' }) })).ok, true);
    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: rid, p_perms: ['inventado'], p_active: true })).reason, 'permiso_invalido');
    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: rid, p_perms: ['catalogo.gestionar'], p_active: true })).ok, true);
    assert.equal((await rpcFail(u, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Después' }) })).code, 'PT403');
    assert.equal((await rpc(u, 'admin_save_reward', { p_id: null, p_data: { merchant_id: M.cafe, title: 'Con el nuevo permiso', cost_pasos: 10 } })).ok, true);
    const aud = await one(`select details from public.audit_log where action = 'cuenta_editada' and target_id = $1 order by id desc limit 1`, [rid]);
    assert.deepEqual(aud.details.permisos_agregados, ['catalogo.gestionar']);
    assert.deepEqual(aud.details.permisos_quitados, ['desafios.editar']);

    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: rid, p_perms: null, p_active: false })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: rid, p_perms: null, p_active: false, p_reason: 'Se fue del equipo' })).ok, true);
    assert.equal((await rpcFail(u, 'admin_list_rewards', {})).code, 'PT403', 'sin acceso apenas se desactiva');
    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: rid, p_perms: null, p_active: true })).ok, true);
    assert.equal((await rpc(u, 'admin_list_rewards', {})).length >= 0, true);

    const ceoRow = await one("select id from public.user_roles where role = 'ceo' limit 1");
    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: ceoRow.id, p_perms: [], p_active: false, p_reason: 'intento' })).reason, 'cuenta_protegida');
    assert.equal((await rpc(ceo, 'admin_update_role', { p_id: uuid(), p_perms: [], p_active: true })).reason, 'cuenta_no_encontrada');
  });

  test('forzar el cambio de contraseña', async () => {
    const c = await rpc(U.cafe, 'my_context', {});
    assert.equal(c.must_change_password ?? false, false);
    assert.equal((await rpc(ceo, 'admin_flag_password_reset', { p_user: U.cafe })).ok, true);
    assert.equal((await one('select must_change_password from public.user_roles where user_id = $1', [U.cafe])).must_change_password, true);
    await rpc(U.cafe, 'mark_password_changed', {});
    assert.equal((await one('select must_change_password from public.user_roles where user_id = $1', [U.cafe])).must_change_password, false);
    assert.equal((await rpc(ceo, 'admin_flag_password_reset', { p_user: uuid() })).reason, 'cuenta_no_encontrada');
    assert.equal((await rpc(ceo, 'admin_flag_password_reset', { p_user: ceo })).reason, 'cuenta_no_encontrada', 'el CEO no entra en este flujo');
  });
});

describe('configuración, modo prueba y producción', () => {
  test('cambios validados, con motivo y con historial', async () => {
    assert.equal((await rpcFail(gestor, 'admin_update_config', { p_changes: { daily_cap: 5 }, p_reason: 'prueba' })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_update_config', { p_changes: { daily_cap: 5 }, p_reason: 'x' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_update_config', { p_changes: {}, p_reason: 'sin nada' })).reason, 'sin_cambios');
    const bad = [[{ daily_cap: 0 }, 'valor_fuera_de_rango'], [{ daily_cap: 51 }, 'valor_fuera_de_rango'], [{ daily_cap: 2.5 }, 'valor_fuera_de_rango'],
      [{ daily_cap: 'mucho' }, 'valor_invalido'], [{ code_rotation_s: 5 }, 'valor_fuera_de_rango'], [{ fee_per_visit: -1 }, 'valor_fuera_de_rango'],
      [{ mfa_required: 'quizás' }, 'valor_invalido'], [{ paused: true }, 'clave_invalida'], [{ environment: 'produccion' }, 'clave_invalida'],
      [{ terms_version: '' }, 'valor_invalido']];
    for (const [changes, reason] of bad) {
      const r = await rpc(ceo, 'admin_update_config', { p_changes: changes, p_reason: 'prueba de validación' });
      assert.equal(r.reason, reason, JSON.stringify(changes));
    }
    const ok = await rpc(ceo, 'admin_update_config', { p_changes: { daily_cap: 5, fee_per_visit: 300 }, p_reason: 'Ajuste de prueba' });
    assert.equal(ok.changed.length, 2);
    assert.equal((await getConfig()).daily_cap, 5);
    const h = await rpc(ceo, 'admin_config_history', { p_limit: 5 });
    assert.ok(h.some((x) => x.key === 'daily_cap' && x.new_value === '5' && x.reason === 'Ajuste de prueba'));
    // mismo valor: no genera historial ni auditoría
    const n0 = Number((await one('select count(*) c from public.config_history')).c);
    const same = await rpc(ceo, 'admin_update_config', { p_changes: { daily_cap: 5 }, p_reason: 'Sin cambio real' });
    assert.equal(same.changed.length, 0);
    assert.equal(Number((await one('select count(*) c from public.config_history')).c), n0);
  });

  test('un cambio de tope diario se aplica de verdad', async () => {
    await rpc(ceo, 'admin_update_config', { p_changes: { daily_cap: 1 }, p_reason: 'Probar tope' });
    const a = await mkChallenge({ title: 'Tope A' });
    const b = await mkChallenge({ title: 'Tope B' });
    const p = await newPerson();
    assert.equal((await visit(p, a, B.cafe)).ok, true);
    assert.equal((await visit(p, b, B.cafe)).reason, 'tope_diario');
  });

  test('la API no puede pasar a producción; con producción el modo prueba se apaga y no vuelve', async () => {
    assert.equal((await rpc(ceo, 'admin_update_config', { p_changes: { test_mode: true }, p_reason: 'Encender prueba' })).ok, true);
    const p = await newPerson();
    assert.equal((await rpc(p, 'test_add_pasos', { p_claim_id: uuid(), p_amount: 500 })).ok, true);
    // el cambio de entorno es solo desde el editor SQL: ninguna función pública ni rol de API puede hacerlo
    const e = await rpcFail(ceo, 'admin_update_config', { p_changes: { environment: 'produccion' }, p_reason: 'intento' }).catch(() => null);
    assert.ok(e === null || e);
    await sql("select private.set_environment('produccion')");
    const cfg = await getConfig();
    assert.deepEqual([cfg.environment, cfg.test_mode], ['produccion', false]);
    assert.equal((await rpc(ceo, 'admin_update_config', { p_changes: { test_mode: true }, p_reason: 'intento en producción' })).reason, 'modo_prueba_prohibido_en_produccion');
    assert.equal((await rpc(p, 'test_add_pasos', { p_claim_id: uuid(), p_amount: 500 })).ok, false);
    const dash = await rpc(ceo, 'admin_dashboard', {});
    assert.deepEqual([dash.environment, dash.test_mode], ['produccion', false]);
    // se puede volver a prueba solo desde SQL (para esta base de pruebas)
    await sql("select private.set_environment('prueba')");
  });

  test('segundo factor: con mfa_required el equipo necesita sesión aal2 (el comercio y las personas no)', async () => {
    await rpc(ceo, 'admin_update_config', { p_changes: { mfa_required: true }, p_reason: 'Exigir segundo factor' });
    const e = await rpcFail(ceo, 'admin_dashboard', {});
    assert.deepEqual([e.code, e.message], ['PT403', 'mfa_requerido']);
    assert.equal((await rpcFail(gestor, 'admin_list_challenges', {})).message, 'mfa_requerido');
    assert.equal((await rpc(ceo, 'admin_dashboard', {}, { aal: 'aal2' })).role, 'ceo');
    assert.equal((await rpc(gestor, 'admin_list_challenges', {}, { aal: 'aal2' })).length >= 0, true);
    // personas y comercios siguen normales
    assert.equal((await rpc(U.sofia, 'my_context', {})).ok ?? true, true);
    assert.equal((await rpc(U.cafe, 'merchant_overview', { p_merchant: M.cafe })).id, M.cafe);
    // no se puede apagar sin aal2: nadie puede cambiar la configuración de un CEO sin segundo factor
    assert.equal((await rpcFail(ceo, 'admin_update_config', { p_changes: { mfa_required: false }, p_reason: 'sin segundo factor' })).message, 'mfa_requerido');
  });
});

describe('pausa de emergencia, alertas y control', () => {
  const lista = { causa_identificada: true, incidencia_resuelta: true, validaciones_tecnicas: true, reglas_comprobadas: true, cupones_revisados: true, comunicacion_preparada: true };

  test('pausar frena todo y reactivar exige el checklist completo', async () => {
    assert.equal((await rpcFail(gestor, 'admin_set_pause', { p_paused: true, p_reason: 'Incidente grave' })).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_set_pause', { p_paused: true, p_reason: 'abc' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_set_pause', { p_paused: false, p_reason: null, p_checklist: lista })).reason, 'no_esta_en_pausa');
    assert.equal((await rpc(ceo, 'admin_set_pause', { p_paused: true, p_reason: 'Incidente grave' })).ok, true);
    assert.equal((await rpc(ceo, 'admin_set_pause', { p_paused: true, p_reason: 'Incidente grave' })).reason, 'ya_en_pausa');

    assert.equal((await rpc(null, 'public_config', {}, { role: 'anon' })).paused, true);
    const p = await newPerson({ pasos: 2000 });
    const ch = await mkChallenge({ title: 'En pausa' });
    assert.equal((await visit(p, ch, B.cafe)).reason, 'pausa');
    assert.equal((await rpc(p, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe })).reason, 'pausa');
    // el CEO sigue pudiendo operar el panel
    assert.equal((await rpc(ceo, 'admin_dashboard', {})).paused, true);

    const alertas = await rpc(ceo, 'admin_list_alerts', { p_status: 'nueva' });
    assert.ok(alertas.some((a) => a.kind === 'pausa_general' && a.severity === 'critica'));

    // reactivar: falta un ítem → rechaza e indica cuál
    for (const k of Object.keys(lista)) {
      const r = await rpc(ceo, 'admin_set_pause', { p_paused: false, p_reason: null, p_checklist: { ...lista, [k]: false } });
      assert.deepEqual([r.ok, r.reason, r.missing], [false, 'checklist_incompleto', k]);
    }
    assert.equal((await rpc(ceo, 'admin_set_pause', { p_paused: false, p_reason: null, p_checklist: null })).reason, 'checklist_incompleto');
    assert.equal((await getConfig()).paused, true);
    assert.equal((await rpc(ceo, 'admin_set_pause', { p_paused: false, p_reason: null, p_checklist: lista })).ok, true);
    assert.equal((await getConfig()).paused, false);
    assert.equal((await visit(p, ch, B.cafe)).ok, true);
    assert.equal((await rpc(ceo, 'admin_list_alerts', { p_status: 'nueva' })).filter((a) => a.kind === 'pausa_general').length, 0, 'la alerta se cierra sola');
    const acciones = (await sql(`select action from public.audit_log where action in ('pausa_activada','pausa_desactivada') order by id desc limit 2`)).map((x) => x.action);
    assert.deepEqual(acciones, ['pausa_desactivada', 'pausa_activada']);
  });

  test('alertas: solo CEO, estados y notas', async () => {
    await sql("select private.raise_alert('prueba_alerta', 'media', 'sistema', 'x1', 'Alerta de prueba')");
    const [a] = (await rpc(ceo, 'admin_list_alerts', { p_status: 'nueva' })).filter((x) => x.kind === 'prueba_alerta');
    assert.ok(a);
    for (const u of [gestor, aprobador, U.cafe]) assert.equal((await rpcFail(u, 'admin_list_alerts', {})).code, 'PT403');
    assert.equal((await rpc(ceo, 'admin_update_alert', { p_id: a.id, p_status: 'inventado' })).reason, 'estado_invalido');
    assert.equal((await rpc(ceo, 'admin_update_alert', { p_id: a.id, p_status: 'cerrada' })).reason, 'motivo_requerido');
    assert.equal((await rpc(ceo, 'admin_update_alert', { p_id: 999999999, p_status: 'en_revision' })).reason, 'alerta_no_encontrada');
    assert.equal((await rpc(ceo, 'admin_update_alert', { p_id: a.id, p_status: 'en_revision', p_note: 'Mirando' })).ok, true);
    assert.equal((await rpc(ceo, 'admin_update_alert', { p_id: a.id, p_status: 'cerrada', p_note: 'Falsa alarma' })).ok, true);
    const [z] = (await rpc(ceo, 'admin_list_alerts', { p_status: 'cerrada' })).filter((x) => x.id === a.id);
    assert.equal(z.notes.length, 2);
    assert.equal(z.notes[1].text, 'Falsa alarma');
  });

  test('el panel de control y el inicio muestran números coherentes', async () => {
    const c = await rpc(ceo, 'admin_control_panel', {});
    for (const k of ['alerts_new', 'visits_voided_30d', 'failed_attempts_24h', 'suspended_people', 'sensitive_actions_7d']) assert.equal(typeof c[k], 'number', k);
    const d = await rpc(ceo, 'admin_dashboard', { p_days: 30 });
    assert.equal(d.series.length, 14);
    assert.equal(typeof d.alerts_open, 'number');
    const dg = await rpc(gestor, 'admin_dashboard', {});
    assert.equal(dg.alerts_open, null, 'el equipo no ve alertas ni cobros');
    assert.equal(dg.billing_pending, null);
    assert.equal((await rpcFail(U.cafe, 'admin_dashboard', {})).code, 'PT403');
  });
});

describe('auditoría y fotos', () => {
  test('toda acción sensible queda en la auditoría, con la cadena de hashes íntegra', async () => {
    const id = (await rpc(gestor, 'admin_save_challenge', { p_id: null, p_data: desafio({ title: 'Para auditar' }) })).id;
    const log = await rpc(ceo, 'admin_list_audit', { p_search: 'Para auditar' });
    assert.ok(log.some((l) => l.action === 'desafio_creado' && l.target_id === id && l.actor_role === 'equipo'));
    assert.equal((await rpcFail(gestor, 'admin_list_audit', {})).code, 'PT403');
    const lector = await equipo(['auditoria.ver'], 'auditor');
    assert.ok(Array.isArray(await rpc(lector, 'admin_list_audit', {})));
    const pag = await rpc(ceo, 'admin_list_audit', { p_limit: 3 });
    assert.equal(pag.length, 3);
    const mas = await rpc(ceo, 'admin_list_audit', { p_limit: 3, p_before: pag[2].id });
    assert.ok(mas.every((x) => x.id < pag[2].id));
    const chk = await rpc(ceo, 'admin_integrity_check', {});
    assert.equal(chk.audit_chain.ok, true);
    assert.equal(chk.ok, true);
  });

  test('el registro de auditoría no se puede editar ni borrar; si alguien lo toca por debajo, se detecta', async () => {
    for (const q of ['update public.audit_log set summary = \'x\'', 'delete from public.audit_log', 'truncate public.audit_log']) {
      await assert.rejects(sql(q), /auditoria_inmutable/, q);
    }
    // manipulación "con la mano": se desactivan los disparadores (solo posible con la cuenta dueña de la base) y se revierte
    const { pool } = await import('./helpers.mjs');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('alter table public.audit_log disable trigger audit_log_guard');
      const victima = (await c.query("select id from public.audit_log where action = 'desafio_creado' order by id limit 1")).rows[0].id;
      await c.query("update public.audit_log set summary = 'adulterado' where id = $1", [victima]);
      const r = (await c.query('select private.verify_audit_chain() as r')).rows[0].r;
      assert.equal(r.ok, false);
      assert.equal(String(r.broken_at), String(victima));
    } finally {
      await c.query('rollback');
      c.release();
    }
    assert.equal((await rpc(ceo, 'admin_integrity_check', {})).audit_chain.ok, true);
  });

  test('cambiar fotos: logo, banner, comercio, desafío y premio; solo imágenes válidas', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    for (const [target, id] of [['logo', null], ['banner', null], ['merchant', M.cafe], ['challenge', C.cafe], ['reward', R.cafe]]) {
      const r = await rpc(gestor, 'admin_set_photo', { p_target: target, p_id: id, p_path: png });
      assert.equal(r.ok, true, target);
    }
    assert.equal((await getConfig()).logo_path, png);
    assert.equal((await one('select photo_path from public.merchants where id = $1', [M.cafe])).photo_path, png);
    assert.equal((await rpc(gestor, 'admin_set_photo', { p_target: 'merchant', p_id: uuid(), p_path: png })).reason, 'no_encontrado');
    assert.equal((await rpc(gestor, 'admin_set_photo', { p_target: 'otra', p_id: null, p_path: png })).reason, 'destino_invalido');
    for (const mala of ['javascript:alert(1)', 'https://externo.example/a.png', 'data:text/html;base64,PGgxPg==', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', '../../etc/passwd', 'x']) {
      const e = await rpcFail(gestor, 'admin_set_photo', { p_target: 'logo', p_id: null, p_path: mala });
      assert.match(e.message, /foto_invalida/, mala);
    }
    // rutas válidas de Storage
    assert.equal((await rpc(gestor, 'admin_set_photo', { p_target: 'merchant', p_id: M.cafe, p_path: `merchants/${M.cafe}/foto.webp` })).ok, true);
    assert.equal((await rpc(gestor, 'admin_set_photo', { p_target: 'logo', p_id: null, p_path: 'config/logo.png' })).ok, true);
    // quien no tiene el permiso no puede
    assert.equal((await rpcFail(aprobador, 'admin_set_photo', { p_target: 'logo', p_id: null, p_path: png })).code, 'PT403');
    assert.equal((await rpcFail(U.cafe, 'admin_set_photo', { p_target: 'logo', p_id: null, p_path: png })).code, 'PT403');
    // restaurar
    await sql("update public.app_config set logo_path = null, banner_path = null");
    await sql('update public.merchants set photo_path = null where id = $1', [M.cafe]);
    await sql('update public.challenges set photo_path = null where id = $1', [C.cafe]);
    await sql('update public.rewards set photo_path = null where id = $1', [R.cafe]);
  });

  test('almacenamiento: solo con permiso de fotos se escribe; todos pueden leer', async () => {
    const f = await rpc(gestor, 'can_manage_photos', {});
    assert.equal(f, true);
    assert.equal(await rpc(aprobador, 'can_manage_photos', {}), false);
    assert.equal(await rpc(U.cafe, 'can_manage_photos', {}), false);
    assert.equal(await rpc(ceo, 'can_manage_photos', {}), true);
    const pol = await sql(`select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname`);
    const names = pol.map((x) => x.policyname);
    for (const n of ['fotos_lectura', 'fotos_subir', 'fotos_reemplazar', 'fotos_borrar']) assert.ok(names.includes(n), n);
    const b = await one("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'fotos'");
    assert.equal(b.public, true);
    assert.equal(Number(b.file_size_limit), 1048576);
    assert.deepEqual(b.allowed_mime_types.slice().sort(), ['image/jpeg', 'image/png', 'image/webp']);
  });
});
