import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Banner, Btn, Card, Confirm, Empty, Field, Load, Modal, Segmented, StateBadge, TextField, useAction, useAsync } from '../ui/kit';
import { dt, dateOnly, num } from '../ui/format';

type Filtro = 'abiertas' | 'aprobada' | 'rechazada';
const ABIERTAS = ['enviada', 'en_revision', 'cambios_solicitados'];

export function Propuestas() {
  const { rpc } = useApp();
  const q = useAsync<J[]>(() => rpc('admin_list_proposals'), []);
  const [filtro, setFiltro] = useState<Filtro>('abiertas');
  const [act, setAct] = useState<{ p: J; action: 'solicitar_cambios' | 'rechazar' } | null>(null);
  const [approve, setApprove] = useState<J | null>(null);
  const { run } = useAction();
  return (
    <div className="col">
      <div className="section-title"><h1>Propuestas de comercios</h1></div>
      <div className="small muted">Los comercios proponen campañas y premios. Nada se publica sin tu aprobación.</div>
      <Load q={q} empty={<Empty icon="campaign" title="Todavía no hay propuestas" />}>
        {(list) => {
          const items = list.filter((p) => (filtro === 'abiertas' ? ABIERTAS.includes(p.status) : p.status === filtro));
          return (
            <>
              <Segmented value={filtro} onChange={setFiltro} options={[
                { value: 'abiertas', label: 'Abiertas', count: list.filter((p) => ABIERTAS.includes(p.status)).length },
                { value: 'aprobada', label: 'Aprobadas' }, { value: 'rechazada', label: 'Rechazadas' }]} />
              {items.length === 0 ? <Empty icon="check-circle" title="Nada por acá" /> : items.map((p) => (
                <Card key={p.id} className="col tight">
                  <div className="row between"><b>{p.payload.title}</b><StateBadge state={p.status} /></div>
                  <div className="small muted">{p.merchant_name} · {p.kind === 'campana' ? 'Campaña' : 'Premio'} · {dt(p.created_at)}{p.reviewed_by_name ? ` · revisa ${p.reviewed_by_name}` : ''}</div>
                  {p.payload.description && <div className="small">{p.payload.description}</div>}
                  <div className="small">
                    {p.kind === 'campana'
                      ? <>+{num(p.payload.reward_pasos)} PASOS · {p.payload.repeat_rule === 'diaria' ? 'una vez por día' : 'una sola vez'}{p.payload.quota_total ? ` · cupo ${num(p.payload.quota_total)}` : ''}{p.payload.ends_at ? ` · hasta ${dateOnly(p.payload.ends_at)}` : ''}</>
                      : <>{num(p.payload.cost_pasos)} PASOS · {p.payload.stock != null ? `stock ${p.payload.stock}` : 'sin límite de stock'} · válido {p.payload.valid_days} días{p.payload.conditions ? ` · ${p.payload.conditions}` : ''}</>}
                  </div>
                  {p.review_note && <div className="small muted">Nota: {p.review_note}</div>}
                  {ABIERTAS.includes(p.status) && (
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      {p.status === 'enviada' && <Btn className="small ghost" onClick={async () => { const r = await run(() => rpc('admin_review_proposal', { p_id: p.id, p_action: 'tomar' })); if (r?.ok) q.refresh(); }}>Tomar para revisar</Btn>}
                      <Btn className="small" onClick={() => setApprove(p)}>Aprobar</Btn>
                      {p.status !== 'cambios_solicitados' && <Btn className="small ghost" onClick={() => setAct({ p, action: 'solicitar_cambios' })}>Pedir cambios</Btn>}
                      <Btn className="small danger ghost" onClick={() => setAct({ p, action: 'rechazar' })}>Rechazar</Btn>
                    </div>
                  )}
                </Card>
              ))}
            </>
          );
        }}
      </Load>
      {act && (
        <Confirm title={act.action === 'rechazar' ? 'Rechazar propuesta' : 'Pedir cambios'} confirmLabel={act.action === 'rechazar' ? 'Rechazar' : 'Enviar pedido'} danger={act.action === 'rechazar'}
          reason={{ label: act.action === 'rechazar' ? 'Motivo (lo ve el comercio)' : '¿Qué tiene que cambiar? (lo ve el comercio)', min: 3 }}
          text={<>“{act.p.payload.title}” de {act.p.merchant_name}.</>} onClose={() => setAct(null)}
          onConfirm={async (note) => { const r = await rpc('admin_review_proposal', { p_id: act.p.id, p_action: act.action, p_note: note }); if (r?.ok) q.refresh(); return r; }} />
      )}
      {approve && <ApproveModal p={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); q.refresh(); }} />}
    </div>
  );
}

function ApproveModal({ p, onClose, onDone }: { p: J; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const isCamp = p.kind === 'campana';
  const [pasos, setPasos] = useState(String(isCamp ? p.payload.reward_pasos : p.payload.cost_pasos));
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const changed = Number(pasos) !== (isCamp ? p.payload.reward_pasos : p.payload.cost_pasos);
  return (
    <Modal title="Aprobar propuesta" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={Number(pasos) < 1} onClick={async () => {
        const overrides = changed ? (isCamp ? { reward_pasos: Number(pasos) } : { cost_pasos: Number(pasos) }) : {};
        const r = await run(() => rpc('admin_review_proposal', { p_id: p.id, p_action: 'aprobar', p_note: note || null, p_overrides: overrides }), { ok: isCamp ? 'Campaña aprobada: quedó programada' : 'Premio aprobado y publicado' });
        if (r?.ok) onDone();
      }}>Aprobar</Btn>
    </>}>
      <div><b>{p.payload.title}</b> · {p.merchant_name}</div>
      <Banner tone="" icon="help">{isCamp ? 'Se crea un desafío “programado”: después hay que activarlo desde Desafíos.' : 'Se crea el premio activo en el catálogo.'}</Banner>
      <TextField label={isCamp ? 'PASOS por visita' : 'Costo en PASOS'} inputMode="numeric" value={pasos} onChange={(e) => setPasos(e.target.value.replace(/\D/g, ''))} hint={changed ? 'Vas a aprobar con un valor distinto al propuesto.' : undefined} />
      <Field label="Nota para el comercio (opcional)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}
