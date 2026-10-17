// Perfil PERSONA: registro, visitas, metas de pasos, premios, cupones y datos personales.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  sql, one, rpc, rpcFail, newUser, newPerson, grant, balance, ledgerSum, freshCode, currentCode, mkChallenge, mkReward,
  setConfig, getConfig, visit, end, U, M, B, C, R, uuid,
} from './helpers.mjs';

after(end);
const DEFAULTS = {
  paused: false, daily_cap: 3, require_gps: false, require_merchant_active: false, test_mode: true,
  environment: 'prueba', max_uses_per_code: 4, code_rotation_s: 45, code_grace_s: 30, max_failed_attempts: 5,
  mfa_required: false, claim_window_s: 300,
};
beforeEach(async () => { await setConfig(DEFAULTS); });

const today = async () => (await one('select private.today()::text as d')).d;
const yearsAgo = async (y, extraDays = 0) =>
  (await one(`select (private.today() - make_interval(years => $1) + make_interval(days => $2))::text as d`, [y, extraDays])).d;

describe('registro y edad (solo mayores de 18, sin DNI)', () => {
  test('un menor de 18 es rechazado y NO se guarda nada', async () => {
    const u = await newUser('menor');
    const r = await rpc(u, 'register_profile', {
      p_name: 'Menor', p_birth: await yearsAgo(18, 1), p_adult: true, p_terms: true, p_privacy: true });
    assert.deepEqual(r, { ok: false, reason: 'menor' });
    assert.equal((await one('select count(*)::int c from public.profiles where user_id = $1', [u])).c, 0);
    assert.equal((await one('select count(*)::int c from public.consents where user_id = $1', [u])).c, 0);
    assert.equal((await one('select count(*)::int c from public.wallets where user_id = $1', [u])).c, 0);
    // y tampoco queda rastro de la fecha en ninguna tabla
    const ctx = await rpc(u, 'my_context');
    assert.equal(ctx.profile, null);
  });

  test('cumple 18 exactamente hoy: puede registrarse', async () => {
    const u = await newUser('justo18');
    const r = await rpc(u, 'register_profile', { p_name: 'Justo', p_birth: await yearsAgo(18), p_adult: true, p_terms: true, p_privacy: true });
    assert.deepEqual(r, { ok: true });
  });

  test('fechas imposibles se rechazan', async () => {
    const u = await newUser('fecha');
    for (const d of ['2999-01-01', '1899-12-31']) {
      const r = await rpc(u, 'register_profile', { p_name: 'X', p_birth: d, p_adult: true, p_terms: true, p_privacy: true });
      assert.equal(r.reason, 'fecha_invalida', d);
    }
    const r = await rpc(u, 'register_profile', { p_name: 'X', p_birth: null, p_adult: true, p_terms: true, p_privacy: true });
    assert.equal(r.reason, 'fecha_invalida');
  });

  test('sin declarar mayoría de edad y aceptar términos y privacidad no se registra', async () => {
    const u = await newUser('sinacepto');
    for (const flags of [[false, true, true], [true, false, true], [true, true, false], [null, null, null]]) {
      const r = await rpc(u, 'register_profile', { p_name: 'X', p_birth: '1990-01-01', p_adult: flags[0], p_terms: flags[1], p_privacy: flags[2] });
      assert.equal(r.reason, 'falta_aceptacion', JSON.stringify(flags));
    }
    assert.equal((await one('select count(*)::int c from public.profiles where user_id = $1', [u])).c, 0);
  });

  test('nombre vacío o demasiado largo se rechaza', async () => {
    const u = await newUser('nombre');
    for (const n of ['', '   ', 'x'.repeat(61), null]) {
      const r = await rpc(u, 'register_profile', { p_name: n, p_birth: '1990-01-01', p_adult: true, p_terms: true, p_privacy: true });
      assert.equal(r.reason, 'nombre_invalido');
    }
  });

  test('registro correcto: perfil, aceptaciones y billetera; repetirlo no cambia nada', async () => {
    const u = await newUser('ok');
    assert.deepEqual(await rpc(u, 'register_profile', { p_name: ' Ana ', p_birth: '1991-03-02', p_adult: true, p_terms: true, p_privacy: true }), { ok: true });
    const p = await one('select * from public.profiles where user_id = $1', [u]);
    assert.equal(p.display_name, 'Ana');
    assert.equal((await one('select count(*)::int c from public.consents where user_id = $1', [u])).c, 2);
    assert.equal(await balance(u), 0);
    const again = await rpc(u, 'register_profile', { p_name: 'Otro', p_birth: '1980-01-01', p_adult: true, p_terms: true, p_privacy: true });
    assert.equal(again.already, true);
    assert.equal((await one('select display_name from public.profiles where user_id = $1', [u])).display_name, 'Ana');
  });

  test('no existe ningún campo de DNI en la base de datos', async () => {
    const rows = await sql(`select table_name, column_name from information_schema.columns
      where table_schema in ('public','private') and (column_name ~* 'dni|documento|cuil|cuit|passport|pasaporte')`);
    assert.deepEqual(rows, []);
  });

  test('la fecha de nacimiento solo la ve la propia persona', async () => {
    const u = await newPerson({ birth: '1988-08-08' });
    assert.equal((await rpc(u, 'my_profile')).birth_date, '1988-08-08');
    const ctx = JSON.stringify(await rpc(u, 'my_context'));
    assert.ok(!ctx.includes('1988-08-08'));
  });
});

