import { useEffect, useRef, useState } from 'react';
import logo from '../assets/anda-logo.png';
import { go, useApp, useHash } from '../app/state';
import type { J } from '../data/api';
import { Icon } from '../ui/Icon';
import { Badge, Banner, Btn, Card, Confirm, Empty, Load, Modal, Segmented, Stat, StateBadge, TextField, useAction, useAsync, Field } from '../ui/kit';
import { ars, dayShort, dt, dateOnly, isoToLocalInput, localToIso, monthName, num } from '../ui/format';
import { reasonText } from '../ui/reasons';

const TABS = [
  { id: 'resumen', label: 'Resumen', icon: 'chart' },
  { id: 'codigo', label: 'Código', icon: 'qr-code' },
  { id: 'cupones', label: 'Cupones', icon: 'ticket' },
  { id: 'campanias', label: 'Campañas', icon: 'campaign' },
  { id: 'cobros', label: 'Cobros', icon: 'wallet-steps' },
] as const;

export default function MerchantApp() {
  const { role, signOut } = useApp();
  const route = useHash();
  const tab = TABS.find((t) => t.id === route[0])?.id ?? 'resumen';
  const mid = role!.merchant_id!;
  return (
    <>
      <div className="mshell">
        <header className="topbar">
          <img className="brand" src={logo} alt="ANDÁ" />
          <div className="row"><b className="small">{role!.merchant_name}</b>
            <button className="btn small icon ghost" aria-label="Salir" onClick={() => void signOut()}><Icon name="logout" size={18} /></button></div>
        </header>
        <main>
          {tab === 'resumen' && <Resumen mid={mid} />}
          {tab === 'codigo' && <Codigo mid={mid} />}
          {tab === 'cupones' && <Cupones mid={mid} />}
          {tab === 'campanias' && <Campanias mid={mid} />}
          {tab === 'cobros' && <Cobros mid={mid} />}
        </main>
      </div>
      <nav className="tabbar" aria-label="Secciones">
        <div className="inner">
          {TABS.map((t) => (
            <button key={t.id} className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <Icon name={t.icon} /><span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

/* ---------------- Resumen ---------------- */
function Resumen({ mid }: { mid: string }) {
  const { rpc } = useApp();
  const s = useAsync<J>(() => rpc('merchant_summary', { p_merchant: mid, p_days: 30 }), [mid]);
  const v = useAsync<J[]>(() => rpc('merchant_recent_validations', { p_merchant: mid, p_limit: 10 }), [mid]);
  return (
    <div className="col loose">
      <div className="section-title"><h2>Resumen</h2><span className="small muted">últimos 30 días</span></div>
      <Load q={s}>
        {(d) => (
          <>
            <div className="grid g3">
              <Card><Stat value={num(d.visits_today)} label="Visitas hoy" /></Card>
              <Card><Stat value={num(d.visits_7d)} label="Últimos 7 días" /></Card>
              <Card><Stat value={num(d.visits_period)} label="Últimos 30 días" /></Card>
            </div>
            <div className="grid g3">
              <Card><Stat value={num(d.coupons_issued)} label="Cupones generados" /></Card>
              <Card><Stat value={num(d.coupons_redeemed)} label="Cupones entregados" /></Card>
              <Card><Stat value={num(d.coupons_pending)} label="Cupones por entregar" /></Card>
            </div>
            <Card>
              <div className="section-title"><b>Visitas por día</b><span className="small muted">14 días</span></div>
              {(() => {
                const max = Math.max(1, ...d.series.map((x: J) => x.visits));
                return (
                  <>
                    <div className="chart" role="img" aria-label="Visitas por día">
                      {d.series.map((x: J) => <i key={x.day} title={`${x.day}: ${x.visits}`} style={{ height: `${Math.max(3, (x.visits / max) * 100)}%` }} />)}
                    </div>
                    <div className="row between tiny muted" style={{ marginTop: 4 }}>{d.series.map((x: J, i: number) => <span key={x.day}>{i % 2 === 0 ? dayShort(x.day) : ''}</span>)}</div>
                  </>
                );
              })()}
            </Card>
            <div className="col">
              <b>Campañas vigentes</b>
              {d.campaigns.length === 0 ? <Empty icon="campaign" title="No hay campañas vigentes">Proponé una desde la pestaña Campañas.</Empty> :
                d.campaigns.map((c: J) => (
                  <Card key={c.id}><div className="row between"><b>{c.title}</b><StateBadge state={c.state} /></div>
                    <div className="small muted">+{num(c.reward_pasos)} PASOS por visita · {num(c.visits)} visitas en el período</div></Card>
                ))}
            </div>
          </>
        )}
      </Load>
      <div className="col">
        <b>Últimas validaciones</b>
        <div className="small muted">Solo datos agregados: no mostramos quién visitó.</div>
        <Load q={v} empty={<Empty icon="check-circle" title="Todavía no hay validaciones" />}>
          {(list) => (
            <div className="table-wrap"><table className="table"><thead><tr><th>Cuándo</th><th>Desafío</th><th>Local</th><th>Estado</th></tr></thead>
              <tbody>{list.map((x) => <tr key={x.id}><td>{dt(x.at)}</td><td>{x.challenge}</td><td>{x.branch ?? '—'}</td><td><StateBadge state={x.status} /></td></tr>)}</tbody></table></div>
          )}
        </Load>
      </div>
    </div>
  );
}

/* ---------------- Código dinámico ---------------- */
function Codigo({ mid }: { mid: string }) {
  const { rpc } = useApp();
  const ov = useAsync<J>(() => rpc('merchant_overview', { p_merchant: mid }), [mid]);
  return (
    <div className="col">
      <div className="section-title"><h2>Código de visita</h2></div>
      <Load q={ov}>{(o) => {
        const branches = (o.branches as J[]).filter((b) => b.status === 'activo');
        return branches.length ? <CodigoLocal branches={branches} /> : <Banner tone="warn">No hay locales activos. Comunicate con ANDÁ.</Banner>;
      }}</Load>
    </div>
  );
}

function CodigoLocal({ branches }: { branches: J[] }) {
  const { rpc } = useApp();
  const [branch, setBranch] = useState<string>(branches[0].id);
  const [data, setData] = useState<J | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const r = await rpc('merchant_current_code', { p_branch: branch });
          if (!alive.current) return;
          setErr(r.ok === false ? reasonText(r.reason) : null);
          setData(r.ok === false ? null : r);
          setLeft(r.expires_in_s ?? 0);
        } catch (e) { if (alive.current) setErr(reasonText((e as Error).message)); }
      }
      if (alive.current) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [branch, rpc]);

  // Cuenta regresiva local entre consultas
  useEffect(() => { const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, []);

  const code: string = data?.code ?? '';
  const pct = data ? Math.min(100, (left / data.rotation_s) * 100) : 0;
  return (
    <div className="col">
      {branches.length > 1 && (
        <Field label="Local"><select className="input" value={branch} onChange={(e) => { setData(null); setBranch(e.target.value); }}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      )}
      {err && <Banner tone="err">{err}</Banner>}
      {data?.paused && <Banner tone="warn" icon="pause">ANDÁ está en pausa: por ahora no se validan visitas.</Banner>}
      {data && !data.paused && (
        <Card className="col" tone="night">
          <div className="small" style={{ opacity: 0.85, textAlign: 'center' }}>Mostrale este código a quien te visita · {data.branch_name}</div>
          <div className="bigcode" aria-live="off" aria-label={`Código ${code.split('').join(' ')}`}>{code.slice(0, 3)}{'\u00a0'}{code.slice(3)}</div>
          <div className="bar" style={{ background: 'rgba(255,255,255,.18)' }}><span style={{ width: `${pct}%`, background: 'var(--sun)' }} /></div>
          <div className="row between small" style={{ opacity: 0.9 }}>
            <span>Cambia en {left} s</span><span>Usos: {data.uses}/{data.max_uses}</span>
          </div>
        </Card>
      )}
      <div className="small muted">Mientras esta pantalla esté abierta, tu local figura como “validando visitas”. El código cambia solo y tiene un máximo de usos. No lo compartas por mensaje ni lo imprimas.</div>
    </div>
  );
}

/* ---------------- Cupones ---------------- */
function formatCode(v: string) {
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c;
}

function Cupones({ mid }: { mid: string }) {
  const { rpc } = useApp();
  const ov = useAsync<J>(() => rpc('merchant_overview', { p_merchant: mid }), [mid]);
  const hist = useAsync<J[]>(() => rpc('merchant_redemptions', { p_merchant: mid, p_limit: 30 }), [mid]);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<J | null>(null);
  const [branch, setBranch] = useState('');
  const [done, setDone] = useState<J | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  const branches: J[] = (ov.data?.branches ?? []).filter((b: J) => b.status === 'activo');
  useEffect(() => { if (!branch && branches.length) setBranch(branches[0].id); }, [branches, branch]);

  const lookup = async () => {
    setFound(null); setDone(null);
    const r = await run(() => rpc('lookup_coupon', { p_merchant: mid, p_code: code }));
    if (r?.ok) setFound(r.coupon);
  };
  return (
    <div className="col loose">
      <div className="section-title"><h2>Entregar cupón</h2></div>
      <Card className="col">
        <div className="small">Pedile el código al cliente (formato XXXX-XXXX), verificalo y marcalo como entregado.</div>
        <input className="input codeinput" style={{ fontSize: 26, letterSpacing: '.15em' }} aria-label="Código del cupón" placeholder="XXXX-XXXX" value={code}
          autoCapitalize="characters" autoComplete="off" onChange={(e) => { setCode(formatCode(e.target.value)); setFound(null); setDone(null); }} />
        <Btn busy={busy && !confirm} disabled={code.length < 9} icon="search" onClick={lookup}>Verificar cupón</Btn>
      </Card>
      {found && !done && (
        <Card className="col" tone="sun">
          <div className="row between"><b style={{ fontSize: 18 }}>{found.reward_title}</b><Badge tone="ok">Válido</Badge></div>
          <div className="mono">{found.code}</div>
          {found.conditions && <div className="small">Condiciones: {found.conditions}</div>}
          <div className="small muted">Vence {dt(found.expires_at)}</div>
          {branches.length > 1 && (
            <Field label="Local donde lo entregás"><select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          )}
          <Btn className="sun" onClick={() => setConfirm(true)}>Entregar premio</Btn>
        </Card>
      )}
      {done && (
        <Banner tone="ok" icon="check-circle"><b>Entregado.</b> {done.reward_title}{done.replay ? ' (ya estaba registrado)' : ''} · {dt(done.redeemed_at)}</Banner>
      )}
      {confirm && found && (
        <Confirm title="¿Entregar este premio?" confirmLabel="Sí, entregar" onClose={() => setConfirm(false)}
          text={<>Vas a marcar <b>{found.reward_title}</b> ({found.code}) como entregado. Una vez entregado no se puede volver a usar.</>}
          onConfirm={async () => {
            const r = await rpc('redeem_coupon', { p_merchant: mid, p_branch: branch || null, p_code: found.code });
            if (r?.ok) { setDone(r); setFound(null); setCode(''); hist.refresh(); }
            return r;
          }} />
      )}
      <div className="col">
        <b>Entregados recientemente</b>
        <Load q={hist} empty={<Empty icon="ticket" title="Todavía no entregaste cupones" />}>
          {(list) => (
            <div className="table-wrap"><table className="table"><thead><tr><th>Cuándo</th><th>Premio</th><th>Código</th><th>Local</th></tr></thead>
              <tbody>{list.map((x) => <tr key={x.id}><td>{dt(x.redeemed_at)}</td><td>{x.reward_title}</td><td className="mono">{x.code}</td><td>{x.branch ?? '—'}</td></tr>)}</tbody></table></div>
          )}
        </Load>
      </div>
    </div>
  );
}

/* ---------------- Campañas y propuestas ---------------- */
function Campanias({ mid }: { mid: string }) {
  const { rpc } = useApp();
  const ch = useAsync<J[]>(() => rpc('merchant_challenges', { p_merchant: mid }), [mid]);
  const pr = useAsync<J[]>(() => rpc('merchant_proposals', { p_merchant: mid }), [mid]);
  const [form, setForm] = useState<{ kind: 'campana' | 'premio'; edit?: J } | null>(null);
  const [vista, setVista] = useState<'campanas' | 'propuestas'>('campanas');
  return (
    <div className="col">
      <div className="section-title"><h2>Campañas</h2></div>
      <div className="row wrap">
        <Btn className="small" icon="plus" onClick={() => setForm({ kind: 'campana' })}>Proponer campaña</Btn>
        <Btn className="small soft" icon="gift" onClick={() => setForm({ kind: 'premio' })}>Proponer premio</Btn>
      </div>
      <div className="small muted">Tus propuestas las revisa y aprueba ANDÁ antes de publicarse.</div>
      <Segmented value={vista} onChange={setVista} options={[{ value: 'campanas', label: 'Vigentes' }, { value: 'propuestas', label: 'Mis propuestas', count: pr.data?.length }]} />
      {vista === 'campanas' ? (
        <Load q={ch} empty={<Empty icon="campaign" title="Todavía no hay campañas publicadas" />}>
          {(list) => list.map((c) => (
            <Card key={c.id}>
              <div className="row between"><b>{c.title}</b><StateBadge state={c.state} /></div>
              <div className="small muted">{c.type === 'visita' ? 'Visita' : 'Meta de pasos'} · +{num(c.reward_pasos)} PASOS · {c.repeat_rule === 'diaria' ? 'una vez por día' : 'una sola vez'}{c.ends_at ? ` · hasta ${dateOnly(c.ends_at)}` : ''}</div>
              <div className="small">{num(c.visits)} visitas</div>
            </Card>
          ))}
        </Load>
      ) : (
        <Load q={pr} empty={<Empty icon="book" title="No enviaste propuestas">Proponé una campaña o un premio y lo revisamos.</Empty>}>
          {(list) => list.map((p) => (
            <Card key={p.id} className="col tight">
              <div className="row between"><b>{p.payload.title}</b><StateBadge state={p.status} /></div>
              <div className="small muted">{p.kind === 'campana' ? `Campaña · +${num(p.payload.reward_pasos)} PASOS` : `Premio · ${num(p.payload.cost_pasos)} PASOS`} · enviada {dt(p.created_at)}</div>
              {p.review_note && <Banner tone="warn" icon="help"><b>Nota de ANDÁ:</b> {p.review_note}</Banner>}
              {(p.status === 'enviada' || p.status === 'cambios_solicitados') && <Btn className="small ghost" icon="edit" onClick={() => setForm({ kind: p.kind, edit: p })}>Editar y reenviar</Btn>}
            </Card>
          ))}
        </Load>
      )}
      {form && <ProposalForm mid={mid} kind={form.kind} edit={form.edit} onClose={() => setForm(null)} onDone={() => { setForm(null); pr.refresh(); setVista('propuestas'); }} />}
    </div>
  );
}

function ProposalForm({ mid, kind, edit, onClose, onDone }: { mid: string; kind: 'campana' | 'premio'; edit?: J; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const p = edit?.payload ?? {};
  const [title, setTitle] = useState<string>(p.title ?? '');
  const [desc, setDesc] = useState<string>(p.description ?? '');
  const [pasos, setPasos] = useState<string>(String(p.reward_pasos ?? p.cost_pasos ?? ''));
  const [repeat, setRepeat] = useState<string>(p.repeat_rule ?? 'una_vez');
  const [quota, setQuota] = useState<string>(p.quota_total != null ? String(p.quota_total) : '');
  const [stock, setStock] = useState<string>(p.stock != null ? String(p.stock) : '');
  const [days, setDays] = useState<string>(String(p.valid_days ?? 30));
  const [cond, setCond] = useState<string>(p.conditions ?? '');
  const [starts, setStarts] = useState<string>(isoToLocalInput(p.starts_at));
  const [ends, setEnds] = useState<string>(isoToLocalInput(p.ends_at));
  const { busy, run } = useAction();
  const n = (s: string) => (s.trim() === '' ? null : Number(s));
  const payload = kind === 'campana'
    ? { title, description: desc, reward_pasos: n(pasos), repeat_rule: repeat, quota_total: n(quota), starts_at: localToIso(starts), ends_at: localToIso(ends) }
    : { title, description: desc, cost_pasos: n(pasos), stock: n(stock), valid_days: n(days), conditions: cond };
  const ok = title.trim().length >= 3 && Number(pasos) >= 1;
  return (
    <Modal title={(edit ? 'Editar ' : 'Proponer ') + (kind === 'campana' ? 'campaña' : 'premio')} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!ok} onClick={async () => {
        const r = await run(() => edit ? rpc('update_proposal', { p_merchant: mid, p_id: edit.id, p_payload: payload }) : rpc('submit_proposal', { p_merchant: mid, p_kind: kind, p_payload: payload }),
          { ok: 'Propuesta enviada a ANDÁ' });
        if (r?.ok) onDone();
      }}>{edit ? 'Reenviar' : 'Enviar a ANDÁ'}</Btn>
    </>}>
      <TextField label="Título" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'campana' ? 'Ej.: Visitanos y sumá' : 'Ej.: Café gratis'} />
      <Field label="Descripción"><textarea className="input" rows={3} maxLength={600} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <TextField label={kind === 'campana' ? 'PASOS por visita' : 'Costo en PASOS'} inputMode="numeric" value={pasos} onChange={(e) => setPasos(e.target.value.replace(/\D/g, ''))} />
      {kind === 'campana' ? (
        <>
          <Field label="Frecuencia"><select className="input" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="una_vez">Una sola vez por persona</option><option value="diaria">Una vez por día</option></select></Field>
          <TextField label="Cupo total (opcional)" inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value.replace(/\D/g, ''))} />
          <div className="grid g2">
            <TextField label="Desde (opcional)" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
            <TextField label="Hasta (opcional)" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <TextField label="Stock (vacío = ilimitado)" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} />
          <TextField label="Días de validez del cupón" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          <Field label="Condiciones (opcional)"><textarea className="input" rows={2} maxLength={600} value={cond} onChange={(e) => setCond(e.target.value)} /></Field>
        </>
      )}
    </Modal>
  );
}

/* ---------------- Cobros ---------------- */
function Cobros({ mid }: { mid: string }) {
  const { rpc } = useApp();
  const q = useAsync<J[]>(() => rpc('merchant_billing', { p_merchant: mid }), [mid]);
  return (
    <div className="col">
      <div className="section-title"><h2>Cobros</h2></div>
      <div className="small muted">Resumen mensual de visitas validadas y su costo. Es informativo: la factura la emite ANDÁ por fuera de la app.</div>
      <Load q={q} empty={<Empty icon="wallet-steps" title="Todavía no hay períodos" />}>
        {(list) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>Mes</th><th>Visitas</th><th>Importe</th><th>Ajustes</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>{list.map((b) => <tr key={b.period}><td>{monthName(b.period)}</td><td className="num">{num(b.visits)}</td><td className="num">{ars(b.visits_amount)}</td><td className="num">{ars(b.adjustments)}</td><td className="num"><b>{ars(b.total)}</b></td><td><StateBadge state={b.status} /></td></tr>)}</tbody></table></div>
        )}
      </Load>
    </div>
  );
}
