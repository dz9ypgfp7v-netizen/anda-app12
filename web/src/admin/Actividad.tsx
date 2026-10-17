import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Btn, Confirm, Empty, Load, Segmented, StateBadge, TextField, useAsync } from '../ui/kit';
import { dt, num, ars } from '../ui/format';

export function Actividad() {
  const { can, isCeo } = useApp();
  const canV = isCeo || can('visitas.ver');
  const canC = isCeo || can('cupones.ver');
  const [vista, setVista] = useState<'visitas' | 'cupones' | 'libro'>(canV ? 'visitas' : 'cupones');
  return (
    <div className="col">
      <div className="section-title"><h1>Visitas y cupones</h1></div>
      <Segmented value={vista} onChange={setVista} options={[
        ...(canV ? [{ value: 'visitas' as const, label: 'Visitas' }, { value: 'libro' as const, label: 'Libro de PASOS' }] : []),
        ...(canC ? [{ value: 'cupones' as const, label: 'Cupones' }] : [])]} />
      {vista === 'visitas' && <Visitas />}
      {vista === 'cupones' && <Cupones />}
      {vista === 'libro' && <Libro />}
    </div>
  );
}

function Visitas() {
  const { rpc, isCeo } = useApp();
  const [status, setStatus] = useState('');
  const q = useAsync<J[]>(() => rpc('admin_list_visits', { p_status: status || null, p_limit: 100, p_offset: 0 }), [status]);
  const [void_, setVoid] = useState<J | null>(null);
  return (
    <>
      <select className="input" style={{ width: 'auto' }} aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Todas</option><option value="valida">Válidas</option><option value="anulada">Anuladas</option></select>
      <Load q={q} empty={<Empty icon="check-circle" title="No hay visitas" />}>
        {(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>Cuándo</th><th>Persona</th><th>Comercio</th><th>Desafío</th><th>PASOS</th><th>Tarifa</th><th>Estado</th><th /></tr></thead>
            <tbody>{list.map((v) => (
              <tr key={v.id}><td>{dt(v.at)}</td><td>{v.person_name ?? <span className="muted">—</span>}</td><td>{v.merchant}{v.branch ? ` · ${v.branch}` : ''}</td><td>{v.challenge}</td>
                <td className="num">{num(v.pasos)}</td><td className="num">{ars(v.fee_ars)}</td>
                <td><StateBadge state={v.status} />{v.gps_verified && <Badge tone="ok">GPS</Badge>}{v.void_reason && <div className="tiny muted">{v.void_reason}</div>}</td>
                <td>{isCeo && v.status === 'valida' && <Btn className="small danger ghost" onClick={() => setVoid(v)}>Anular</Btn>}</td></tr>))}</tbody></table></div>
        )}
      </Load>
      {void_ && (
        <Confirm title="Anular visita" danger confirmLabel="Anular visita" reason={{ label: 'Motivo (mínimo 5 caracteres)', min: 5 }} onClose={() => setVoid(null)}
          text={<>Se quitan los {num(void_.pasos)} PASOS otorgados y se descuenta la tarifa del comercio. El registro original queda como anulado.</>}
          onConfirm={async (reason) => { const r = await rpc('admin_void_visit', { p_visit_id: void_.id, p_reason: reason }); if (r?.ok) q.refresh(); return r; }} />
      )}
    </>
  );
}

function Cupones() {
  const { rpc, isCeo } = useApp();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const q = useAsync<J[]>(() => rpc('admin_list_coupons', { p_status: status || null, p_search: applied || null, p_limit: 100, p_offset: 0 }), [status, applied]);
  const [cancel, setCancel] = useState<J | null>(null);
  const [refund, setRefund] = useState(true);
  return (
    <>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
        <div className="grow"><TextField aria-label="Buscar cupón" placeholder="Código o premio…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="input" style={{ width: 'auto' }} aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option><option value="pendiente">Por entregar</option><option value="canjeado">Entregados</option><option value="vencido">Vencidos</option><option value="cancelado">Cancelados</option><option value="anulado">Anulados</option></select>
        <Btn type="submit" icon="search">Buscar</Btn>
      </form>
      <Load q={q} empty={<Empty icon="ticket" title="No hay cupones" />}>
        {(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>Código</th><th>Premio</th><th>Comercio</th><th>Persona</th><th>PASOS</th><th>Generado</th><th>Estado</th><th /></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id}><td className="mono">{c.code}</td><td>{c.reward_title}</td><td>{c.merchant}</td><td>{c.person_name ?? <span className="muted">—</span>}</td><td className="num">{num(c.cost_pasos)}</td><td>{dt(c.created_at)}</td>
                <td><StateBadge state={c.status} />{c.cancel_reason && <div className="tiny muted">{c.cancel_reason}</div>}</td>
                <td>{isCeo && ['pendiente', 'vencido'].includes(c.status) && <Btn className="small danger ghost" onClick={() => { setRefund(true); setCancel(c); }}>Anular</Btn>}</td></tr>))}</tbody></table></div>
        )}
      </Load>
      {cancel && (
        <Confirm title={`Anular cupón ${cancel.code}`} danger confirmLabel="Anular cupón" reason={{ label: 'Motivo (mínimo 5 caracteres)', min: 5 }} onClose={() => setCancel(null)}
          text={<div className="col"><div>El cupón deja de ser válido y vuelve el stock del premio.</div>
            <label className="check"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} /><span>Devolver {num(cancel.cost_pasos)} PASOS a la persona</span></label></div>}
          onConfirm={async (reason) => { const r = await rpc('admin_cancel_coupon', { p_id: cancel.id, p_reason: reason, p_refund: refund }); if (r?.ok) q.refresh(); return r; }} />
      )}
    </>
  );
}

function Libro() {
  const { rpc } = useApp();
  const [rows, setRows] = useState<J[]>([]);
  const first = useAsync<J[]>(() => rpc('admin_ledger', { p_limit: 50 }), []);
  const all = [...(first.data ?? []), ...rows];
  return (
    <>
      <div className="small muted">Registro inmutable de todos los movimientos de PASOS. Las correcciones se hacen con movimientos nuevos, nunca editando los anteriores.</div>
      <Load q={first} empty={<Empty icon="wallet-steps" title="Sin movimientos" />}>
        {() => (
          <>
            <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Cuándo</th><th>Persona</th><th>Tipo</th><th>Monto</th><th>Motivo / origen</th></tr></thead>
              <tbody>{all.map((l) => (
                <tr key={l.id}><td className="mono">{l.id}</td><td>{dt(l.created_at)}</td><td>{l.person_name ?? <span className="muted">—</span>}</td><td>{l.kind}</td>
                  <td className="num"><b style={{ color: l.amount > 0 ? 'var(--ok)' : 'var(--err)' }}>{l.amount > 0 ? '+' : ''}{num(l.amount)}</b></td>
                  <td className="small">{l.reason ?? ''}{l.actor_name ? ` · ${l.actor_name}` : ''}{l.reverses_id ? ` · revierte #${l.reverses_id}` : ''}</td></tr>))}</tbody></table></div>
            {all.length >= 50 && (
              <Btn className="ghost" onClick={async () => { const r = await rpc<J[]>('admin_ledger', { p_limit: 50, p_before: all[all.length - 1].id }); setRows((x) => [...x, ...r]); }}>Ver más</Btn>
            )}
          </>
        )}
      </Load>
    </>
  );
}
