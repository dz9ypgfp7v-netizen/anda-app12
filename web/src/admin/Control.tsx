import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Check, Confirm, Empty, Field, Load, Modal, Segmented, Stat, useAction, useAsync } from '../ui/kit';
import { dt, num } from '../ui/format';

const SEV_TONE: Record<string, string> = { critica: 'err', alta: 'err', media: 'warn', baja: '', informativa: 'info' };
const CHECKLIST: [string, string][] = [
  ['causa_identificada', 'Identificamos la causa del problema'],
  ['incidencia_resuelta', 'La incidencia está resuelta'],
  ['validaciones_tecnicas', 'Hicimos las validaciones técnicas'],
  ['reglas_comprobadas', 'Comprobamos que las reglas (topes, cupos, códigos) funcionan'],
  ['cupones_revisados', 'Revisamos cupones y PASOS afectados'],
  ['comunicacion_preparada', 'Preparamos la comunicación a personas y comercios'],
];

export function Control() {
  const { rpc, reloadCtx } = useApp();
  const panel = useAsync<J>(() => rpc('admin_control_panel'), []);
  const dash = useAsync<J>(() => rpc('admin_dashboard', { p_days: 30 }), []);
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas');
  const alerts = useAsync<J[]>(() => rpc('admin_list_alerts'), []);
  const [integrity, setIntegrity] = useState<J | null>(null);
  const [pause, setPause] = useState<'on' | 'off' | null>(null);
  const [alert, setAlert] = useState<J | null>(null);
  const { busy, run } = useAction();
  const refreshAll = () => { panel.refresh(); dash.refresh(); alerts.refresh(); void reloadCtx(); };
  return (
    <div className="col loose">
      <div className="section-title"><h1>Control y seguridad</h1></div>

      <Load q={dash}>{(d) => d.paused
        ? <Banner tone="err" icon="pause"><b>ANDÁ está en pausa.</b> {d.pause_reason} <div style={{ marginTop: 8 }}><Btn className="small" onClick={() => setPause('off')}>Reactivar…</Btn></div></Banner>
        : <Card className="row between wrap"><div><b>Pausa general de emergencia</b><div className="small muted">Frena al instante sumas de PASOS, validaciones y canjes. Las personas ven un aviso.</div></div><Btn className="danger" icon="pause" onClick={() => setPause('on')}>Pausar ANDÁ</Btn></Card>}</Load>

      <Load q={panel}>{(p) => (
        <div className="grid g4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Card><Stat value={num(p.alerts_new)} label="Alertas nuevas" /></Card>
          <Card><Stat value={num(p.alerts_review)} label="Alertas en revisión" /></Card>
          <Card><Stat value={num(p.failed_attempts_24h)} label="Intentos fallidos (24 h)" /></Card>
          <Card><Stat value={num(p.visits_voided_30d)} label="Visitas anuladas (30 d)" /></Card>
          <Card><Stat value={num(p.coupons_cancelled_30d)} label="Cupones anulados (30 d)" /></Card>
          <Card><Stat value={num(p.suspended_people)} label="Personas suspendidas" /></Card>
          <Card><Stat value={num(p.suspended_accounts)} label="Cuentas desactivadas" /></Card>
          <Card><Stat value={num(p.sensitive_actions_7d)} label="Acciones sensibles (7 d)" /></Card>
        </div>
      )}</Load>

      <Card className="col">
        <div className="row between wrap"><div><b>Verificación de integridad</b><div className="small muted">Comprueba que cada saldo coincide con sus movimientos y que la cadena de auditoría no fue alterada.</div></div>
          <Btn busy={busy} icon="shield" onClick={async () => { const r = await run(() => rpc('admin_integrity_check')); if (r) setIntegrity(r); }}>Verificar ahora</Btn></div>
        {integrity && (
          <Banner tone={integrity.ok ? 'ok' : 'err'} icon={integrity.ok ? 'check-circle' : 'alert'}>
            {integrity.ok ? <b>Todo en orden.</b> : <b>Se encontraron diferencias.</b>} Billeteras con saldo distinto: {integrity.wallets_mismatch} · movimientos sin billetera: {integrity.ledger_without_wallet} · saldos negativos: {integrity.negative_balances} · cadena de auditoría: {integrity.audit_chain?.ok ? 'íntegra' : 'alterada'}.
          </Banner>
        )}
      </Card>

      <div className="col">
        <div className="section-title"><h2>Alertas</h2></div>
        <Segmented value={filtro} onChange={setFiltro} options={[{ value: 'abiertas', label: 'Abiertas' }, { value: 'todas', label: 'Todas' }]} />
        <Load q={alerts} empty={<Empty icon="check-circle" title="No hay alertas" />}>
          {(list) => {
            const items = list.filter((a) => filtro === 'todas' || ['nueva', 'en_revision'].includes(a.status));
            return items.length === 0 ? <Empty icon="check-circle" title="No hay alertas abiertas" /> : items.map((a) => (
              <Card key={a.id} className="col tight" onClick={() => setAlert(a)}>
                <div className="row between wrap"><div className="row wrap" style={{ gap: 8 }}><Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge><b>{a.kind.replace(/_/g, ' ')}</b></div><span className="tiny muted">{dt(a.ts)} · {a.status.replace('_', ' ')}</span></div>
                <div className="small">{a.summary}</div>
              </Card>
            ));
          }}
        </Load>
      </div>

      {alert && <AlertModal a={alert} onClose={() => setAlert(null)} onDone={() => { setAlert(null); refreshAll(); }} />}
      {pause === 'on' && (
        <Confirm title="Pausar ANDÁ" danger confirmLabel="Pausar ahora" reason={{ label: 'Motivo (mínimo 5 caracteres)', min: 5 }} onClose={() => setPause(null)}
          text="Se frenan las sumas de PASOS, las validaciones de visitas y los canjes. Para reactivar vas a tener que completar una lista de control."
          onConfirm={async (reason) => { const r = await rpc('admin_set_pause', { p_paused: true, p_reason: reason }); if (r?.ok) refreshAll(); return r; }} />
      )}
      {pause === 'off' && <ResumeModal onClose={() => setPause(null)} onDone={() => { setPause(null); refreshAll(); }} />}
    </div>
  );
}