describe('visitas con código dinámico', () => {
  test('visita válida: acredita PASOS en el libro, guarda la tarifa vigente y el saldo coincide', async () => {
    const u = await newPerson();
    const r = await visit(u, C.cafe, B.cafe);
    assert.equal(r.ok, true);
    assert.equal(r.pasos, 500);
    assert.equal(r.balance, 500);
    assert.equal(r.merchant_name, 'Café de la Esquina');
    const v = await one('select *, day::text as day_text from public.visits where user_id = $1', [u]);
    assert.equal(Number(v.fee_ars), 200);
    assert.equal(v.status, 'valida');
    assert.equal(v.day_text, await today());
    assert.equal(await balance(u), 500);
    assert.equal(await ledgerSum(u), 500);
    const l = await one("select * from public.pasos_ledger where user_id = $1 and kind = 'visita'", [u]);
    assert.equal(l.amount, 500);
    assert.equal(l.ref_id, v.id);
  });

  test('el reintento de red con el mismo claim no acredita dos veces', async () => {
    const u = await newPerson();
    const claim = uuid();
    const code = await freshCode(B.cafe);
    const a = await rpc(u, 'claim_visit', { p_claim_id: claim, p_challenge_id: C.cafe, p_code: code });
    const b = await rpc(u, 'claim_visit', { p_claim_id: claim, p_challenge_id: C.cafe, p_code: code });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(b.replay, true);
    assert.equal(b.visit_id, a.visit_id);
    assert.equal(await balance(u), 500);
    assert.equal((await one('select count(*)::int c from public.visits where user_id = $1', [u])).c, 1);
    assert.equal((await one('select count(*)::int c from public.pasos_ledger where user_id = $1', [u])).c, 1);
  });

  test('código incorrecto: se rechaza, no acredita y se registra el intento', async () => {
    const u = await newPerson();
    const real = await freshCode(B.cafe);
    const wrong = real === '000000' ? '111111' : '000000';
    for (const bad of [wrong, '', 'abcdef', '12', '1234567']) {
      const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: bad });
      assert.equal(r.reason, 'codigo_incorrecto', bad);
    }
    assert.equal(await balance(u), 0);
    assert.equal((await one('select count(*)::int c from public.visit_attempts where user_id = $1', [u])).c, 5);
  });

  test('el código de otro comercio no sirve', async () => {
    const u = await newPerson();
    const codeOtro = await freshCode(B.pan);
    await freshCode(B.cafe);
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: codeOtro });
    assert.equal(r.reason, 'codigo_incorrecto');
  });

  test('desafío "una vez": la segunda visita ya no se acredita', async () => {
    const u = await newPerson();
    assert.equal((await visit(u, C.media, B.pan)).ok, true);
    const r = await visit(u, C.media, B.pan);
    assert.equal(r.reason, 'ya_acreditado');
    assert.equal(await balance(u), 800);
    // ni siquiera al día siguiente
    await sql("update public.visits set day = day - 1, created_at = created_at - interval '1 day' where user_id = $1", [u]);
    assert.equal((await visit(u, C.media, B.pan)).reason, 'ya_acreditado');
  });

  test('desafío "diaria": una vez por día; al día siguiente se puede de nuevo', async () => {
    const u = await newPerson();
    assert.equal((await visit(u, C.cafe, B.cafe)).ok, true);
    assert.equal((await visit(u, C.cafe, B.cafe)).reason, 'ya_acreditado_hoy');
    await sql("update public.visits set day = day - 1, created_at = created_at - interval '1 day' where user_id = $1", [u]);
    assert.equal((await visit(u, C.cafe, B.cafe)).ok, true);
    assert.equal(await balance(u), 1000);
  });

  test('límite por persona en desafíos repetibles', async () => {
    const ch = await mkChallenge({ perPerson: 2, reward: 50 });
    const u = await newPerson();
    for (let i = 0; i < 2; i++) {
      assert.equal((await visit(u, ch, B.cafe)).ok, true, `visita ${i + 1}`);
      await sql("update public.visits set day = day - 1, created_at = created_at - interval '1 day' where user_id = $1", [u]);
    }
    const r = await visit(u, ch, B.cafe);
    assert.equal(r.reason, 'limite_persona');
  });

  test('tope diario por persona (configurable) y se informa el número real', async () => {
    const u = await newPerson();
    const extra = await mkChallenge({ merchant: M.cafe });
    assert.equal((await visit(u, C.cafe, B.cafe)).ok, true);
    assert.equal((await visit(u, C.media, B.pan)).ok, true);
    assert.equal((await visit(u, C.lib, B.lib)).ok, true);
    const r = await visit(u, extra, B.cafe);
    assert.deepEqual([r.ok, r.reason, r.cap], [false, 'tope_diario', 3]);
    assert.equal(await balance(u), 500 + 800 + 400);

    await setConfig({ daily_cap: 1 });
    const u2 = await newPerson();
    assert.equal((await visit(u2, C.cafe, B.cafe)).ok, true);
    const r2 = await visit(u2, C.lib, B.lib);
    assert.deepEqual([r2.reason, r2.cap], ['tope_diario', 1]);
  });

  test('cupo total del desafío: hay que aceptarlo, y se corta cuando se ocupan todos los lugares', async () => {
    const ch = await mkChallenge({ quota: 2 });
    const [a, b, c] = [await newPerson(), await newPerson(), await newPerson()];
    assert.equal((await rpc(a, 'accept_challenge', { p_challenge_id: ch })).ok, true);
    assert.equal((await rpc(b, 'accept_challenge', { p_challenge_id: ch })).ok, true);
    assert.equal((await rpc(c, 'accept_challenge', { p_challenge_id: ch })).reason, 'cupo_agotado');
    assert.equal((await visit(c, ch, B.cafe)).reason, 'requiere_aceptar');
    assert.equal(await balance(c), 0);
    assert.equal((await visit(a, ch, B.cafe)).ok, true);
    assert.equal((await visit(b, ch, B.cafe)).ok, true);
  });

  test('desafíos que no están activos no se pueden reclamar', async () => {
    const u = await newPerson();
    const borrador = await mkChallenge({ status: 'borrador' });
    const revision = await mkChallenge({ status: 'revision' });
    const pausado = await mkChallenge({ status: 'pausado' });
    const futuro = await mkChallenge({ status: 'programado', start: new Date(Date.now() + 86400000).toISOString() });
    for (const ch of [borrador, revision, pausado, futuro]) {
      assert.equal((await visit(u, ch, B.cafe)).reason, 'desafio_no_disponible');
    }
    const vencido = await mkChallenge({ status: 'activo', start: new Date(Date.now() - 3 * 86400000).toISOString(),
      end: new Date(Date.now() - 86400000).toISOString() });
    assert.equal((await visit(u, vencido, B.cafe)).reason, 'desafio_finalizado');
    const finalizado = await mkChallenge({ status: 'finalizado' });
    assert.equal((await visit(u, finalizado, B.cafe)).reason, 'desafio_finalizado');
    // programado cuya fecha de inicio ya pasó: arranca solo
    const arranco = await mkChallenge({ status: 'programado', start: new Date(Date.now() - 60000).toISOString() });
    assert.equal((await visit(u, arranco, B.cafe)).ok, true);
    assert.equal(await balance(u), 100);
  });

  test('comercio suspendido: sus desafíos no se acreditan ni se listan', async () => {
    const u = await newPerson();
    await sql("update public.merchants set status = 'suspendido' where id = $1", [M.lib]);
    try {
      assert.equal((await visit(u, C.lib, B.lib)).reason, 'comercio_no_disponible');
      const list = await rpc(u, 'list_challenges');
      assert.ok(!list.some((c) => c.id === C.lib));
    } finally {
      await sql("update public.merchants set status = 'activo' where id = $1", [M.lib]);
    }
  });

  test('pausa global: no se acreditan visitas ni se entregan premios, y no queda ningún rastro', async () => {
    const u = await newPerson({ pasos: 5000 });
    const code = await freshCode(B.cafe);
    await setConfig({ paused: true });
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code });
    assert.equal(r.reason, 'pausa');
    assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe })).reason, 'pausa');
    assert.equal(await balance(u), 5000);
    assert.equal((await one('select count(*)::int c from public.visits where user_id = $1', [u])).c, 0);
    assert.equal((await one('select count(*)::int c from public.coupons where user_id = $1', [u])).c, 0);
    await setConfig({ paused: false });
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code })).ok, true);
  });

  test('cuenta suspendida: no puede reclamar', async () => {
    const u = await newPerson({ pasos: 5000 });
    await sql("update public.profiles set status = 'suspendido' where user_id = $1", [u]);
    assert.equal((await visit(u, C.cafe, B.cafe)).reason, 'cuenta_suspendida');
    assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe })).reason, 'cuenta_suspendida');
  });

  test('código vencido vs. período de gracia del código anterior', async () => {
    const u1 = await newPerson(), u2 = await newPerson(), u3 = await newPerson();
    const code1 = await freshCode(B.cafe);
    // pasan 50 s: toca rotar; el código 1 queda "en gracia" hasta 75 s desde que nació
    await sql("update public.visit_codes set rotated_at = now() - interval '50 seconds' where branch_id = $1", [B.cafe]);
    const code2 = await currentCode(B.cafe);
    assert.notEqual(code1, code2);
    const enGracia = await rpc(u1, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code1 });
    assert.equal(enGracia.ok, true, 'el código anterior vale durante la gracia');
    // se acaba la gracia
    await sql("update public.visit_codes set prev_valid_until = now() - interval '1 second' where branch_id = $1", [B.cafe]);
    const vencido = await rpc(u2, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code1 });
    assert.equal(vencido.reason, 'codigo_vencido');
    // el vigente sigue sirviendo
    assert.equal((await rpc(u3, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code2 })).ok, true);
  });

  test('un código viejo (de hace varias rotaciones) figura como vencido', async () => {
    const u = await newPerson();
    const c1 = await freshCode(B.cafe);
    await freshCode(B.cafe);
    await freshCode(B.cafe);
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: c1 });
    assert.equal(r.reason, 'codigo_vencido');
  });

  test('la rotación es del servidor: sin consultas, un código viejo no se "estira" más allá de la gracia', async () => {
    const u = await newPerson();
    const code1 = await freshCode(B.cafe);
    // nadie consultó durante 10 minutos: al llegar el reclamo con el código 1, ya está vencido
    await sql("update public.visit_codes set rotated_at = now() - interval '10 minutes' where branch_id = $1", [B.cafe]);
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code1 });
    assert.equal(r.reason, 'codigo_vencido');
  });

  test('máximo de usos por código', async () => {
    const code = await freshCode(B.cafe);
    const ch = await mkChallenge({ merchant: M.cafe, reward: 10 });
    const users = [];
    for (let i = 0; i < 5; i++) users.push(await newPerson());
    const results = [];
    for (const u of users) results.push(await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: ch, p_code: code }));
    assert.deepEqual(results.map((r) => r.ok), [true, true, true, true, false]);
    assert.equal(results[4].reason, 'codigo_agotado');
    assert.equal(await balance(users[4]), 0);
  });

  test('intentos fallidos repetidos bloquean temporalmente y generan una alerta', async () => {
    const u = await newPerson();
    const bystander = await newPerson();
    const real = await freshCode(B.cafe);
    for (let i = 0; i < 5; i++) {
      assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: i === 0 ? '999999' : '99999' + i })).reason, 'codigo_incorrecto');
    }
    // aunque ahora acierte el código, queda bloqueado
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: real });
    assert.equal(r.reason, 'demasiados_intentos');
    assert.equal(await balance(u), 0);
    const alert = await one("select * from public.alerts where kind = 'intentos_codigo' and entity_id = $1", [u]);
    assert.ok(alert, 'se creó la alerta');
    assert.equal(alert.severity, 'media');
    // otra persona no se ve afectada
    assert.equal((await rpc(bystander, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: real })).ok, true);
    // pasados 10 minutos se libera
    await sql("update public.visit_attempts set ts = now() - interval '11 minutes' where user_id = $1", [u]);
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: real })).ok, true);
  });

  test('ventana de 5 minutos para reclamos diferidos', async () => {
    const u = await newPerson();
    const code = await freshCode(B.cafe);
    const viejo = new Date(Date.now() - 6 * 60000).toISOString();
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code, p_claimed_at: viejo })).reason, 'reclamo_vencido');
    const reciente = new Date(Date.now() - 60000).toISOString();
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code, p_claimed_at: reciente })).ok, true);
  });

  test('el comercio debe estar validando cuando así se exige (pantalla Código abierta)', async () => {
    await setConfig({ require_merchant_active: true });
    const u = await newPerson();
    const code = await freshCode(B.cafe);
    await sql('update public.visit_codes set active_until = null where branch_id = $1', [B.cafe]);
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code });
    assert.equal(r.reason, 'comercio_sin_validacion');
    // el comercio abre su pantalla Código: queda validando
    const shown = await rpc(U.cafe, 'merchant_current_code', { p_branch: B.cafe });
    assert.equal(shown.validating, true);
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: shown.code })).ok, true);
    // y si deja de consultar, vuelve a quedar sin validación
    await sql("update public.visit_codes set active_until = now() - interval '1 second' where branch_id = $1", [B.cafe]);
    const u2 = await newPerson();
    assert.equal((await rpc(u2, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: shown.code })).reason, 'comercio_sin_validacion');
  });

  test('con varios locales, el código de cualquiera de ellos sirve y se registra cuál fue', async () => {
    const u = await newPerson();
    const code2 = await freshCode(B.cafe2);
    await freshCode(B.cafe);
    const r = await rpc(u, 'claim_visit', { p_claim_id: uuid(), p_challenge_id: C.cafe, p_code: code2 });
    assert.equal(r.ok, true);
    assert.equal((await one('select branch_id from public.visits where user_id = $1', [u])).branch_id, B.cafe2);
  });

  test('ubicación (cuando está exigida): rango, precisión y sin guardar la posición', async () => {
    await setConfig({ require_gps: true });
    const u = await newPerson();
    const code = await freshCode(B.cafe);
    const base = { p_challenge_id: C.cafe, p_code: code };
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), ...base })).reason, 'ubicacion_requerida');
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), ...base, p_lat: -34.588, p_lng: -58.43, p_accuracy: 500 })).reason, 'precision_insuficiente');
    assert.equal((await rpc(u, 'claim_visit', { p_claim_id: uuid(), ...base, p_lat: -34.60, p_lng: -58.38, p_accuracy: 15 })).reason, 'fuera_de_rango');
    const ok = await rpc(u, 'claim_visit', { p_claim_id: uuid(), ...base, p_lat: -34.5881, p_lng: -58.4301, p_accuracy: 15 });
    assert.equal(ok.ok, true);
    assert.equal((await one('select gps_verified from public.visits where user_id = $1', [u])).gps_verified, true);
    const cols = await sql("select column_name from information_schema.columns where table_name in ('visits','visit_attempts') and column_name ~* 'lat|lng|lon|geo|position'");
    assert.deepEqual(cols, [], 'no se guarda la ubicación de las personas');
    // los intentos rechazados por ubicación NO consumieron usos del código
    assert.equal((await one('select uses from public.visit_codes where branch_id = $1', [B.cafe])).uses, 1);
  });

  test('si cambia la tarifa del comercio, las visitas anteriores conservan la suya', async () => {
    const a = await newPerson();
    await visit(a, C.cafe, B.cafe);
    await setConfig({ fee_per_visit: 350 });
    const b = await newPerson();
    await visit(b, C.cafe, B.cafe);
    await setConfig({ fee_per_visit: 200 });
    assert.equal(Number((await one('select fee_ars from public.visits where user_id = $1', [a])).fee_ars), 200);
    assert.equal(Number((await one('select fee_ars from public.visits where user_id = $1', [b])).fee_ars), 350);
  });
});

