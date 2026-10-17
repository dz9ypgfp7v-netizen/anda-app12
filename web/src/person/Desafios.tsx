import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Empty, Load, Modal, Photo, Segmented, useAction, useAsync } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { reasonText } from '../ui/reasons';
import { dateOnly, num } from '../ui/format';
import type { Home } from './PersonApp';

type Filtro = 'todos' | 'visita' | 'meta_pasos';

export function Desafios({ home }: { home: Home }) {
  const { rpc, photo } = useApp();
  const q = useAsync<J[]>(() => rpc('list_challenges'), []);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [sel, setSel] = useState<J | null>(null);
  const refresh = () => { q.refresh(); home.refresh(); };

  return (
    <div className="col">
      <div className="section-title"><h2>Desafíos</h2></div>
      <Segmented value={filtro} onChange={setFiltro} options={[
        { value: 'todos', label: 'Todos' }, { value: 'visita', label: 'Visitas' }, { value: 'meta_pasos', label: 'Meta de pasos' },
      ]} />
      <Load q={q} empty={<Empty icon="trophy" title="Todavía no hay desafíos">Cuando haya desafíos activos los vas a ver acá.</Empty>}>
        {(list) => {
          const items = list.filter((c) => filtro === 'todos' || c.type === filtro);
          if (!items.length) return <Empty icon="trophy" title="No hay desafíos de este tipo" />;
          return (
            <div className="col">
              {items.map((c) => (
                <Card key={c.id} className="pad0" onClick={() => setSel(c)}>
                  <div className="row" style={{ padding: 12, alignItems: 'flex-start' }}>
                    <Photo src={photo(c.photo_path ?? c.merchant?.photo_path)} size={64} icon={c.type === 'visita' ? 'store' : 'footsteps'} />
                    <div className="grow col tight">
                      <b>{c.title}</b>
                      <div className="small muted">{c.type === 'visita' ? `${c.merchant?.name ?? ''}${c.merchant?.neighborhood ? ' · ' + c.merchant.neighborhood : ''}` : `Caminá ${num(c.goal_steps)} pasos en el día`}</div>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <Badge tone="info">+{num(c.reward_pasos)} PASOS</Badge>
                        {c.repeat_rule === 'diaria' && <Badge>Una vez por día</Badge>}
                        {c.my_acceptance && !c.unavailable_reason && <Badge tone="ok">Tu lugar está reservado</Badge>}
                        {c.requires_acceptance && !c.my_acceptance && !c.unavailable_reason && c.quota_left != null && <Badge tone="warn">Cupo limitado · quedan {num(c.quota_left)}</Badge>}
                        {c.unavailable_reason
                          ? <Badge tone={c.unavailable_reason.startsWith('ya_') ? 'ok' : 'warn'}>{c.unavailable_reason === 'ya_acreditado' ? 'Completado' : c.unavailable_reason === 'ya_acreditado_hoy' ? 'Hecho hoy' : 'No disponible'}</Badge>
                          : null}
                      </div>
                    </div>
                    <Icon name="chevron-right" />
                  </div>
                </Card>
              ))}
            </div>
          );
        }}
      </Load>
      {sel && <ChallengeModal c={sel} home={home} onClose={() => setSel(null)} onDone={refresh} />}
    </div>
  );
}

