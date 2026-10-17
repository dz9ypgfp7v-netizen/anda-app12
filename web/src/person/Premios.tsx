import { useRef, useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Confirm, Empty, Load, Modal, Photo, Segmented, StateBadge, useAction, useAsync } from '../ui/kit';
import { dt, expiresIn, num } from '../ui/format';
import { reasonText } from '../ui/reasons';
import type { Home } from './PersonApp';

export function Premios({ home }: { home: Home }) {
  const [vista, setVista] = useState<'premios' | 'cupones'>('premios');
  return (
    <div className="col">
      <div className="section-title"><h2>Premios</h2></div>
      <Segmented value={vista} onChange={setVista} options={[{ value: 'premios', label: 'Canjear' }, { value: 'cupones', label: 'Mis cupones' }]} />
      {vista === 'premios' ? <Catalogo home={home} onGoCupones={() => setVista('cupones')} /> : <Cupones home={home} />}
    </div>
  );
}

function Catalogo({ home, onGoCupones }: { home: Home; onGoCupones: () => void }) {
  const { rpc, photo } = useApp();
  const q = useAsync<J[]>(() => rpc('list_rewards'), []);
  const [sel, setSel] = useState<J | null>(null);
  const [coupon, setCoupon] = useState<J | null>(null);
  return (
    <>
      <Load q={q} empty={<Empty icon="gift" title="Todavía no hay premios">Los comercios van a sumar premios muy pronto.</Empty>}>
        {(list) => (
          <div className="col">
            {list.map((r) => {
              const off = r.sold_out || r.limit_reached;
              return (
                <Card key={r.id} className="pad0" onClick={() => setSel(r)}>
                  <div className="row" style={{ padding: 12, alignItems: 'flex-start' }}>
                    <Photo src={photo(r.photo_path)} size={64} icon="gift" />
                    <div className="grow col tight">
                      <b>{r.title}</b>
                      <div className="small muted">{r.merchant?.name}{r.merchant?.neighborhood ? ' · ' + r.merchant.neighborhood : ''}</div>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <Badge tone="info">{num(r.cost_pasos)} PASOS</Badge>
                        {r.sold_out ? <Badge tone="err">Agotado</Badge> : r.limit_reached ? <Badge>Ya lo canjeaste</Badge>
                          : r.can_afford ? <Badge tone="ok">Te alcanza</Badge> : <Badge tone="warn">Faltan {num(r.missing)}</Badge>}
                        {!off && !r.unlimited && r.stock != null && r.stock <= 5 && <Badge tone="warn">Quedan {r.stock}</Badge>}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Load>
      {sel && <RewardModal r={sel} onClose={() => setSel(null)} onDone={(c) => { setSel(null); setCoupon(c); q.refresh(); home.refresh(); }} />}
      {coupon && (
        <Modal title="¡Canje listo!" onClose={() => setCoupon(null)} footer={<><button className="btn ghost" onClick={() => { setCoupon(null); onGoCupones(); }}>Ver mis cupones</button><Btn onClick={() => setCoupon(null)}>Listo</Btn></>}>
          <div className="coupon pop">
            <div className="small muted">Tu código</div>
            <div className="code">{coupon.code}</div>
          </div>
          <div><b>{coupon.reward_title}</b> en <b>{coupon.merchant_name}</b>.</div>
          <div className="small muted">Mostrale este código al comercio. Es único, de un solo uso y válido solo ahí. {coupon.expires_at ? expiresIn(coupon.expires_at) + '.' : ''}</div>
        </Modal>
      )}
    </>
  );
}

function RewardModal({ r, onClose, onDone }: { r: J; onClose: () => void; onDone: (c: J) => void }) {
  const { rpc } = useApp();
  const { busy, run } = useAction();
  const claimId = useRef(crypto.randomUUID());
  const off = r.sold_out || r.limit_reached;
  return (
    <Modal title={r.title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={off || !r.can_afford} onClick={async () => {
        const res = await run(() => rpc('claim_reward', { p_claim_id: claimId.current, p_reward_id: r.id }));
        if (res && res.ok === false) claimId.current = crypto.randomUUID();
        if (res?.ok) onDone(res);
      }}>Canjear por {num(r.cost_pasos)} PASOS</Btn>
    </>}>
      {r.description && <div>{r.description}</div>}
      <dl className="kv">
        <dt>Comercio</dt><dd>{r.merchant?.name}</dd>
        <dt>Costo</dt><dd>{num(r.cost_pasos)} PASOS</dd>
        <dt>Validez</dt><dd>{r.valid_days} días desde el canje</dd>
        {r.conditions && <><dt>Condiciones</dt><dd>{r.conditions}</dd></>}
      </dl>
      {r.sold_out && <Banner tone="err">Se agotó este premio.</Banner>}
      {r.limit_reached && <Banner tone="warn">Ya alcanzaste el máximo de canjes de este premio.</Banner>}
      {!off && !r.can_afford && <Banner tone="warn" icon="footsteps">Te faltan {num(r.missing)} PASOS.</Banner>}
      {!off && r.can_afford && <div className="small muted">Al canjear se descuentan los PASOS y se genera un cupón con código único. Podés cancelarlo mientras no lo uses.</div>}
    </Modal>
  );
}

function Cupones({ home }: { home: Home }) {
  const { rpc } = useApp();
  const q = useAsync<J[]>(() => rpc('my_coupons'), []);
  const [sel, setSel] = useState<J | null>(null);
  const [cancel, setCancel] = useState<J | null>(null);
  return (
    <>
      <Load q={q} empty={<Empty icon="ticket" title="Todavía no tenés cupones">Canjeá un premio con tus PASOS y aparece acá.</Empty>}>
        {(list) => (
          <div className="col">
            {list.map((c) => (
              <Card key={c.id} onClick={() => setSel(c)}>
                <div className="row between">
                  <b>{c.reward_title}</b><StateBadge state={c.status} />
                </div>
                <div className="small muted">{c.merchant_name}{c.merchant_neighborhood ? ' · ' + c.merchant_neighborhood : ''}</div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="mono">{c.code}</span>
                  <span className="small muted">{c.status === 'pendiente' ? expiresIn(c.expires_at) : c.status === 'canjeado' ? 'Entregado ' + dt(c.redeemed_at) : ''}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Load>
      {sel && (
        <Modal title={sel.reward_title} onClose={() => setSel(null)} footer={<>
          {sel.status === 'pendiente' && <Btn className="danger ghost" onClick={() => { setCancel(sel); setSel(null); }}>Cancelar cupón</Btn>}
          <Btn onClick={() => setSel(null)}>Cerrar</Btn>
        </>}>
          <div className="coupon"><div className="small muted">Código</div><div className="code">{sel.code}</div></div>
          <dl className="kv">
            <dt>Comercio</dt><dd>{sel.merchant_name}</dd>
            <dt>Estado</dt><dd><StateBadge state={sel.status} /></dd>
            <dt>Generado</dt><dd>{dt(sel.created_at)}</dd>
            <dt>Vence</dt><dd>{dt(sel.expires_at)}</dd>
            {sel.redeemed_at && <><dt>Entregado</dt><dd>{dt(sel.redeemed_at)}</dd></>}
            {sel.cancel_reason && <><dt>Motivo</dt><dd>{reasonText(sel.cancel_reason, sel.cancel_reason)}</dd></>}
            {sel.conditions && <><dt>Condiciones</dt><dd>{sel.conditions}</dd></>}
          </dl>
          {sel.status === 'pendiente' && <div className="small muted">Mostrale el código al comercio para que lo marque como entregado. Es de un solo uso y válido solo en ese comercio.</div>}
        </Modal>
      )}
      {cancel && (
        <Confirm title="¿Cancelar este cupón?" danger confirmLabel="Sí, cancelar" onClose={() => setCancel(null)}
          text={<>Se anula el cupón <b>{cancel.code}</b> y se te devuelven los PASOS. Esto no se puede deshacer.</>}
          onConfirm={async () => { const r = await rpc('cancel_coupon', { p_coupon_id: cancel.id }); if (r?.ok) { q.refresh(); home.refresh(); } return r; }} />
      )}
    </>
  );
}