describe('meta de pasos caminados', () => {
  test('los pasos solo se muestran; el premio sale del desafío y una vez por día', async () => {
    const u = await newPerson();
    const sin = await rpc(u, 'claim_step_goal', { p_claim_id: uuid(), p_challenge_id: C.pasos });
    assert.deepEqual([sin.ok, sin.reason, sin.goal], [false, 'meta_no_alcanzada', 8000]);
    await rpc(u, 'test_add_steps', { p_amount: 5000 });
    assert.equal((await rpc(u, 'claim_step_goal', { p_claim_id: uuid(), p_challenge_id: C.pasos })).reason, 'meta_no_alcanzada');
    assert.equal(await balance(u), 0, 'caminar no suma PASOS por sí solo');
    await rpc(u, 'test_add_steps', { p_amount: 5000 });
    const ok = await rpc(u, 'claim_step_goal', { p_claim_id: uuid(), p_challenge_id: C.pasos });
    assert.equal(ok.ok, true);
    assert.equal(ok.pasos, 300);
    assert.equal(await balance(u), 300);
    assert.equal((await rpc(u, 'claim_step_goal', { p_claim_id: uuid(), p_challenge_id: C.pasos })).reason, 'ya_acreditado_hoy');
    assert.equal((await rpc(u, 'person_home')).today_steps, 10000);
  });

  test('con el modo prueba apagado, los pasos simulados no cuentan', async () => {
    const u = await newPerson();
    await rpc(u, 'test_add_steps', { p_amount: 9000 });
    await setConfig({ test_mode: false });
    assert.equal((await rpc(u, 'claim_step_goal', { p_claim_id: uuid(), p_challenge_id: C.pasos })).reason, 'meta_no_alcanzada');
    assert.equal((await rpc(u, 'person_home')).today_steps, 0);
  });

  test('una visita no se puede reclamar como meta de pasos ni al revés', async () => {
    const u = await newPerson();
    assert.equal((await rpc(u, 'claim_step_goal', { p_claim_id: uuid(), p_challenge_id: C.cafe })).reason, 'desafio_no_encontrado');
    assert.equal((await visit(u, C.pasos, B.cafe)).reason, 'desafio_no_encontrado');
  });
});