function ChallengeModal({ c, home, onClose, onDone }: { c: J; home: Home; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const { busy, run } = useAction();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<J | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const claimId = useRef(crypto.randomUUID());
  const [acc, setAcc] = useState<J | null>(c.my_acceptance ?? null);
  const [left, setLeft] = useState<number | null>(c.quota_left ?? null);
  const needsAccept = !!c.requires_acceptance && !acc;
  const testMode = !!home.data?.test_mode;
  const isVisit = c.type === 'visita';
  const blocked = c.unavailable_reason as string | null;
  const goalOk = !isVisit && (c.today_steps ?? 0) >= (c.goal_steps ?? 0);

  async function claim() {
    setFail(null);
    const r = await run(async () => {
      const res = isVisit
        ? await rpc('claim_visit', { p_claim_id: claimId.current, p_challenge_id: c.id, p_code: code })
        : await rpc('claim_step_goal', { p_claim_id: claimId.current, p_challenge_id: c.id });
      return res;
    });
    // Un rechazo definitivo no se reintenta con el mismo identificador; un error de red sí (misma operación).
    if (r && r.ok === false) { setFail(reasonText(r.reason)); claimId.current = crypto.randomUUID(); }
    if (r && r.ok) { setResult(r); onDone(); }
  }

  async function accept() {
    setFail(null);
    const r = await run(() => rpc('accept_challenge', { p_challenge_id: c.id }));
    if (r && r.ok === false) { setFail(reasonText(r.reason)); onDone(); }
    if (r?.ok) { setAcc({ id: r.acceptance_id, expires_at: r.expires_at }); if (r.slots_left !== undefined) setLeft(r.slots_left); onDone(); }
  }

  async function release() {
    const r = await run(() => rpc('cancel_acceptance', { p_challenge_id: c.id }), { ok: 'Liberaste tu lugar' });
    if (r?.ok) { setAcc(null); onDone(); onClose(); }
  }

  async function peek() {
    const r = await run(() => rpc('test_peek_code', { p_merchant: c.merchant.id }));
    if (r?.ok) setCode(r.code);
  }

  if (result) {
    return (
      <Modal title="¡Sumaste PASOS!" onClose={onClose} footer={<Btn onClick={onClose}>Seguir</Btn>}>
        <div className="col" style={{ alignItems: 'center', textAlign: 'center' }}>
          <div className="pop balance" style={{ color: 'var(--accent)' }}>+{num(result.pasos)}</div>
          <div>{result.replay ? 'Este reclamo ya estaba registrado.' : `Por completar “${c.title}”.`}</div>
          {result.balance !== undefined && <div className="small muted">Ahora tenés {num(result.balance)} PASOS.</div>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={c.title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cerrar</button>
      {!blocked && needsAccept && <Btn busy={busy} onClick={accept}>Aceptar desafío</Btn>}
      {!blocked && !needsAccept && isVisit && <Btn busy={busy} disabled={code.length !== 6} onClick={claim}>Validar visita</Btn>}
      {!blocked && !needsAccept && !isVisit && <Btn busy={busy} disabled={!goalOk} onClick={claim}>Reclamar PASOS</Btn>}
    </>}>
      {c.description && <div>{c.description}</div>}
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge tone="info">+{num(c.reward_pasos)} PASOS</Badge>
        <Badge>{c.repeat_rule === 'diaria' ? 'Una vez por día' : 'Una sola vez'}</Badge>
        {c.ends_at && <Badge>Hasta {dateOnly(c.ends_at)}</Badge>}
        {left !== null && c.requires_acceptance && <Badge tone="warn">{acc ? `Quedan ${num(left)} cupos para otras personas` : `Quedan ${num(left)} cupos`}</Badge>}
      </div>
      {blocked && <Banner tone={blocked.startsWith('ya_') ? 'ok' : 'warn'} icon={blocked.startsWith('ya_') ? 'check-circle' : 'alert'}>{reasonText(blocked)}</Banner>}
      {!blocked && needsAccept && (
        <>
          <Banner tone="sun" icon="alert">Este desafío tiene <b>cupo limitado</b>. Al aceptarlo te guardamos un lugar y deja de estar disponible para quien no lo aceptó cuando se ocupan todos. Tenés un tiempo para completarlo; si no llegás, el lugar se libera para otra persona.</Banner>
          {fail && <Banner tone="err">{fail}</Banner>}
        </>
      )}
      {!blocked && acc && <Reserva expiresAt={acc.expires_at} onRelease={release} busy={busy} />}
      {!blocked && !needsAccept && isVisit && (
        <>
          <div className="small">Andá a <b>{c.merchant?.name}</b> y pedí el código de 6 dígitos que muestra el comercio. El código cambia cada poco tiempo.</div>
          <input className="input codeinput" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" aria-label="Código de 6 dígitos"
            value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setFail(null); }} />
          {fail && <Banner tone="err">{fail}</Banner>}
          {testMode && <Btn className="small soft" busy={busy} onClick={peek}>Modo prueba: traer el código del comercio</Btn>}
        </>
      )}
      {!blocked && !needsAccept && !isVisit && (
        <>
          <div className="row between small"><span>Hoy llevás</span><b className="num">{num(c.today_steps)} / {num(c.goal_steps)} pasos</b></div>
          <div className="bar"><span style={{ width: `${Math.min(100, ((c.today_steps ?? 0) / (c.goal_steps || 1)) * 100)}%` }} /></div>
          {!goalOk && <div className="small muted">Todavía no llegaste a la meta de hoy. Cuando la alcances vas a poder reclamar tus PASOS.</div>}
          {fail && <Banner tone="err">{fail}</Banner>}
        </>
      )}
    </Modal>
  );
}

function Reserva({ expiresAt, onRelease, busy }: { expiresAt: string; onRelease: () => void; busy: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const ms = new Date(expiresAt).getTime() - now;
  const mins = Math.max(0, Math.floor(ms / 60000));
  const txt = ms <= 0 ? 'Tu reserva venció. Cerrá y volvé a aceptar si todavía hay cupo.' : mins >= 120 ? `Te quedan unas ${Math.floor(mins / 60)} horas para completarlo.` : `Te quedan ${Math.floor(mins / 60)} h ${mins % 60} min para completarlo.`;
  return (
    <Banner tone={ms <= 0 ? 'warn' : 'ok'} icon="check-circle">
      <b>Tu lugar está reservado.</b> {txt}
      <div style={{ marginTop: 8 }}><Btn className="small ghost" busy={busy} onClick={onRelease}>Soltar mi lugar</Btn></div>
    </Banner>
  );
}
