// Lógica de las Edge Functions de cuentas, SIN dependencias de Deno ni de Supabase:
// todo lo externo entra por "deps". Así se prueba en Node (supabase/functions/tests) y se usa igual en Deno.
//
// Reglas de seguridad (valen para las tres funciones):
//  1) La clave de servicio (service_role) solo se usa DESPUÉS de comprobar quién llama.
//  2) "Quién llama" se comprueba con la sesión de la persona (su JWT), no con datos que mande el navegador.
//  3) Cada operación termina siempre en una función de la base (RPC) que audita y vuelve a validar permisos.

export interface Json { [k: string]: unknown }

export interface Deps {
  /** Llama a una función RPC con la sesión de quien invoca (su JWT). Lanza si el servidor responde error. */
  callerRpc(fn: string, args?: Json): Promise<unknown>;
  /** Operaciones de administración de usuarios (requieren clave de servicio). */
  admin: {
    createUser(email: string, password: string): Promise<{ id: string } | { error: string }>;
    updatePassword(userId: string, password: string): Promise<{ error?: string }>;
    deleteUser(userId: string): Promise<{ error?: string }>;
  };
}

export interface Result { status: number; body: Json }

const PERMS = [
  'desafios.editar', 'desafios.aprobar', 'catalogo.gestionar', 'fotos.gestionar',
  'personas.ver', 'visitas.ver', 'cupones.ver', 'auditoria.ver',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const fail = (status: number, reason: string, extra: Json = {}): Result => ({ status, body: { ok: false, reason, ...extra } });
const ok = (body: Json = {}): Result => ({ status: 200, body: { ok: true, ...body } });

/** Mismo criterio que la app web (phoneToEmail): el teléfono se convierte en un correo sintético. */
export function phoneToEmail(phone: string): string {
  return `p${phone.replace(/\D/g, '')}@cuentas.anda.app`;
}

/** Contraseña mínima para cuentas de comercio/equipo: 10+ caracteres, con letra y número. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'password_invalida';
  if (pw.length < 10 || pw.length > 72) return 'password_invalida';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'password_invalida';
  return null;
}

interface Role { role?: string; merchant_id?: string | null }
interface Ctx { uid?: string; roles?: Role[]; profile?: unknown; aal?: string; config?: { mfa_required?: boolean } }

async function context(deps: Deps): Promise<Ctx | null> {
  try {
    const c = (await deps.callerRpc('my_context')) as Ctx | null;
    return c && typeof c === 'object' ? c : null;
  } catch { return null; }
}

/** Solo el CEO (con su segundo factor si la sesión lo exige) puede crear cuentas o restablecer contraseñas. */
async function requireCeo(deps: Deps): Promise<Result | null> {
  const ctx = await context(deps);
  if (!ctx?.uid) return fail(401, 'sin_sesion');
  if (!(ctx.roles ?? []).some((r) => r.role === 'ceo')) return fail(403, 'sin_permiso');
  if (ctx.config?.mfa_required && ctx.aal !== 'aal2') return fail(403, 'mfa_requerida');
  return null;
}

// ---------------------------------------------------------------------------------------------
export async function createAccount(raw: unknown, deps: Deps): Promise<Result> {
  const denied = await requireCeo(deps);
  if (denied) return denied;

  const b = (raw && typeof raw === 'object' ? raw : {}) as Json;
  const role = b.role;
  if (role !== 'equipo' && role !== 'comercio') return fail(400, 'rol_invalido');
  const name = typeof b.display_name === 'string' ? b.display_name.trim() : '';
  if (name.length < 1 || name.length > 80) return fail(400, 'campo_invalido', { field: 'display_name' });
  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return fail(400, 'telefono_invalido');
  const pwBad = passwordProblem(b.password);
  if (pwBad) return fail(400, pwBad);

  let merchant: string | null = null;
  let perms: string[] = [];
  if (role === 'comercio') {
    if (typeof b.merchant_id !== 'string' || !UUID.test(b.merchant_id)) return fail(400, 'comercio_no_encontrado');
    merchant = b.merchant_id;
  } else {
    perms = Array.isArray(b.perms) ? (b.perms as unknown[]).filter((p): p is string => typeof p === 'string') : [];
    if (perms.some((p) => !PERMS.includes(p))) return fail(400, 'permiso_invalido');
  }

  const created = await deps.admin.createUser(phoneToEmail(phone), b.password as string);
  if ('error' in created) {
    const dup = /already|registered|exists|duplicate/i.test(created.error);
    return dup ? fail(409, 'telefono_en_uso') : fail(500, 'no_se_pudo_crear');
  }

  // La base valida de nuevo que quien llama sea CEO, valida comercio y permisos, y deja constancia en la auditoría.
  let reg: Json;
  try {
    reg = (await deps.callerRpc('admin_register_role', {
      p_user: created.id, p_role: role, p_merchant: merchant, p_perms: perms, p_display_name: name, p_phone: phone,
    })) as Json;
  } catch {
    await deps.admin.deleteUser(created.id);
    return fail(500, 'no_se_pudo_crear');
  }
  if (!reg?.ok) {
    // Deshace el usuario de acceso para no dejar cuentas huérfanas.
    await deps.admin.deleteUser(created.id);
    return fail(422, String(reg?.reason ?? 'no_se_pudo_crear'));
  }
  return ok({ user_id: created.id, id: reg.id });
}

// ---------------------------------------------------------------------------------------------
export async function resetPassword(raw: unknown, deps: Deps): Promise<Result> {
  const denied = await requireCeo(deps);
  if (denied) return denied;

  const b = (raw && typeof raw === 'object' ? raw : {}) as Json;
  if (typeof b.user_id !== 'string' || !UUID.test(b.user_id)) return fail(400, 'cuenta_no_encontrada');
  const pwBad = passwordProblem(b.password);
  if (pwBad) return fail(400, pwBad);

  // Primero la base: comprueba que sea una cuenta de comercio/equipo (nunca el CEO), exige el cambio de clave
  // al próximo ingreso y deja constancia. Recién después se cambia la contraseña.
  let flag: Json;
  try {
    flag = (await deps.callerRpc('admin_flag_password_reset', { p_user: b.user_id })) as Json;
  } catch {
    return fail(403, 'sin_permiso');
  }
  if (!flag?.ok) return fail(422, String(flag?.reason ?? 'cuenta_no_encontrada'));

  const up = await deps.admin.updatePassword(b.user_id, b.password as string);
  if (up.error) return fail(500, 'no_se_pudo_cambiar');
  return ok();
}

// ---------------------------------------------------------------------------------------------
/**
 * Borra el usuario de acceso de una PERSONA que ya eliminó sus datos (delete_my_account).
 * Solo borra a quien llama y solo si ya no tiene perfil ni ningún rol: una cuenta de comercio/equipo
 * nunca se borra por acá.
 */
export async function deleteAccount(deps: Deps): Promise<Result> {
  const ctx = await context(deps);
  if (!ctx?.uid) return fail(401, 'sin_sesion');
  if ((ctx.roles ?? []).length > 0) return fail(403, 'cuenta_con_rol');
  if (ctx.profile) return fail(409, 'primero_eliminar_datos');
  const r = await deps.admin.deleteUser(ctx.uid);
  if (r.error) return fail(500, 'no_se_pudo_eliminar');
  return ok();
}