describe('premios y cupones', () => {
  test('canje correcto: descuenta PASOS, baja el stock y entrega un cupón único', async () => {
    const u = await newPerson({ pasos: 3500 });
    const stock0 = (await one('select stock from public.rewards where id = $1', [R.cafe])).stock;
    const r = await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    assert.equal(r.ok, true);
    assert.match(r.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(r.balance, 500);
    assert.equal(await balance(u), 500);
    assert.equal(await ledgerSum(u), 500);
    assert.equal((await one('select stock from public.rewards where id = $1', [R.cafe])).stock, stock0 - 1);
    const c = await one('select * from public.coupons where user_id = $1', [u]);
    assert.equal(c.status, 'pendiente');
    assert.equal(c.merchant_id, M.cafe);
    assert.equal(c.cost_pasos, 3000);
    const l = await one("select * from public.pasos_ledger where user_id = $1 and kind = 'canje'", [u]);
    assert.equal(l.amount, -3000);
    const mine = await rpc(u, 'my_coupons');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'pendiente');
  });

  test('saldo insuficiente: no pasa nada y dice cuánto falta', async () => {
    const u = await newPerson({ pasos: 2999 });
    const r = await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    assert.deepEqual([r.ok, r.reason, r.missing], [false, 'saldo_insuficiente', 1]);
    assert.equal(await balance(u), 2999);
    assert.equal((await one('select count(*)::int c from public.coupons where user_id = $1', [u])).c, 0);
  });

  test('un reintento con el mismo claim devuelve el mismo cupón y no cobra dos veces', async () => {
    const u = await newPerson({ pasos: 10000 });
    const claim = uuid();
    const a = await rpc(u, 'claim_reward', { p_claim_id: claim, p_reward_id: R.cafe });
    const b = await rpc(u, 'claim_reward', { p_claim_id: claim, p_reward_id: R.cafe });
    assert.equal(b.replay, true);
    assert.equal(b.code, a.code);
    assert.equal(await balance(u), 7000);
  });

  test('sin stock, límite por persona y premios no disponibles', async () => {
    const u = await newPerson({ pasos: 100000 });
    const sinStock = await mkReward({ cost: 100, stock: 1 });
    assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: sinStock })).ok, true);
    const otro = await newPerson({ pasos: 1000 });
    assert.equal((await rpc(otro, 'claim_reward', { p_claim_id: uuid(), p_reward_id: sinStock })).reason, 'sin_stock');
    assert.equal(await balance(otro), 1000);

    const limitado = await mkReward({ cost: 100, stock: null, perPerson: 1 });
    assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: limitado })).ok, true);
    assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: limitado })).reason, 'limite_persona');

    for (const status of ['borrador', 'pausado']) {
      const p = await mkReward({ cost: 100, status });
      assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: p })).reason, 'premio_no_disponible');
    }
    assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: uuid() })).reason, 'premio_no_disponible');
  });

  test('"ilimitado" (stock null) no se agota', async () => {
    const u = await newPerson({ pasos: 30000 });
    for (let i = 0; i < 3; i++) assert.equal((await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.libro })).ok, true);
    assert.equal((await one('select stock from public.rewards where id = $1', [R.libro])).stock, null);
  });

  test('cancelar un cupón pendiente devuelve los PASOS con un movimiento compensatorio y repone el stock', async () => {
    const u = await newPerson({ pasos: 3000 });
    const stock0 = (await one('select stock from public.rewards where id = $1', [R.cafe])).stock;
    const r = await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    const c = await one('select id, debit_ledger_id from public.coupons where user_id = $1', [u]);
    const x = await rpc(u, 'cancel_coupon', { p_coupon_id: c.id });
    assert.equal(x.ok, true);
    assert.equal(x.balance, 3000);
    assert.equal(await ledgerSum(u), 3000);
    const refund = await one("select * from public.pasos_ledger where user_id = $1 and kind = 'devolucion'", [u]);
    assert.equal(refund.amount, 3000);
    assert.equal(String(refund.reverses_id), String(c.debit_ledger_id));
    assert.equal((await one('select stock from public.rewards where id = $1', [R.cafe])).stock, stock0);
    // el movimiento original sigue ahí
    assert.equal((await one('select amount from public.pasos_ledger where id = $1', [c.debit_ledger_id])).amount, -3000);
    // no se puede cancelar dos veces ni usar un cupón cancelado
    assert.equal((await rpc(u, 'cancel_coupon', { p_coupon_id: c.id })).reason, 'cupon_no_cancelable');
    assert.equal(await balance(u), 3000);
    const lk = await rpc(U.cafe, 'lookup_coupon', { p_merchant: M.cafe, p_code: r.code });
    assert.equal(lk.reason, 'cupon_cancelado');
  });

  test('nadie puede cancelar el cupón de otra persona', async () => {
    const a = await newPerson({ pasos: 3000 });
    const b = await newPerson();
    await rpc(a, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    const c = await one('select id from public.coupons where user_id = $1', [a]);
    assert.equal((await rpc(b, 'cancel_coupon', { p_coupon_id: c.id })).reason, 'cupon_no_encontrado');
    assert.equal((await one('select status from public.coupons where id = $1', [c.id])).status, 'pendiente');
  });

  test('un cupón vencido figura como vencido y ya no se puede cancelar', async () => {
    const u = await newPerson({ pasos: 3000 });
    await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    await sql("update public.coupons set expires_at = now() - interval '1 minute' where user_id = $1", [u]);
    const mine = await rpc(u, 'my_coupons');
    assert.equal(mine[0].status, 'vencido');
    const c = await one('select id from public.coupons where user_id = $1', [u]);
    assert.equal((await rpc(u, 'cancel_coupon', { p_coupon_id: c.id })).reason, 'cupon_vencido');
  });

  test('las condiciones del cupón se conservan aunque cambie el premio', async () => {
    const u = await newPerson({ pasos: 10000 });
    await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.fact });
    await sql("update public.rewards set cost_pasos = 9000, title = 'Otra cosa', conditions = 'cambió' where id = $1", [R.fact]);
    try {
      const c = (await rpc(u, 'my_coupons'))[0];
      assert.equal(c.reward_title, 'Docena de facturas');
      assert.equal(c.cost_pasos, 6000);
      assert.match(c.conditions, /Retirar en el local/);
    } finally {
      await sql("update public.rewards set cost_pasos = 6000, title = 'Docena de facturas', conditions = 'Retirar en el local presentando el cupón.' where id = $1", [R.fact]);
    }
  });
});

