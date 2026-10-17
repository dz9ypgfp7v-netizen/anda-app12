import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Banner, Btn, Empty, Field, Load, Modal, StateBadge, TextField, useAction, useAsync } from '../ui/kit';
import { ars, monthName, num } from '../ui/format';

export function Cobros() {
  const { rpc } = useApp();
  const q = useAsync<J[]>(() => rpc('admin_billing'), []);
  const [st, setSt] = useState<{ r: J; to: 'facturado' | 'pagado' } | null>(null);
  const [adj, setAdj] = useState<J | null>(null);
  return (
    <div className="col">
      <div className="section-title"><h1>Cobros a comercios</h1></div>
      <Banner tone="warn" icon="help"><b>Control interno, no facturación fiscal.</b> ANDÁ no emite facturas: acá registrás el estado (pendiente → facturado → pagado) y el número de la factura que emitís por fuera, con tu contador.</Banner>
      <Load q={q} empty={<Empty icon="wallet-steps" title="Todavía no hay períodos con visitas" />}>
        {(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>Mes</th><th>Comercio</th><th>Visitas</th><th>Importe</th><th>Ajustes</th><th>Total</th><th>Estado</th><th /></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.merchant_id + r.period}>
                <td>{monthName(r.period)}</td><td>{r.merchant_name}</td><td className="num">{num(r.visits)}</td><td className="num">{ars(r.visits_amount)}</td><td className="num">{ars(r.adjustments)}</td><td className="num"><b>{ars(r.total)}</b></td>
                <td><StateBadge state={r.status} />{r.invoice_ref && <div className="tiny muted">Factura {r.invoice_ref}</div>}{r.frozen && <div className="tiny muted">Importe congelado</div>}</td>
                <td><div className="row wrap" style={{ gap: 6 }}>
                  {r.status === 'pendiente' && <Btn className="small" onClick={() => setSt({ r, to: 'facturado' })}>Marcar facturado</Btn>}
                  {r.status === 'facturado' && <Btn className="small" onClick={() => setSt({ r, to: 'pagado' })}>Marcar pagado</Btn>}
                  {r.status === 'pendiente' && <Btn className="small ghost" onClick={() => setAdj(r)}>Ajuste</Btn>}
                </div></td></tr>))}</tbody></table></div>
        )}
      </Load>
      {st && <StatusModal {...st} onClose={() => setSt(null)} onDone={() => { setSt(null); q.refresh(); }} />}
      {adj && <AdjustModal r={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); q.refresh(); }} />}
    </div>
  );
}

function StatusModal({ r, to, onClose, onDone }: { r: J; to: 'facturado' | 'pagado'; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [ref, setRef] = useState(r.invoice_ref ?? '');
  const { busy, run } = useAction();
  return (
    <Modal title={`Marcar ${to}: ${r.merchant_name} · ${monthName(r.period)}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} onClick={async () => { const res = await run(() => rpc('admin_set_billing_status', { p_merchant: r.merchant_id, p_period: r.period, p_status: to, p_invoice_ref: ref || null }), { ok: 'Estado actualizado' }); if (res?.ok) onDone(); }}>Confirmar</Btn>
    </>}>
      <div>Total del período: <b>{ars(r.total)}</b>. {to === 'facturado' ? 'Al marcarlo facturado, el importe de visitas queda congelado y el mes ya no admite ajustes.' : 'Pasa a pagado: es el cierre.'}</div>
      <TextField label="Número de factura (el que emitiste por fuera)" value={ref} onChange={(e) => setRef(e.target.value)} />
    </Modal>
  );
}

function AdjustModal({ r, onClose, onDone }: { r: J; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const n = Number(amount.replace(',', '.'));
  return (
    <Modal title={`Ajuste: ${r.merchant_name} · ${monthName(r.period)}`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!n || reason.trim().length < 5} onClick={async () => { const res = await run(() => rpc('admin_add_billing_adjustment', { p_merchant: r.merchant_id, p_period: r.period, p_amount: n, p_reason: reason.trim() }), { ok: 'Ajuste registrado' }); if (res?.ok) onDone(); }}>Registrar</Btn>
    </>}>
      <TextField label="Importe en ARS (negativo descuenta)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,-]/g, ''))} />
      <Field label="Motivo (mínimo 5 caracteres)"><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}
