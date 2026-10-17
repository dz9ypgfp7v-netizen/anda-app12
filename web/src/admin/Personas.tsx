import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Confirm, Empty, Field, Load, Modal, StateBadge, TextField, useAction, useAsync } from '../ui/kit';
import { dt, num } from '../ui/format';

export function Personas() {
  const { rpc } = useApp();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ s: '', st: '' });
  const q = useAsync<J[]>(() => rpc('admin_list_people', { p_search: applied.s || null, p_status: applied.st || null, p_limit: 100, p_offset: 0 }), [applied.s, applied.st]);
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="col">
      <div className="section-title"><h1>Personas</h1></div>
      <Banner tone="" icon="shield">Por privacidad no guardamos documento de identidad y la fecha de nacimiento no se muestra: solo figura “mayor de 18 verificado”.</Banner>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setApplied({ s: search.trim(), st: status }); }}>
        <div className="grow"><TextField aria-label="Buscar" placeholder="Buscar por nombre o identificador…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="input" style={{ width: 'auto' }} aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setApplied({ s: search.trim(), st: e.target.value }); }}>
          <option value="">Todas</option><option value="activo">Activas</option><option value="suspendido">Suspendidas</option></select>
        <Btn type="submit" icon="search">Buscar</Btn>
      </form>
      <Load q={q} empty={<Empty icon="users" title="No hay personas con ese filtro" />}>
        {(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>Nombre</th><th>Estado</th><th>PASOS</th><th>Visitas</th><th>Cupones</th><th>Alta</th><th>Última actividad</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSel(p.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(p.id); }}>
                <td><b>{p.display_name}</b></td><td><StateBadge state={p.status === 'activo' ? 'activo' : 'suspendido'} /></td>
                <td className="num">{num(p.balance)}</td><td className="num">{num(p.visits)}</td><td className="num">{num(p.coupons)}</td><td>{dt(p.created_at)}</td><td>{dt(p.last_activity_at)}</td></tr>))}</tbody></table></div>
        )}
      </Load>
      {sel && <Detail id={sel} onClose={() => setSel(null)} onChanged={() => q.refresh()} />}
    </div>
  );
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { rpc, isCeo } = useApp();
  const q = useAsync<J>(() => rpc('admin_person_detail', { p_user: id }), [id]);
  const [susp, setSusp] = useState(false);
  const [adjust, setAdjust] = useState(false);
  return (
    <Modal wide title="Detalle de la persona" onClose={onClose}>
      <Load q={q}>{(d) => {
        if (d.ok === false) return <Banner tone="err">No se encontró a la persona.</Banner>;
        const p = d.person;
        return (
          <>
            <div className="row between wrap">
              <div><b style={{ fontSize: 20 }}>{p.display_name}</b> <StateBadge state={p.status === 'activo' ? 'activo' : 'suspendido'} /></div>
              <b className="num">{num(p.balance)} PASOS</b>
            </div>
            <dl className="kv"><dt>Alta</dt><dd>{dt(p.created_at)}</dd><dt>Última actividad</dt><dd>{dt(p.last_activity_at)}</dd><dt>Mayor de 18</dt><dd>Verificado</dd>{p.status_reason && <><dt>Motivo suspensión</dt><dd>{p.status_reason}</dd></>}</dl>
            {isCeo && (
              <div className="row wrap">
                <Btn className={'small ghost ' + (p.status === 'activo' ? 'danger' : '')} onClick={() => setSusp(true)}>{p.status === 'activo' ? 'Suspender' : 'Reactivar'}</Btn>
                <Btn className="small ghost" onClick={() => setAdjust(true)}>Ajustar PASOS</Btn>
              </div>
            )}
            <b>Movimientos recientes</b>
            {d.ledger.length === 0 ? <div className="small muted">Sin movimientos.</div> : d.ledger.slice(0, 15).map((l: J) => (
              <div key={l.id} className="row between small"><span>{l.kind}{l.reason ? ` · ${l.reason}` : ''} <span className="muted">{dt(l.created_at)}</span></span><b className="num" style={{ color: l.amount > 0 ? 'var(--ok)' : 'var(--err)' }}>{l.amount > 0 ? '+' : ''}{num(l.amount)}</b></div>
            ))}
            <b>Visitas</b>
            {d.visits.length === 0 ? <div className="small muted">Sin visitas.</div> : d.visits.slice(0, 10).map((v: J) => (
              <div key={v.id} className="row between small"><span>{v.challenge} · {v.merchant} <span className="muted">{dt(v.at)}</span></span><Badge tone={v.status === 'valida' ? 'ok' : 'err'}>{v.status}</Badge></div>
            ))}
            <b>Cupones</b>
            {d.coupons.length === 0 ? <div className="small muted">Sin cupones.</div> : d.coupons.map((c: J) => (
              <div key={c.id} className="row between small"><span>{c.reward} · <span className="mono">{c.code}</span></span><StateBadge state={c.status} /></div>
            ))}
            {susp && (
              <Confirm title={p.status === 'activo' ? 'Suspender persona' : 'Reactivar persona'} danger={p.status === 'activo'} confirmLabel={p.status === 'activo' ? 'Suspender' : 'Reactivar'} reason={{ label: 'Motivo', min: 3 }}
                text="Una persona suspendida no puede sumar ni canjear PASOS." onClose={() => setSusp(false)}
                onConfirm={async (reason) => { const r = await rpc('admin_set_person_status', { p_user: id, p_status: p.status === 'activo' ? 'suspendido' : 'activo', p_reason: reason }); if (r?.ok) { q.refresh(); onChanged(); } return r; }} />
            )}
            {adjust && <AdjustModal id={id} onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); q.refresh(); onChanged(); }} />}
          </>
        );
      }}</Load>
    </Modal>
  );
}

function AdjustModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const n = Number(amount);
  return (
    <Modal title="Ajuste excepcional de PASOS" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!Number.isInteger(n) || n === 0 || reason.trim().length < 10} onClick={async () => {
        const r = await run(() => rpc('admin_adjust_pasos', { p_user: id, p_amount: n, p_reason: reason.trim() }), { ok: 'Ajuste registrado' });
        if (r?.ok) onDone();
      }}>Registrar ajuste</Btn>
    </>}>
      <Banner tone="warn">No se edita el saldo: se agrega un movimiento nuevo con tu nombre y el motivo, y queda en la auditoría.</Banner>
      <TextField label="Cantidad (positiva suma, negativa resta; máx. 100.000)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9-]/g, ''))} />
      <Field label="Motivo (mínimo 10 caracteres)"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