function AlertModal({ a, onClose, onDone }: { a: J; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const set = async (status: string) => { const r = await run(() => rpc('admin_update_alert', { p_id: a.id, p_status: status, p_note: note || null }), { ok: 'Alerta actualizada' }); if (r?.ok) onDone(); };
  return (
    <Modal title={a.kind.replace(/_/g, ' ')} onClose={onClose}>
      <div><Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge> <span className="small muted">{dt(a.ts)} · {a.entity_type} {a.entity_id}</span></div>
      <div>{a.summary}</div>
      {(a.notes ?? []).map((n: J, i: number) => <div key={i} className="small muted">{dt(n.ts)} · {n.by}: {n.text}</div>)}
      <Field label="Nota (obligatoria para cerrar o confirmar)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="row wrap">
        {a.status === 'nueva' && <Btn className="small ghost" busy={busy} onClick={() => set('en_revision')}>Tomar</Btn>}
        <Btn className="small" busy={busy} disabled={note.trim().length < 3} onClick={() => set('cerrada')}>Cerrar (falsa alarma)</Btn>
        <Btn className="small danger" busy={busy} disabled={note.trim().length < 3} onClick={() => set('confirmada')}>Confirmar incidente</Btn>
      </div>
    </Modal>
  );
}

function ResumeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [chk, setChk] = useState<Record<string, boolean>>({});
  const { busy, run } = useAction();
  const all = CHECKLIST.every(([k]) => chk[k]);
  return (
    <Modal title="Reactivar ANDÁ" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!all} onClick={async () => { const r = await run(() => rpc('admin_set_pause', { p_paused: false, p_reason: null, p_checklist: chk }), { ok: 'ANDÁ está activa de nuevo' }); if (r?.ok) onDone(); }}>Reactivar</Btn>
    </>}>
      <div className="small muted">Marcá cada punto solo si de verdad está hecho.</div>
      {CHECKLIST.map(([k, label]) => <Check key={k} checked={!!chk[k]} onChange={(v) => setChk((o) => ({ ...o, [k]: v }))}>{label}</Check>)}
    </Modal>
  );
}
