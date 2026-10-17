import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getBackend, type Backend, type J, type Session } from './data/api';
import { AppContext, type AppCtx, type MyContext, type Perfil, type Role } from './app/state';
import { ForcePassword, Login, MfaGate, ProfileGate } from './app/Gate';
import { Banner, errorText } from './ui/kit';

const PersonApp = lazy(() => import('./person/PersonApp'));
const MerchantApp = lazy(() => import('./merchant/MerchantApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

const K_PERFIL = 'anda.perfil';
const K_THEME = 'anda.theme';
const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

function Splash({ text }: { text?: string }) {
  return (
    <div className="gate" style={{ justifyContent: 'center' }}>
      <div className="spinner" aria-label="Cargando" />
      {text && <div className="small" style={{ marginTop: 14, opacity: 0.8 }}>{text}</div>}
    </div>
  );
}

function Blocked({ title, text, onExit }: { title: string; text: string; onExit: () => void }) {
  return (
    <div className="gate" style={{ justifyContent: 'center' }}>
      <div className="stack">
        <h1>{title}</h1>
        <Banner tone="warn">{text}</Banner>
        <button className="link" onClick={onExit}>Salir</button>
      </div>
    </div>
  );
}

function pickRole(perfil: Perfil, ctx: MyContext): Role | null {
  if (perfil === 'comercio') return ctx.roles.find((r) => r.role === 'comercio') ?? null;
  if (perfil === 'ceo') return ctx.roles.find((r) => r.role === 'ceo') ?? ctx.roles.find((r) => r.role === 'equipo') ?? null;
  return null;
}
function inferPerfil(ctx: MyContext): Perfil {
  if (ctx.roles.some((r) => r.role === 'ceo' || r.role === 'equipo')) return 'ceo';
  if (ctx.roles.some((r) => r.role === 'comercio')) return 'comercio';
  return 'persona';
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [ctx, setCtx] = useState<MyContext | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [perfil, setPerfilState] = useState<Perfil | null>(() => {
    const v = safeGet(K_PERFIL);
    return v === 'persona' || v === 'comercio' || v === 'ceo' ? v : null;
  });
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'auto' | 'light' | 'dark'>(() => {
    const v = safeGet(K_THEME);
    return v === 'light' || v === 'dark' ? v : 'auto';
  });

  // Tema
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', theme);
  }, [theme]);
  const setTheme = useCallback((t: 'auto' | 'light' | 'dark') => { setThemeState(t); safeSet(K_THEME, t === 'auto' ? null : t); }, []);

  const setPerfil = useCallback((p: Perfil | null) => { setPerfilState(p); safeSet(K_PERFIL, p); }, []);

  // Arranque del backend
  const boot = useCallback(async () => {
    setBootErr(null);
    try {
      const b = await getBackend();
      await b.ready();
      setBackend(b);
      setSession(await b.auth.session());
    } catch (e) {
      setBootErr(errorText(e) + ((e as Error)?.message ? ` (${(e as Error).message})` : ''));
    }
  }, []);
  useEffect(() => { void boot(); }, [boot]);

  useEffect(() => {
    if (!backend) return;
    return backend.auth.onChange((s) => { setSession(s); if (!s) setCtx(null); });
  }, [backend]);

  const signingOut = useRef(false);
  const signOut = useCallback(async () => {
    if (!backend || signingOut.current) return;
    signingOut.current = true;
    try { await backend.auth.signOut(); } catch { /* si falla igual limpiamos la vista */ }
    signingOut.current = false;
    setCtx(null); setSession(null); setPerfil(null); setLoginErr(null);
    location.hash = '';
  }, [backend, setPerfil]);

  const loadCtx = useCallback(async () => {
    if (!backend) return;
    try {
      const c = await backend.rpc<MyContext>('my_context');
      setCtx(c); setCtxErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.isAuth) { await signOut(); return; }
      setCtxErr(errorText(e));
    }
  }, [backend, signOut]);

  // Carga del contexto al haber sesión; refresco silencioso cada minuto (pausa, permisos, estado del comercio).
  useEffect(() => {
    if (!backend || !session) return;
    void loadCtx();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void loadCtx(); }, 60000);
    return () => clearInterval(t);
  }, [backend, session, loadCtx]);

  // El perfil se deduce de la cuenta si todavía no se eligió (p. ej. sesión que quedó abierta).
  const effPerfil: Perfil | null = perfil ?? (ctx ? inferPerfil(ctx) : null);
  const role = ctx && effPerfil ? pickRole(effPerfil, ctx) : null;

  // Cuenta que no corresponde al perfil elegido → se cierra la sesión y se explica.
  const mismatch = useMemo(() => {
    if (!ctx || !effPerfil) return null;
    if (effPerfil === 'persona' && ctx.roles.length > 0) return 'Esta cuenta es de Comercio o Equipo. Entrá desde ese perfil.';
    if (effPerfil === 'comercio' && !role) return 'Esta cuenta no tiene un comercio asignado.';
    if (effPerfil === 'ceo' && !role) return 'Esta cuenta no tiene acceso de CEO ni de Equipo.';
    return null;
  }, [ctx, effPerfil, role]);
  useEffect(() => {
    if (mismatch) { setLoginErr(mismatch); void signOut(); }
  }, [mismatch, signOut]);

  const rpc = useCallback(async <T = J,>(fn: string, args?: Record<string, J>) => {
    if (!backend) throw new ApiError('sin_backend');
    try {
      return await backend.rpc<T>(fn, args);
    } catch (e) {
      if (e instanceof ApiError && e.isAuth) void signOut();
      throw e;
    }
  }, [backend, signOut]);

  const value = useMemo<AppCtx | null>(() => {
    if (!backend || !ctx || !effPerfil) return null;
    const perms = new Set(role?.perms ?? []);
    const isCeo = role?.role === 'ceo';
    return {
      backend, ctx, role, perfil: effPerfil, rpc, reloadCtx: loadCtx, signOut,
      photo: (p) => backend.photos.url(p), theme, setTheme,
      can: (perm) => isCeo || perms.has(perm), isCeo,
    };
  }, [backend, ctx, effPerfil, role, rpc, loadCtx, signOut, theme, setTheme]);

  /* ---------------- Pantallas ---------------- */
  if (bootErr) {
    return (
      <div className="gate" style={{ justifyContent: 'center' }}>
        <div className="stack">
          <h1>No se pudo iniciar</h1>
          <Banner tone="err">{bootErr}</Banner>
          <button className="btn" onClick={() => void boot()}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!backend || session === undefined) return <Splash text={backend ? undefined : 'Preparando ANDÁ…'} />;

  const demoBar = backend.mode === 'demo' && backend.demo ? (
    <div className="demobar">
      <span>MODO DEMO · datos de prueba guardados solo en este navegador</span>
      <button onClick={async () => { if (confirm('Esto borra los datos de la demo y vuelve al estado inicial. ¿Seguir?')) { await backend.demo!.reset(); setCtx(null); setSession(null); setPerfil(null); location.hash = ''; } }}>Reiniciar demo</button>
    </div>
  ) : null;

  let body: JSX.Element;
  if (!session) {
    body = !perfil
      ? <ProfileGate onPick={(p) => { setLoginErr(null); setPerfil(p); }} />
      : <Login backend={backend} perfil={perfil} error={loginErr} onBack={() => { setPerfil(null); setLoginErr(null); }} />;
  } else if (ctxErr && !ctx) {
    body = (
      <div className="gate" style={{ justifyContent: 'center' }}>
        <div className="stack">
          <h1>No se pudo cargar tu cuenta</h1>
          <Banner tone="err">{ctxErr}</Banner>
          <button className="btn" onClick={() => void loadCtx()}>Reintentar</button>
          <button className="link" onClick={() => void signOut()}>Salir</button>
        </div>
      </div>
    );
  } else if (!ctx || !value || mismatch) {
    body = <Splash />;
  } else if (role?.must_change_password) {
    body = <ForcePassword backend={backend} onDone={loadCtx} onCancel={() => void signOut()} />;
  } else if (effPerfil !== 'persona' && ctx.config.mfa_required && ctx.aal !== 'aal2' && backend.mode === 'supabase') {
    body = <MfaGate backend={backend} onDone={loadCtx} onCancel={() => void signOut()} />;
  } else if (effPerfil === 'comercio' && role?.merchant_status === 'suspendido') {
    body = <Blocked title="Comercio suspendido" text="Este comercio está suspendido y no puede operar por ahora. Comunicate con ANDÁ." onExit={() => void signOut()} />;
  } else if (effPerfil === 'persona' && ctx.profile?.status === 'suspendido') {
    body = <Blocked title="Cuenta suspendida" text="Tu cuenta está suspendida. Escribinos para revisarlo." onExit={() => void signOut()} />;
  } else {
    const App_ = effPerfil === 'persona' ? PersonApp : effPerfil === 'comercio' ? MerchantApp : AdminApp;
    body = (
      <AppContext.Provider value={value}>
        {ctx.config.paused && <div className="pausebar" role="status">ANDÁ está en pausa: por ahora no se pueden sumar PASOS ni canjear premios.</div>}
        <Suspense fallback={<Splash />}><App_ /></Suspense>
      </AppContext.Provider>
    );
  }

  return <>{demoBar}{body}</>;
}
