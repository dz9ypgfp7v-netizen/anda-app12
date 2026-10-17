import { useEffect, useState } from 'react';
import logo from '../assets/anda-logo.png';
import { APP_MODE, type Backend, type DemoAccount } from '../data/api';
import { Icon } from '../ui/Icon';
import { Btn, Banner, TextField, useAction, errorText, useToast } from '../ui/kit';
import type { Perfil } from './state';

/** Pantalla 1: ¿Cómo querés entrar? Tres perfiles separados, una sola app. */
export function ProfileGate({ onPick }: { onPick: (p: Perfil) => void }) {
  return (
    <div className="gate">
      <img className="logo" src={logo} alt="ANDÁ" />
      <div className="tag">Movete a tu manera.</div>
      <div className="stack">
        <h1>¿Cómo querés entrar?</h1>
        <button className="profilebtn" onClick={() => onPick('persona')}>
          <Icon name="footsteps" /><span>Persona<small>Caminá, visitá comercios y canjeá premios</small></span>
        </button>
        <button className="profilebtn" onClick={() => onPick('comercio')}>
          <Icon name="store" /><span>Comercio<small>Validá visitas y entregá cupones</small></span>
        </button>
        <button className="profilebtn sun" onClick={() => onPick('ceo')}>
          <Icon name="shield" /><span>CEO / Equipo<small>Administración de ANDÁ</small></span>
        </button>
      </div>
      <div className="small" style={{ opacity: 0.7, marginTop: 24, textAlign: 'center', maxWidth: 420 }}>
        Los PASOS no tienen valor monetario. ANDÁ es solo para mayores de 18 años.
      </div>
    </div>
  );
}

const TITLES: Record<Perfil, string> = { persona: 'Entrar como Persona', comercio: 'Entrar como Comercio', ceo: 'Entrar como CEO / Equipo' };

/** Pantalla 2: acceso del perfil elegido. Demo: elegís una cuenta de prueba. Real: Apple/Google o teléfono + contraseña. */
export function Login({ backend, perfil, onBack, error }: { backend: Backend; perfil: Perfil; onBack: () => void; error?: string | null }) {
  const [msg, setMsg] = useState<string | null>(error ?? null);
  useEffect(() => setMsg(error ?? null), [error]);
  return (
    <div className="gate">
      <img className="logo" src={logo} alt="ANDÁ" style={{ width: 'min(60vw, 260px)' }} />
      <div className="stack" style={{ marginTop: 24 }}>
        <h1>{TITLES[perfil]}</h1>
        {msg && <Banner tone="err">{msg}</Banner>}
        {backend.mode === 'demo' && backend.demo
          ? <DemoPicker backend={backend} perfil={perfil} />
          : <RealLogin backend={backend} perfil={perfil} setMsg={setMsg} />}
        <button className="link" onClick={onBack}>← Cambiar perfil</button>
      </div>
    </div>
  );
}

function DemoPicker({ backend, perfil }: { backend: Backend; perfil: Perfil }) {
  const demo = backend.demo!;
  const { run } = useAction();
  const list: DemoAccount[] = demo.accounts.filter((a) => (perfil === 'ceo' ? a.profile === 'ceo' || a.profile === 'equipo' : a.profile === perfil));
  return (
    <>
      <Banner tone="sun" icon="help">
        <b>Modo demo.</b> Elegí una cuenta de prueba: no hay contraseñas ni datos reales, todo queda guardado solo en este navegador.
      </Banner>
      {list.map((a) => (
        <button key={a.uid} className="profilebtn" onClick={() => demo.signInAs(a.uid)}>
          <Icon name={a.profile === 'persona' ? 'user' : a.profile === 'comercio' ? 'store' : 'shield'} />
          <span>{a.label}<small>{a.hint}</small></span>
        </button>
      ))}
      {perfil === 'persona' && (
        <Btn className="ghost" style={{ background: 'transparent', color: '#fff', borderColor: '#ffffff66' }} icon="plus"
          onClick={() => run(async () => { const uid = await demo.newPerson(); demo.signInAs(uid); })}>
          Crear una persona nueva de prueba
        </Btn>
      )}
    </>
  );
}