describe('modo prueba', () => {
  test('botones de prueba: solo montos permitidos y solo si el modo está activo', async () => {
    const u = await newPerson();
    for (const amount of [500, 2000, 5000]) assert.equal((await rpc(u, 'test_add_pasos', { p_claim_id: uuid(), p_amount: amount })).ok, true);
    assert.equal(await balance(u), 7500);
    assert.equal((await rpc(u, 'test_add_pasos', { p_claim_id: uuid(), p_amount: 100 })).reason, 'monto_invalido');
    assert.equal((await rpc(u, 'test_add_pasos', { p_claim_id: uuid(), p_amount: -500 })).reason, 'monto_invalido');
    const claim = uuid();
    await rpc(u, 'test_add_pasos', { p_claim_id: claim, p_amount: 500 });
    await rpc(u, 'test_add_pasos', { p_claim_id: claim, p_amount: 500 });
    assert.equal(await balance(u), 8000, 'el doble toque no suma dos veces');
    const l = await one("select kind from public.pasos_ledger where user_id = $1 limit 1", [u]);
    assert.equal(l.kind, 'prueba');

    await setConfig({ test_mode: false });
    assert.equal((await rpc(u, 'test_add_pasos', { p_claim_id: uuid(), p_amount: 500 })).reason, 'modo_prueba_inactivo');
    assert.equal((await rpc(u, 'test_add_steps', { p_amount: 500 })).reason, 'modo_prueba_inactivo');
    assert.equal((await rpc(u, 'test_peek_code', { p_merchant: M.cafe })).reason, 'modo_prueba_inactivo');
  });

  test('en producción el modo prueba no existe aunque la bandera esté prendida', async () => {
    const u = await newPerson();
    await setConfig({ test_mode: true, environment: 'produccion' });
    assert.equal((await rpc(u, 'test_add_pasos', { p_claim_id: uuid(), p_amount: 500 })).reason, 'modo_prueba_inactivo');
    assert.equal((await rpc(u, 'my_context')).config.test_mode, false);
    assert.equal((await rpc(null, 'public_config', {}, { role: 'anon' })).test_mode, false);
    assert.equal(await balance(u), 0);
  });
});

