import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Check, Confirm, Empty, Field, Load, Modal, TextField, useAction, useAsync } from '../ui/kit';
import { dt } from '../ui/format';
import { PERM_LABEL } from './common';

const PERMS = Object.keys(PERM_LABEL);

function genPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(14);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join('');
}

export function Equipo() {
  const { rpc, backend } = useApp();
  const q = useAsync<J[]>(() => rpc('admin_list_team'), []);
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<J | null>(null);
  const [reset, setReset] = useState<J | null>(null);
  const [created, setCreated] = useState<{ name: string; phone: string; password: string } | null>(null);
  return (
    <div className="col">
      <div className="section-title"><h1>Equipo y cuentas</h1><Btn icon="plus" onClick={() => setCreate(true)}>Nueva cuenta</Btn></div>
      <div className="small muted">Las cuentas de comercio y de equipo las crea solo el CEO, con teléfono y contraseña temporal. En el primer ingreso deben elegir una propia.</div>
      <Load q={q} empty={<Empty icon="users" title="Sin cuentas" />}>
        {(list) => list.map((r) => (
          <Card key={r.id} className="col tight">
            <div className="row between wrap">
              <div className="row wrap" style={{ gap: 8 }}>
                <b>{r.display_name ?? '—'}</b>
                <Badge tone={r.role === 'ceo' ? 'info' : ''}>{r.role === 'ceo' ? 'CEO' : r.role === 'equipo' ? 'Equipo' : 'Comercio'}</Badge>
                {!r.active && <Badge tone="err">Desactivada</Badge>}{r.must_change_password && <Badge tone="warn">Debe cambiar contraseña</Badge>}
              </div>
              <span className="tiny muted">Último acceso: {dt(r.last_access_at)}</span>
            </div>
            <div className="small muted">{r.merchant_name ? `${r.merchant_name} · ` : ''}{r.phone ?? 'sin teléfono'}</div>
            {r.role === 'equipo' && <div className="small">{r.perms.length ? r.perms.map((p: string) => PERM_LABEL[p] ?? p).join(' · ') : 'Sin permisos'}</div>}
            {r.suspended_reason && <div className="tiny muted">Motivo: {r.suspended_reason}</div>}
            {r.role !== 'ceo' && (
              <div className="row wrap" style={{ marginTop: 6 }}>
                <Btn className="small ghost" icon="edit" onClick={() => setEdit(r)}>Editar</Btn>
                <Btn className="small ghost" icon="lock" onClick={() => setReset(r)}>Restablecer contraseña</Btn>
              </div>
            )}
          </Card>
        ))}
      </Load>
      {create && <CreateModal onClose={() => setCreate(false)} onDone={(c) => { setCreate(false); setCreated(c); q.refresh(); }} />}
      {edit && <EditModal r={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); q.refresh(); }} />}
      {reset && <ResetModal r={reset} onClose={() => setReset(null)} onDone={(c) => { setReset(null); setCreated(c); q.refresh(); }} />}
      {created && (
        <Modal title="Entregá estos datos de acceso" onClose={() => setCreated(null)} footer={<Btn onClick={() => setCreated(null)}>Ya los anoté</Btn>}>
          <Banner tone="warn" icon="lock">Esta contraseña se muestra <b>una sola vez</b>. Pasásela a la persona por un canal seguro. Va a tener que cambiarla al entrar. {backend.mode === 'demo' ? '(En la demo no hay contraseñas reales.)' : ''}</Banner>
          <dl className="kv"><dt>Nombre</dt><dd>{created.name}</dd><dt>Teléfono</dt><dd className="mono">{created.phone}</dd><dt>Contraseña temporal</dt><dd className="mono">{created.password}</dd></dl>
        </Modal>
      )}
    </div>
  );
}

function PermChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="col tight">
      <b>Permisos</b>
      {PERMS.map((p) => <Check key={p} checked={value.includes(p)} onChange={(on) => onChange(on ? [...value, p] : value.filter((x) => x !== p))}>{PERM_LABEL[p]}</Check>)}
      <div className="tiny muted">Equipo no ve: Equipo, Control ni Cobros (solo CEO). Por separación de funciones, quien crea un desafío no puede aprobarlo.</div>
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: (c: { name: string; phone: string; password: string }) => void }) {
  const { rpc, backend } = useApp();
  const merchants = useAsync<J[]>(() => rpc('admin_list_merchants'), []);
  const [role, setRole] = useState<'comercio' | 'equipo'>('comercio');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState(genPassword);
  const [merchant, setMerchant] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const { busy, run } = useAction();
  const digits = phone.replace(/\D/g, '');
  const ok = name.trim().length >= 1 && digits.length >= 8 && password.length >= 10 && (role === 'equipo' || !!merchant);
  return (
    <Modal wide title="Nueva cuenta" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!ok} onClick={async () => {
        const r = await run(() => backend.accounts.create({ role, merchant_id: role === 'comercio' ? merchant : null, perms: role === 'equipo' ? perms : [], display_name: name.trim(), phone: phone.trim(), password }));
        if (r?.ok) onDone({ name: name.trim(), phone: phone.trim(), password });
      }}>Crear cuenta</Btn>
    </>}>
      <Field label="Tipo de cuenta"><select className="input" value={role} onChange={(e) => setRole(e.target.value as 'comercio' | 'equipo')}><option value="comercio">Comercio</option><option value="equipo">Equipo ANDÁ</option></select></Field>
      {role === 'comercio' && <Field label="Comercio"><select className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)}><option value="">Elegí un comercio…</option>{(merchants.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
      <TextField label="Nombre" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <TextField label="Teléfono (será el usuario)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+54 9 11 5555 1234" hint="Más adelante se podrá verificar por SMS/WhatsApp; por ahora no se envía ningún mensaje." />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><TextField label="Contraseña temporal (mín. 10)" value={password} onChange={(e) => setPassword(e.target.value)} className="mono" /></div>
        <Btn className="ghost" icon="refresh" onClick={() => setPassword(genPassword())}>Generar</Btn>
      </div>
      {role === 'equipo' && <PermChecks value={perms} onChange={setPerms} />}
    </Modal>
  );
}

function EditModal({ r, onClose, onDone }: { r: J; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [perms, setPerms] = useState<string[]>(r.perms);
  const [active, setActive] = useState<boolean>(r.active);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal wide title={`Editar: ${r.display_name}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!active && reason.trim().length < 3} onClick={async () => {
        const res = await run(() => rpc('admin_update_role', { p_id: r.id, p_perms: r.role === 'equipo' ? perms : null, p_active: active, p_reason: active ? null : reason.trim() }), { ok: 'Cuenta actualizada' });
        if (res?.ok) onDone();
      }}>Guardar</Btn>
    </>}>
      {r.role === 'equipo' && <PermChecks value={perms} onChange={setPerms} />}
      <Check checked={active} onChange={setActive}>Cuenta activa</Check>
      {!active && <TextField label="Motivo de la desactivación" value={reason} onChange={(e) => setReason(e.target.value)} />}
    </Modal>
  );
}

function ResetModal({ r, onClose, onDone }: { r: J; onClose: () => void; onDone: (c: { name: string; phone: string; password: string }) => void }) {
  const { backend } = useApp();
  const [password, setPassword] = useState(genPassword);
  return (
    <Confirm title={`Restablecer contraseña: ${r.display_name}`} confirmLabel="Restablecer" onClose={onClose}
      text={<div className="col"><div>Se asigna una contraseña temporal nueva y la persona tendrá que cambiarla al entrar.</div>
        <TextField label="Nueva contraseña temporal" value={password} className="mono" onChange={(e) => setPassword(e.target.value)} /></div>}
      onConfirm={async () => {
        const res = await backend.accounts.resetPassword(r.user_id, password);
        if (res.ok) onDone({ name: r.display_name ?? '', phone: r.phone ?? '', password });
        return res;
      }} />
  );
}
