// Lógica de las Edge Functions de cuentas (supabase/functions/_shared/accounts.ts) contra la base real.
// "callerRpc" usa la misma vía que la API (rol authenticated + JWT de quien llama); "admin" imita al cliente de servicio.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, one, rpc, newPerson, end, U, M, uuid } from './helpers.mjs';
import { createAccount, resetPassword, deleteAccount, phoneToEmail, passwordProblem } from '../supabase/functions/_shared/accounts.ts';

after(end);

const passwords = new Map();
function depsFor(uid, { aal = 'aal2' } = {}) {
  return {
    async callerRpc(fn, args = {}) {
      if (!uid) throw new Error('sin sesión');
      return rpc(uid, fn, args, { aal });
    },
    admin: {
      async createUser(email, password) {
        if ((await sql('select 1 from auth.users where email = $1', [email])).length) return { error: 'User already registered' };
        const id = uuid();
        await sql('insert into auth.users (id, email) values ($1, $2)', [id, email]);
        passwords.set(id, password);
        return { id };
      },
      async updatePassword(userId, password) { passwords.set(userId, password); return {}; },
      async deleteUser(userId) { await sql('delete from auth.users where id = $1', [userId]); passwords.delete(userId); return {}; },
    },
  };
}
const usersCount = async () => Number((await one('select count(*) as n from auth.users')).n);
const valid = (o = {}) => ({ role: 'comercio', merchant_id: M.cafe, display_name: 'Mostrador 2', phone: '+54 9 11 5555 1234', password: 'Clave-segura-2026', ...o });

describe('utilidades', () => {
  test('el teléfono se convierte igual que en la app web', () => {
    assert.equal(phoneToEmail('+54 9 11 5555-1234'), 'p5491155551234@cuentas.anda.app');
  });
  test('contraseña: 10+ caracteres con letra y número', () => {
    assert.equal(passwordProblem('Clave-segura-2026'), null);
    for (const bad of ['corta1A', 'sololetrassinnumero', '12345678901234', null, 123, 'x'.repeat(80) + '1'])
      assert.equal(passwordProblem(bad), 'password_invalida');
  });
});

describe('admin-create-account', () => {
  test('el CEO crea una cuenta de comercio: queda con cambio de clave obligatorio y auditada', async () => {
    const r = await createAccount(valid(), depsFor(U.ceo));
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body.ok, true);
    const role = await one('select * from public.user_roles where user_id = $1', [r.body.user_id]);
    assert.equal(role.role, 'comercio');
    assert.equal(role.merchant_id, M.cafe);
    assert.equal(role.must_change_password, true);
    const u = await one('select email from auth.users where id = $1', [r.body.user_id]);
    assert.equal(u.email, 'p5491155551234@cuentas.anda.app');
    const a = await one("select count(*)::int as n from public.audit_log where action = 'cuenta_creada' and target_id = $1", [role.id]);
    assert.equal(a.n, 1);
  });

  test('el CEO crea una cuenta de equipo con permisos acotados', async () => {
    const r = await createAccount(valid({ role: 'equipo', merchant_id: null, phone: '+54 9 11 5555 2000', display_name: 'Ana', perms: ['desafios.editar', 'fotos.gestionar'] }), depsFor(U.ceo));
    assert.equal(r.status, 200, JSON.stringify(r));
    const role = await one('select perms, merchant_id from public.user_roles where user_id = $1', [r.body.user_id]);
    assert.deepEqual(role.perms.sort(), ['desafios.editar', 'fotos.gestionar']);
    assert.equal(role.merchant_id, null);
  });

  test('personas, comercios y equipo NO pueden crear cuentas, y no se crea ningún usuario', async () => {
    const persona = await newPerson();
    const before = await usersCount();
    for (const uid of [persona, U.cafe, U.gestor, U.aprobador]) {
      const r = await createAccount(valid({ phone: '+54 9 11 5555 3000' }), depsFor(uid));
      assert.equal(r.status, 403, `uid ${uid}: ${JSON.stringify(r)}`);
    }
    assert.equal(await usersCount(), before);
  });

  test('sin sesión: 401 y no se crea nada', async () => {
    const before = await usersCount();
    const r = await createAccount(valid(), depsFor(null));
    assert.equal(r.status, 401);
    assert.equal(await usersCount(), before);
  });

  test('datos inválidos: 400 y no se crea ningún usuario', async () => {
    const before = await usersCount();
    const casos = [
      [valid({ role: 'ceo' }), 'rol_invalido'],
      [valid({ role: 'admin' }), 'rol_invalido'],
      [valid({ display_name: '   ' }), 'campo_invalido'],
      [valid({ phone: '123' }), 'telefono_invalido'],
      [valid({ password: 'corta1' }), 'password_invalida'],
      [valid({ merchant_id: 'no-es-uuid' }), 'comercio_no_encontrada'.replace('encontrada', 'encontrado')],
      [valid({ role: 'equipo', merchant_id: null, perms: ['todo.poderoso'] }), 'permiso_invalido'],
      [null, 'rol_invalido'],
    ];
    for (const [body, reason] of casos) {
      const r = await createAccount(body, depsFor(U.ceo));
      assert.equal(r.status, 400, JSON.stringify([body, r]));
      assert.equal(r.body.reason, reason);
    }
    assert.equal(await usersCount(), before);
  });

  test('comercio inexistente: la base lo rechaza y el usuario de acceso se deshace (sin cuentas huérfanas)', async () => {
    const before = await usersCount();
    const r = await createAccount(valid({ merchant_id: uuid(), phone: '+54 9 11 5555 4000' }), depsFor(U.ceo));
    assert.equal(r.status, 422);
    assert.equal(r.body.reason, 'comercio_no_encontrado');
    assert.equal(await usersCount(), before);
  });

  test('teléfono ya usado: 409 y la cuenta original no se toca', async () => {
    const r1 = await createAccount(valid({ phone: '+54 9 11 5555 5000' }), depsFor(U.ceo));
    assert.equal(r1.status, 200);
    const before = await usersCount();
    const r2 = await createAccount(valid({ phone: '+54 9 11 5555 5000', display_name: 'Otro' }), depsFor(U.ceo));
    assert.equal(r2.status, 409);
    assert.equal(r2.body.reason, 'telefono_en_uso');
    assert.equal(await usersCount(), before);
  });

  test('con segundo factor obligatorio, una sesión sin él (aal1) no puede crear cuentas', async () => {
    await sql('update public.app_config set mfa_required = true');
    try {
      const before = await usersCount();
      const r = await createAccount(valid({ phone: '+54 9 11 5555 6000' }), depsFor(U.ceo, { aal: 'aal1' }));
      assert.equal(r.status, 403);
      assert.equal(r.body.reason, 'mfa_requerida');
      assert.equal(await usersCount(), before);
      const ok = await createAccount(valid({ phone: '+54 9 11 5555 6000' }), depsFor(U.ceo, { aal: 'aal2' }));
      assert.equal(ok.status, 200, JSON.stringify(ok));
    } finally {
      await sql('update public.app_config set mfa_required = false');
    }
  });

  test('la respuesta nunca devuelve la contraseña', async () => {
    const r = await createAccount(valid({ phone: '+54 9 11 5555 7000' }), depsFor(U.ceo));
    assert.ok(!JSON.stringify(r).includes('Clave-segura-2026'));
  });
});

