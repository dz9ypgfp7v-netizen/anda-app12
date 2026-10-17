// Pegamento con Deno + Supabase (no se prueba en Node: acá solo se conectan las piezas).
// Variables que Supabase inyecta solas en cada Edge Function: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { Deps, Result } from './accounts.ts';

// Si definís ALLOWED_ORIGIN (por ejemplo https://anda.vercel.app) solo ese sitio puede llamar desde un navegador.
const origin = () => Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const cors = () => ({
  'Access-Control-Allow-Origin': origin(),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

export function json(r: Result): Response {
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...cors(), 'Content-Type': 'application/json' } });
}

export function serveWith(handler: (body: unknown, deps: Deps) => Promise<Result>): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
    if (req.method !== 'POST') return json({ status: 405, body: { ok: false, reason: 'metodo_no_permitido' } });

    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.toLowerCase().startsWith('bearer ')) return json({ status: 401, body: { ok: false, reason: 'sin_sesion' } });

    const url = Deno.env.get('SUPABASE_URL')!;
    // Cliente con la sesión de quien llama: todo lo que se haga con él pasa por los permisos de la base.
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    // Cliente de servicio: solo para administrar usuarios, y solo después de comprobar quién llama.
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

    const deps: Deps = {
      async callerRpc(fn, args = {}) {
        const { data, error } = await caller.rpc(fn, args);
        if (error) throw new Error(error.message);
        return data;
      },
      admin: {
        async createUser(email, password) {
          const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
          return error || !data.user ? { error: error?.message ?? 'error' } : { id: data.user.id };
        },
        async updatePassword(userId, password) {
          const { error } = await service.auth.admin.updateUserById(userId, { password });
          return error ? { error: error.message } : {};
        },
        async deleteUser(userId) {
          const { error } = await service.auth.admin.deleteUser(userId);
          return error ? { error: error.message } : {};
        },
      },
    };

    let body: unknown = {};
    try { body = await req.json(); } catch { /* cuerpo vacío */ }
    try { return json(await handler(body, deps)); }
    catch { return json({ status: 500, body: { ok: false, reason: 'error_interno' } }); }
  });
}
