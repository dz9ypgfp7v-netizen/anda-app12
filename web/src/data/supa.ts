// Modo REAL: tu proyecto de Supabase. Todo pasa por funciones RPC (no hay acceso directo a tablas).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, normalizeIdentifier, type Backend, type CreateAccountInput, type Session, type J } from './api';
import { downscale } from './photos';

export async function createSupabaseBackend(): Promise<Backend> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new ApiError('Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver la guía de Supabase).');
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });

  const toSession = (s: { user: { id: string; email?: string | null } } | null): Session | null =>
    s ? { uid: s.user.id, email: s.user.email ?? null } : null;

  async function rpc<T = J>(fn: string, args: Record<string, J> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      const status = (error as J).status as number | undefined;
      const code = status === 401 ? 'PT401' : status === 403 ? 'PT403' : (error as J).code || '';
      throw new ApiError(error.message, code);
    }
    return data as T;
  }

  const backend: Backend = {
    mode: 'supabase',
    async ready() { /* el cliente ya está listo */ },
    rpc,
    auth: {
      async session() { const { data } = await sb.auth.getSession(); return toSession(data.session); },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((_e, s) => cb(toSession(s)));
        return () => data.subscription.unsubscribe();
      },
      async signInWithOAuth(provider) {
        const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
        if (error) throw new ApiError(error.message);
      },
      async signInWithPassword(identifier, password) {
        const { error } = await sb.auth.signInWithPassword({ email: normalizeIdentifier(identifier), password });
        if (error) throw new ApiError(error.message === 'Invalid login credentials' ? 'credenciales_invalidas' : error.message);
      },
      async signOut() { await sb.auth.signOut(); },
      async updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw new ApiError(error.message);
      },
      mfa: {
        async level() {
          const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
          if (error) throw new ApiError(error.message);
          return { current: data.currentLevel ?? 'aal1', next: data.nextLevel ?? 'aal1' };
        },
        async factors() {
          const { data, error } = await sb.auth.mfa.listFactors();
          if (error) throw new ApiError(error.message);
          return data.totp.map((f) => ({ id: f.id, status: f.status }));
        },
        async enroll() {
          const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ANDÁ ' + Date.now() });
          if (error) throw new ApiError(error.message);
          return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
        },
        async verify(factorId, code) {
          const ch = await sb.auth.mfa.challenge({ factorId });
          if (ch.error) throw new ApiError(ch.error.message);
          const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
          if (v.error) throw new ApiError(v.error.message);
        },
      },
    },
    photos: {
      prepare: (f) => downscale(f),
      async upload(file, folder, id) {
        const path = folder === 'config' ? `config/${id}-${Date.now()}.webp` : `${folder}/${id}/${Date.now()}.webp`;
        const { error } = await sb.storage.from('fotos').upload(path, file, { contentType: 'image/webp', upsert: false });
        if (error) throw new ApiError(error.message);
        return path;
      },
      url(path) {
        if (!path) return null;
        if (path.startsWith('data:image/')) return path;
        return `${url}/storage/v1/object/public/fotos/${path}`;
      },
    },
    accounts: {
      async create(input: CreateAccountInput) {
        const { data, error } = await sb.functions.invoke('admin-create-account', { body: input });
        if (error) throw new ApiError(await fnError(error));
        return data;
      },
      async resetPassword(userId, password) {
        const { data, error } = await sb.functions.invoke('admin-reset-password', { body: { user_id: userId, password } });
        if (error) throw new ApiError(await fnError(error));
        return data;
      },
      async deleteMyAccount() {
        const r = await rpc('delete_my_account');
        if (!r.ok) return { ok: false, reason: r.reason };
        const { data, error } = await sb.functions.invoke('delete-account', { body: {} });
        if (error) throw new ApiError(await fnError(error));
        await sb.auth.signOut();
        return data;
      },
    },
  };
  return backend;
}

async function fnError(e: J): Promise<string> {
  try {
    const body = await e.context?.json?.();
    return body?.reason || body?.error || e.message;
  } catch { return e.message; }
}
