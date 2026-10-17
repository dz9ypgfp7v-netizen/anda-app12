// Modo DEMO: la misma base de datos (migraciones SQL reales) corriendo dentro del navegador con PGlite.
// Sirve para probar y mostrar la app sin crear nada en Supabase. No hay cuentas reales ni envíos.
import { PGlite } from '@electric-sql/pglite';
import { downscale } from './photos';
import { ApiError, type Backend, type CreateAccountInput, type DemoAccount, type Session, type J, phoneToEmail } from './api';

const shim = import.meta.glob('../../../supabase/demo/supabase_shim.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const seed = import.meta.glob('../../../supabase/seed.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const demoUsers = import.meta.glob('../../../supabase/demo/demo_users.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const DB_NAME = 'anda-demo';
const KEY_UID = 'anda-demo-uid';
const KEY_HASH = 'anda-demo-hash';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { uid: 'e0000000-0000-4000-8000-000000000022', label: 'Sofía', hint: 'Persona con 4.000 PASOS de prueba', profile: 'persona' },
  { uid: 'e0000000-0000-4000-8000-000000000021', label: 'Persona nueva', hint: 'Todavía sin registrar: probás el alta (18+)', profile: 'persona' },
  { uid: 'e0000000-0000-4000-8000-000000000011', label: 'Café de la Esquina', hint: 'Comercio · muestra el código de visita y entrega cupones', profile: 'comercio' },
  { uid: 'e0000000-0000-4000-8000-000000000012', label: 'Panadería La Espiga', hint: 'Comercio', profile: 'comercio' },
  { uid: 'e0000000-0000-4000-8000-000000000001', label: 'CEO', hint: 'Acceso total: aprueba, configura y controla', profile: 'ceo' },
  { uid: 'e0000000-0000-4000-8000-000000000002', label: 'Equipo · Gestor', hint: 'Crea y edita desafíos, premios y fotos (no aprueba)', profile: 'equipo' },
  { uid: 'e0000000-0000-4000-8000-000000000003', label: 'Equipo · Aprobador', hint: 'Aprueba y activa desafíos; ve visitas y cupones', profile: 'equipo' },
];

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
const sorted = (o: Record<string, string>) => Object.keys(o).sort().map((k) => o[k]);

function toApiError(e: unknown): ApiError {
  const x = e as { message?: string; code?: string };
  return new ApiError(x.message || 'error', x.code || '');
}

export async function createDemoBackend(): Promise<Backend> {
  const listeners = new Set<(s: Session | null) => void>();
  const files = [...sorted(shim), ...sorted(migrations), ...sorted(seed), ...sorted(demoUsers)];
  const version = hash(files.join('\n--\n'));

  let db: PGlite;
  async function open(fresh: boolean) {
    if (fresh) await new Promise<void>((r) => { const q = indexedDB.deleteDatabase('/pglite/' + DB_NAME); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    db = new PGlite('idb://' + DB_NAME);
    await db.waitReady;
    const has = await db.query(`select to_regclass('public.app_config') is not null as ok`);
    if (!(has.rows[0] as J).ok) {
      for (const f of files) await db.exec(f);
      localStorage.setItem(KEY_HASH, version);
    }
  }

  let readyP: Promise<void> | null = null;
  const ready = () => (readyP ??= (async () => {
    const stale = localStorage.getItem(KEY_HASH) !== version && localStorage.getItem(KEY_HASH) !== null;
    await open(stale);
  })());

  const uidNow = () => localStorage.getItem(KEY_UID);
  const emit = () => { const u = uidNow(); const s = u ? { uid: u, email: 'demo' } : null; listeners.forEach((l) => l(s)); };

  // Una llamada a la vez (PGlite es de un solo hilo y una sola conexión)
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  }

  async function rpc<T = J>(fn: string, args: Record<string, J> = {}): Promise<T> {
    await ready();
    if (!/^[a-z_0-9]+$/.test(fn)) throw new ApiError('funcion_invalida');
    const uid = uidNow();
    return serial(async () => {
      try {
        return await db.transaction(async (tx) => {
          await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
          const claims = uid ? { sub: uid, role: 'authenticated', aal: 'aal2' } : { role: 'anon' };
          await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
          const names = Object.keys(args);
          const vals = names.map((n) => {
            const v = args[n];
            return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
          });
          const res = await tx.query(`select public.${fn}(${names.map((n, i) => `${n} := $${i + 1}`).join(', ')}) as r`, vals);
          return (res.rows[0] as J).r as T;
        });
      } catch (e) {
        throw toApiError(e);
      }
    });
  }

  const sudo = async <T = J>(sql: string, params: J[] = []) => {
    await ready();
    return serial(async () => (await db.query(sql, params)).rows as T[]);
  };

  const backend: Backend = {
    mode: 'demo',
    ready,
    rpc,
    auth: {
      async session() { const u = uidNow(); return u ? { uid: u, email: 'demo' } : null; },
      onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      async signInWithOAuth() { throw new ApiError('En la demo se entra eligiendo una cuenta de ejemplo.'); },
      async signInWithPassword() { throw new ApiError('En la demo se entra eligiendo una cuenta de ejemplo.'); },
      async signOut() { localStorage.removeItem(KEY_UID); emit(); },
      async updatePassword() { /* en la demo no hay contraseñas reales */ },
    },
    photos: {
      // Demo: la foto se guarda dentro de la base (data URL, ya reducida)
      async prepare(file) { return downscale(file); },
      async upload(file) { return fileToDataUrl(file); },
      url(path) { return path && path.startsWith('data:image/') ? path : null; },
    },
    accounts: {
      async create(i: CreateAccountInput) {
        const email = phoneToEmail(i.phone);
        const exists = await sudo('select id from auth.users where email = $1', [email]);
        if (exists.length) return { ok: false, reason: 'telefono_ya_registrado' };
        const [u] = await sudo<{ id: string }>('insert into auth.users (email, phone) values ($1, $2) returning id', [email, i.phone]);
        const r = await rpc('admin_register_role', {
          p_user: u.id, p_role: i.role, p_merchant: i.merchant_id ?? null, p_perms: i.perms ?? [],
          p_display_name: i.display_name, p_phone: i.phone,
        });
        if (!r.ok) { await sudo('delete from auth.users where id = $1', [u.id]); return { ok: false, reason: r.reason }; }
        return { ok: true, user_id: u.id, id: r.id };
      },
      async resetPassword(userId) {
        const r = await rpc('admin_flag_password_reset', { p_user: userId });
        return { ok: !!r.ok, reason: r.reason };
      },
      async deleteMyAccount() {
        const r = await rpc('delete_my_account');
        if (r.ok) { localStorage.removeItem(KEY_UID); emit(); }
        return { ok: !!r.ok, reason: r.reason };
      },
    },
    demo: {
      accounts: DEMO_ACCOUNTS,
      signInAs(uid) { localStorage.setItem(KEY_UID, uid); emit(); },
      async newPerson() {
        const [u] = await sudo<{ id: string }>(`insert into auth.users (email) values ('demo-' || substr(gen_random_uuid()::text, 1, 8) || '@demo.anda.test') returning id`);
        return u.id;
      },
      async reset() {
        localStorage.removeItem(KEY_UID);
        localStorage.removeItem(KEY_HASH);
        try { await db.close(); } catch { /* ya cerrada */ }
        await open(true);
        emit();
      },
    },
  };
  return backend;
}

// ---- fotos (demo): reducir y convertir a data URL --------------------------------
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new ApiError('No se pudo leer la imagen'));
    r.readAsDataURL(file);
  });
}
