import { go, useApp } from '../app/state';
import type { J } from '../data/api';
import { Banner, Btn, Card, Crosswalk, Load, Stat, useAction, useAsync } from '../ui/kit';
import { dayShort, num } from '../ui/format';
import type { Home } from './PersonApp';

export function Inicio({ home }: { home: Home }) {
  const { rpc, ctx } = useApp();
  const steps = useAsync<J[]>(() => rpc('my_steps', { p_days: 7 }), []);
  const nombre = ctx.profile?.display_name ?? '';
  return (
    <div className="col loose">
      <Load q={home}>
        {(h) => (
          <>
            <Card tone="night">
              <div className="small" style={{ opacity: 0.85 }}>Hola, {nombre}</div>
              <div className="balance" style={{ margin: '6px 0 14px' }}>{num(h.balance)}<small>PASOS</small></div>
              {h.next_reward ? (
                <>
                  <Crosswalk value={h.balance} max={h.next_reward.cost_pasos} />
                  <div className="small" style={{ marginTop: 10 }}>
                    {h.next_reward.missing > 0
                      ? <>Te faltan <b>{num(h.next_reward.missing)} PASOS</b> para <b>{h.next_reward.title}</b> en {h.next_reward.merchant_name}.</>
                      : <>¡Ya te alcanza para <b>{h.next_reward.title}</b> en {h.next_reward.merchant_name}!</>}
                  </div>
                  <Btn className="sun" style={{ marginTop: 12 }} onClick={() => go('premios')}>Ver premios</Btn>
                </>
              ) : <div className="small" style={{ opacity: 0.85 }}>Completá desafíos para sumar PASOS y canjearlos por premios.</div>}
            </Card>

            {h.paused && <Banner tone="warn">ANDÁ está en pausa. Por ahora no se pueden sumar PASOS ni canjear premios.</Banner>}

            <div className="grid g3">
              <Card><Stat value={num(h.today_steps)} label="Pasos caminados hoy" /></Card>
              <Card><Stat value={`${h.visits_today}/${h.daily_cap}`} label="Visitas de hoy" /></Card>
              <Card onClick={() => go('premios')}><Stat value={h.pending_coupons} label="Cupones por usar" /></Card>
            </div>
            <div className="small muted" style={{ marginTop: -8 }}>
              Los pasos que caminás se muestran como referencia. Los PASOS se ganan visitando comercios y completando desafíos.
            </div>

            <Card>
              <div className="section-title"><b>Tus últimos 7 días</b><span className="small muted">pasos caminados</span></div>
              <Load q={steps}>
                {(d) => {
                  const max = Math.max(1, ...d.map((x) => x.steps));
                  return (
                    <>
                      <div className="chart" role="img" aria-label="Pasos caminados por día">
                        {d.map((x) => <i key={x.day} title={`${x.day}: ${num(x.steps)}`} style={{ height: `${Math.max(3, (x.steps / max) * 100)}%` }} />)}
                      </div>
                      <div className="row between tiny muted" style={{ marginTop: 4 }}>{d.map((x) => <span key={x.day}>{dayShort(x.day)}</span>)}</div>
                    </>
                  );
                }}
              </Load>
            </Card>

            {h.test_mode && <TestPanel onDone={() => { home.refresh(); steps.refresh(); }} />}
          </>
        )}
      </Load>
    </div>
  );
}

/** Solo aparece si el CEO activó el modo prueba (nunca en producción). */
function TestPanel({ onDone }: { onDone: () => void }) {
  const { rpc } = useApp();
  const { busy, run } = useAction();
  const addPasos = (n: number) => run(async () => { const r = await rpc('test_add_pasos', { p_claim_id: crypto.randomUUID(), p_amount: n }); onDone(); return r; }, { ok: `+${num(n)} PASOS de prueba` });
  const addSteps = (n: number) => run(async () => { const r = await rpc('test_add_steps', { p_amount: n }); onDone(); return r; }, { ok: `+${num(n)} pasos caminados de prueba` });
  return (
    <Card className="sun">
      <div className="col">
        <div><b>Modo prueba</b> <span className="small muted">· solo para probar, no existe en producción</span></div>
        <div className="row wrap">
          {[500, 2000, 5000].map((n) => <Btn key={n} className="small" busy={busy} onClick={() => addPasos(n)}>+{num(n)} PASOS</Btn>)}
        </div>
        <div className="row wrap">
          {[1000, 5000, 10000].map((n) => <Btn key={n} className="small ghost" busy={busy} onClick={() => addSteps(n)}>+{num(n)} pasos caminados</Btn>)}
        </div>
      </div>
    </Card>
  );
}
