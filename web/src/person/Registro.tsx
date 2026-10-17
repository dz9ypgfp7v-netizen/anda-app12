import { useState } from 'react';
import logo from '../assets/anda-logo.png';
import { useApp } from '../app/state';
import { Banner, Btn, Check, TextField, useAction } from '../ui/kit';
import { age18Max } from '../ui/format';

/** Alta de la persona: solo nombre, fecha de nacimiento (privada) y declaraciones. No se pide DNI. */
export function Registro() {
  const { rpc, reloadCtx, signOut, ctx } = useApp();
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [priv, setPriv] = useState(false);
  const { busy, run } = useAction();
  const ok = name.trim().length >= 2 && !!birth && birth <= age18Max() && adult && terms && priv;

  return (
    <div className="gate">
      <img className="logo" src={logo} alt="ANDÁ" style={{ width: 'min(60vw, 260px)' }} />
      <div className="stack" style={{ marginTop: 20 }}>
        <h1>Creá tu perfil</h1>
        <div className="card">
          <form className="col" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await rpc('register_profile', { p_name: name.trim(), p_birth: birth, p_adult: adult, p_terms: terms, p_privacy: priv });
              if (r?.ok) await reloadCtx();
              return r;
            }, { ok: '¡Listo! Ya podés empezar.' });
          }}>
            <TextField label="¿Cómo te llamamos?" value={name} maxLength={60} autoComplete="given-name" onChange={(e) => setName(e.target.value)} placeholder="Tu nombre o apodo" />
            <TextField label="Fecha de nacimiento" type="date" value={birth} max={age18Max()} onChange={(e) => setBirth(e.target.value)}
              hint="Es privada: solo la usamos para verificar que sos mayor de 18 años." />
            <Banner tone="" icon="shield">No te pedimos documento de identidad ni ningún otro dato personal.</Banner>
            <Check checked={adult} onChange={setAdult}>Declaro que tengo 18 años o más.</Check>
            <Check checked={terms} onChange={setTerms}>Acepto los Términos y condiciones (v{ctx.config.terms_version}).</Check>
            <Check checked={priv} onChange={setPriv}>Leí y acepto la Política de privacidad (v{ctx.config.privacy_version}).</Check>
            <Btn type="submit" busy={busy} disabled={!ok}>Empezar</Btn>
          </form>
        </div>
        <div className="small" style={{ opacity: 0.8, textAlign: 'center' }}>
          Los PASOS no tienen valor monetario: se canjean solo por premios de comercios adheridos.
        </div>
        <button className="link" onClick={() => void signOut()}>Salir</button>
      </div>
    </div>
  );
}

/** Aparece si cambiaron los términos o la política desde la última vez que aceptó. */
export function AceptarTerminos() {
  const { rpc, reloadCtx, signOut, ctx } = useApp();
  const [a, setA] = useState(false);
  const { busy, run } = useAction();
  return (
    <div className="gate" style={{ justifyContent: 'center' }}>
      <div className="stack">
        <h1>Actualizamos los términos</h1>
        <div className="card col">
          <div>Para seguir usando ANDÁ necesitás aceptar los Términos (v{ctx.config.terms_version}) y la Política de privacidad (v{ctx.config.privacy_version}).</div>
          <Check checked={a} onChange={setA}>Acepto los Términos y condiciones y la Política de privacidad.</Check>
          <Btn busy={busy} disabled={!a} onClick={() => run(async () => {
            const r = await rpc('accept_terms', { p_terms_version: ctx.config.terms_version, p_privacy_version: ctx.config.privacy_version });
            if (r?.ok !== false) await reloadCtx();
            return r;
          })}>Aceptar y continuar</Btn>
        </div>
        <button className="link" onClick={() => void signOut()}>Salir</button>
      </div>
    </div>
  );
}