function RealLogin({ backend, perfil, setMsg }: { backend: Backend; perfil: Perfil; setMsg: (s: string | null) => void }) {
  const [ident, setIdent] = useState('');
  const [pass, setPass] = useState('');
  const { busy, run } = useAction();
  const oauth = async (p: 'google' | 'apple') => {
    setMsg(null);
    try { await backend.auth.signInWithOAuth(p); } catch (e) { setMsg(errorText(e)); }
  };
  const withPassword = perfil !== 'persona';
  return (
    <>
      {(perfil === 'persona' || perfil === 'ceo') && (
        <>
          <button className="btn apple" onClick={() => oauth('apple')}><Icon name="user" />Continuar con Apple</button>
          <button className="btn google" onClick={() => oauth('google')}><Icon name="user" />Continuar con Google</button>
        </>
      )}
      {perfil === 'persona' && (
        <div className="small" style={{ opacity: 0.8, textAlign: 'center' }}>
          Sin contraseñas ni documento: solo tu cuenta de Apple o Google.
        </div>
      )}
      {withPassword && (
        <div className="card">
          <form className="col" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => { await backend.auth.signInWithPassword(ident, pass); });
          }}>
            {perfil === 'ceo' && <div className="small muted">Equipo: usá el teléfono y la contraseña que te asignó el CEO.</div>}
            {perfil === 'comercio' && <div className="small muted">Usá el teléfono y la contraseña que te asignó ANDÁ.</div>}
            <TextField label={perfil === 'ceo' ? 'Teléfono o correo' : 'Teléfono'} inputMode={perfil === 'ceo' ? 'email' : 'tel'} autoComplete="username"
              value={ident} onChange={(e) => setIdent(e.target.value)} placeholder={perfil === 'ceo' ? '11 5555 1234 o correo' : '11 5555 1234'} />
            <TextField label="Contraseña" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <Btn type="submit" busy={busy} disabled={!ident.trim() || !pass} icon="lock">Entrar</Btn>
          </form>
        </div>
      )}
    </>
  );
}

/** Cambio obligatorio de la contraseña temporal (comercio / equipo, primer ingreso). */
export function ForcePassword({ backend, onDone, onCancel }: { backend: Backend; onDone: () => Promise<void>; onCancel: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const { busy, run } = useAction();
  const err = a && a.length < 10 ? 'Mínimo 10 caracteres.' : b && a !== b ? 'No coinciden.' : null;
  return (
    <div className="gate">
      <img className="logo" src={logo} alt="ANDÁ" style={{ width: 'min(60vw, 260px)' }} />
      <div className="stack" style={{ marginTop: 24 }}>
        <h1>Elegí tu contraseña</h1>
        <div className="card">
          <form className="col" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await backend.auth.updatePassword(a);
              await backend.rpc('mark_password_changed');
              await onDone();
            }, { ok: 'Contraseña actualizada' });
          }}>
            <div className="small muted">Entraste con una contraseña temporal. Para seguir, elegí una propia y guardala en un lugar seguro.</div>
            <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
            <TextField label="Repetila" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} error={err} />
            <Btn type="submit" busy={busy} disabled={a.length < 10 || a !== b}>Guardar y continuar</Btn>
          </form>
        </div>
        <button className="link" onClick={onCancel}>Salir</button>
      </div>
    </div>
  );
}

/** Segundo factor (TOTP) cuando el CEO activó "mfa_required". Solo modo real. */
export function MfaGate({ backend, onDone, onCancel }: { backend: Backend; onDone: () => Promise<void>; onCancel: () => void }) {
  const mfa = backend.auth.mfa;
  const toast = useToast();
  const [factor, setFactor] = useState<{ id: string; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const { busy, run } = useAction();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!mfa) { setLoading(false); return; }
      try {
        const fs = await mfa.factors();
        const ok = fs.find((f) => f.status === 'verified');
        if (ok) { if (alive) setFactor({ id: ok.id }); }
        else {
          for (const f of fs) { void f; /* factores sin verificar quedan huérfanos: se ignoran */ }
          const e = await mfa.enroll();
          if (alive) setFactor({ id: e.id, qr: e.qr, secret: e.secret });
        }
      } catch (e) { toast(errorText(e), 'err'); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [mfa, toast]);

  return (
    <div className="gate">
      <img className="logo" src={logo} alt="ANDÁ" style={{ width: 'min(60vw, 260px)' }} />
      <div className="stack" style={{ marginTop: 24 }}>
        <h1>Verificación en dos pasos</h1>
        <div className="card">
          {loading ? <div className="skeleton" /> : !mfa || !factor ? (
            <Banner tone="err">No se pudo preparar la verificación. Salí y probá de nuevo.</Banner>
          ) : (
            <form className="col" onSubmit={(e) => {
              e.preventDefault();
              void run(async () => { await mfa.verify(factor.id, code.trim()); await onDone(); });
            }}>
              {factor.qr ? (
                <>
                  <div className="small">Escaneá este código con una app de autenticación (Google Authenticator, 1Password, Authy…) y escribí el número de 6 dígitos que muestra.</div>
                  <img src={factor.qr} alt="Código QR para la app de autenticación" style={{ width: 180, height: 180, alignSelf: 'center', background: '#fff', borderRadius: 12, padding: 8 }} />
                  <div className="small muted">¿No podés escanear? Clave manual: <span className="mono">{factor.secret}</span></div>
                </>
              ) : <div className="small">Abrí tu app de autenticación y escribí el número de 6 dígitos de ANDÁ.</div>}
              <TextField label="Código de 6 dígitos" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Btn type="submit" busy={busy} disabled={code.length !== 6}>Verificar</Btn>
            </form>
          )}
        </div>
        <button className="link" onClick={onCancel}>Salir</button>
      </div>
    </div>
  );
}

export const IS_DEMO = APP_MODE === 'demo';