describe('admin-reset-password', () => {
  async function cuenta(phone) {
    const r = await createAccount(valid({ phone }), depsFor(U.ceo));
    assert.equal(r.status, 200);
    await sql('update public.user_roles set must_change_password = false where user_id = $1', [r.body.user_id]);
    return r.body.user_id;
  }

  test('el CEO restablece: cambia la clave, exige cambiarla al entrar y queda auditado', async () => {
    const uid = await cuenta('+54 9 11 5555 8000');
    const r = await resetPassword({ user_id: uid, password: 'Otra-clave-2026' }, depsFor(U.ceo));
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(passwords.get(uid), 'Otra-clave-2026');
    assert.equal((await one('select must_change_password from public.user_roles where user_id = $1', [uid])).must_change_password, true);
    assert.ok((await one("select count(*)::int n from public.audit_log where action = 'cuenta_clave_restablecida' and target_id = $1", [uid])).n >= 1);
  });

  test('no se puede restablecer la clave del CEO (ni de quien no tiene cuenta de comercio/equipo)', async () => {
    const persona = await newPerson();
    for (const target of [U.ceo, persona, uuid()]) {
      passwords.set(target, 'original-1234');
      const r = await resetPassword({ user_id: target, password: 'Otra-clave-2026' }, depsFor(U.ceo));
      assert.equal(r.status, 422, JSON.stringify(r));
      assert.equal(r.body.reason, 'cuenta_no_encontrada');
      assert.equal(passwords.get(target), 'original-1234', 'la clave no debe haber cambiado');
    }
  });

  test('solo el CEO: comercio, equipo y personas reciben 403 y la clave no cambia', async () => {
    const uid = await cuenta('+54 9 11 5555 8100');
    passwords.set(uid, 'original-1234');
    for (const caller of [U.cafe, U.gestor, U.aprobador, await newPerson()]) {
      const r = await resetPassword({ user_id: uid, password: 'Otra-clave-2026' }, depsFor(caller));
      assert.equal(r.status, 403);
    }
    assert.equal(passwords.get(uid), 'original-1234');
  });

  test('datos inválidos: 400', async () => {
    const uid = await cuenta('+54 9 11 5555 8200');
    assert.equal((await resetPassword({ user_id: 'x', password: 'Otra-clave-2026' }, depsFor(U.ceo))).status, 400);
    assert.equal((await resetPassword({ user_id: uid, password: 'corta' }, depsFor(U.ceo))).status, 400);
    assert.equal((await resetPassword(null, depsFor(U.ceo))).status, 400);
  });
});

describe('delete-account', () => {
  test('una persona que ya borró sus datos puede borrar su usuario de acceso', async () => {
    const persona = await newPerson({ pasos: 100 });
    assert.equal((await rpc(persona, 'delete_my_account')).ok, true);
    const r = await deleteAccount(depsFor(persona));
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await sql('select 1 from auth.users where id = $1', [persona])).length, 0);
  });

  test('si todavía tiene su perfil, no se borra el acceso (primero se eliminan los datos)', async () => {
    const persona = await newPerson();
    const r = await deleteAccount(depsFor(persona));
    assert.equal(r.status, 409);
    assert.equal(r.body.reason, 'primero_eliminar_datos');
    assert.equal((await sql('select 1 from auth.users where id = $1', [persona])).length, 1);
  });

  test('cuentas de comercio, equipo o CEO nunca se borran por acá', async () => {
    for (const uid of [U.cafe, U.gestor, U.ceo]) {
      const r = await deleteAccount(depsFor(uid));
      assert.equal(r.status, 403);
      assert.equal(r.body.reason, 'cuenta_con_rol');
      assert.equal((await sql('select 1 from auth.users where id = $1', [uid])).length, 1);
    }
  });

  test('sin sesión: 401', async () => {
    assert.equal((await deleteAccount(depsFor(null))).status, 401);
  });
});
