// Capa de datos: la app solo conoce `backend.rpc(nombre, argumentos)`.
// En modo demo responde la base dentro del navegador; en modo real, Supabase.
// Las reglas viven SIEMPRE en la base (funciones SQL): acá no se decide nada de negocio.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;

declare const __APP_MODE__: 'demo' | 'supabase';
export const APP_MODE: 'demo' | 'supabase' = typeof __APP_MODE__ === 'undefined' ? 'demo' : __APP_MODE__;

export class ApiError extends Error {
  code: string;
  constructor(message: string, code = '') {
    super(message);
    this.code = code;
  }
  /** Errores de acceso: la sesión no sirve o falta permiso. */
  get isAuth() { return this.code === 'PT401' || this.message === 'no_autenticado'; }
  get isForbidden() { return this.code === 'PT403'; }
}

export interface Session { uid: string; email?: string | null }

export interface DemoAccount {
  uid: string;
  label: string;
  hint: string;
  profile: 'persona' | 'comercio' | 'ceo' | 'equipo';
}

export interface CreateAccountInput {
  role: 'equipo' | 'comercio';
  merchant_id?: string | null;
  perms?: string[];
  display_name: string;
  phone: string;
  password: string;
}

export interface Backend {
  mode: 'demo' | 'supabase';
  ready(): Promise<void>;
  rpc<T = J>(fn: string, args?: Record<string, J>): Promise<T>;
  auth: {
    session(): Promise<Session | null>;
    onChange(cb: (s: Session | null) => void): () => void;
    signInWithOAuth(provider: 'google' | 'apple'): Promise<void>;
    signInWithPassword(identifier: string, password: string): Promise<void>;
    signOut(): Promise<void>;
    updatePassword(password: string): Promise<void>;
    /** Segundo factor (TOTP). Solo en modo real. */
    mfa?: {
      level(): Promise<{ current: string; next: string }>;
      enroll(): Promise<{ id: string; qr: string; secret: string }>;
      factors(): Promise<{ id: string; status: string }[]>;
      verify(factorId: string, code: string): Promise<void>;
    };
  };
  photos: {
    prepare(file: File): Promise<File>;
    upload(file: File, folder: string, id: string): Promise<string>;
    url(path: string | null | undefined): string | null;
  };
  accounts: {
    create(input: CreateAccountInput): Promise<{ ok: boolean; reason?: string; user_id?: string; id?: string }>;
    resetPassword(userId: string, password: string): Promise<{ ok: boolean; reason?: string }>;
    deleteMyAccount(): Promise<{ ok: boolean; reason?: string }>;
  };
  demo?: {
    accounts: DemoAccount[];
    signInAs(uid: string): void;
    newPerson(): Promise<string>;
    reset(): Promise<void>;
  };
}

let instance: Promise<Backend> | null = null;

/** Crea el backend una sola vez. El modo demo se carga bajo demanda (no pesa en producción). */
export function getBackend(): Promise<Backend> {
  if (!instance) {
    instance = (async () => {
      if (APP_MODE === 'demo') {
        const m = await import('./demo');
        return m.createDemoBackend();
      }
      const m = await import('./supa');
      return m.createSupabaseBackend();
    })();
  }
  return instance;
}

/** Teléfono → correo sintético que usa Supabase Auth para cuentas de comercio y equipo. */
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `p${digits}@cuentas.anda.app`;
}
export function normalizeIdentifier(id: string): string {
  const t = id.trim();
  if (t.includes('@')) return t.toLowerCase();
  return phoneToEmail(t);
}