describe('mis datos', () => {
  test('exportar entrega todo lo propio', async () => {
    const u = await newPerson({ name: 'Lucía', birth: '1985-05-05', pasos: 3500 });
    await visit(u, C.cafe, B.cafe);
    await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    const e = await rpc(u, 'export_my_data');
    assert.equal(e.profile.display_name, 'Lucía');
    assert.equal(e.profile.birth_date, '1985-05-05');
    assert.equal(e.visits.length, 1);
    assert.equal(e.coupons.length, 1);
    assert.ok(e.ledger.length >= 3);
    assert.equal(e.balance, 1000);
  });

  test('eliminar la cuenta borra los datos personales y deja los movimientos anonimizados', async () => {
    const u = await newPerson({ name: 'Borrar', pasos: 3500 });
    await visit(u, C.cafe, B.cafe);
    await rpc(u, 'test_add_steps', { p_amount: 1000 });
    await rpc(u, 'claim_reward', { p_claim_id: uuid(), p_reward_id: R.cafe });
    const stockAntes = (await one('select stock from public.rewards where id = $1', [R.cafe])).stock;
    const nLedger = (await one('select count(*)::int c from public.pasos_ledger where user_id = $1', [u])).c;
    const r = await rpc(u, 'delete_my_account');
    assert.equal(r.ok, true);
    for (const t of ['profiles', 'wallets', 'consents', 'step_days', 'visit_attempts']) {
      assert.equal((await one(`select count(*)::int c from public.${t} where user_id = $1`, [u])).c, 0, t);
    }
    for (const t of ['pasos_ledger', 'visits', 'coupons']) {
      assert.equal((await one(`select count(*)::int c from public.${t} where user_id = $1`, [u])).c, 0, `${t} sin vínculo`);
    }
    assert.ok((await one('select count(*)::int c from public.pasos_ledger where user_id is null and kind = $1', ['visita'])).c >= 1);
    assert.equal((await one("select count(*)::int c from public.pasos_ledger where user_id is null")).c >= nLedger, true);
    // cupón pendiente anulado y stock repuesto
    assert.equal((await one('select stock from public.rewards where id = $1', [R.cafe])).stock, stockAntes + 1);
    // ya no puede operar
    const e = await rpcFail(u, 'person_home');
    assert.match(e.message, /sin_perfil/);
  });
});
