import { createContext, useContext, useEffect, useReducer } from 'react';
import type { Backend, J } from '../data/api';

export type Perfil = 'persona' | 'comercio' | 'ceo';

export interface Role {
  id: string;
  role: 'ceo' | 'equipo' | 'comercio';
  merchant_id: string | null;
  merchant_name: string | null;
  merchant_status: string | null;
  perms: string[];
  display_name: string | null;
  must_change_password: boolean;
}
export interface Config {
  environment: 'prueba' | 'produccion' | string;
  test_mode: boolean;
  paused: boolean;
  daily_cap: number;
  code_rotation_s: number;
  require_gps: boolean;
  mfa_required: boolean;
  terms_version: string;
  privacy_version: string;
  logo_path: string | null;
  banner_path: string | null;
}
export interface MyContext {
  uid: string;
  profile: { display_name: string; status: string; needs_terms: boolean } | null;
  roles: Role[];
  config: Config;
  aal: string | null;
}

export interface AppCtx {
  backend: Backend;
  ctx: MyContext;
  /** Rol activo para el perfil elegido (comercio o ceo/equipo). */
  role: Role | null;
  perfil: Perfil;
  rpc: <T = J>(fn: string, args?: Record<string, J>) => Promise<T>;
  reloadCtx: () => Promise<void>;
  signOut: () => Promise<void>;
  photo: (p: string | null | undefined) => string | null;
  theme: 'auto' | 'light' | 'dark';
  setTheme: (t: 'auto' | 'light' | 'dark') => void;
  can: (perm: string) => boolean;
  isCeo: boolean;
}

export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp fuera de AppContext');
  return c;
}

/* ---- Rutas por hash: #/ruta/subruta ---- */
export function useHash(): string[] {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const h = () => force();
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return parseHash();
}
export function parseHash(): string[] {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}
export function go(path: string) {
  const h = '#/' + path.replace(/^\//, '');
  if (location.hash !== h) location.hash = h;
}
