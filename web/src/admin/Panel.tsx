import { go, useApp } from '../app/state';
import type { J } from '../data/api';
import { Banner, Card, Load, Stat, type Query } from '../ui/kit';
import { ars, dayShort, num } from '../ui/format';

export function Panel({ dash }: { dash: Query<J> }) {
  const { isCeo } = useApp();
  return (
    <div className="col loose">
      <div className="section-title"><h1>Panel</h1><span className="small muted">últimos 30 días</span></div>
      <Load q={dash}>
        {(d) => (
          <>
            {d.paused && <Banner tone="err" icon="pause"><b>ANDÁ está en pausa.</b> {d.pause_reason}</Banner>}
            {d.test_mode && <Banner tone="warn" icon="help"><b>Modo prueba activo.</b> Las personas ven botones para sumar PASOS de prueba. Desactivalo antes de lanzar.</Banner>}
            {d.environment === 'prueba' && <Banner tone="" icon="shield">Entorno: <b>prueba</b>. Pasá a producción con la guía de lanzamiento.</Banner>}
            {(d.challenges_review > 0 || d.proposals_open > 0) && (
              <Card tone="sun" className="row wrap">
                <b>Para revisar:</b>
                {d.challenges_review > 0 && <button className="btn small" onClick={() => go('desafios')}>{d.challenges_review} desafío(s) en revisión</button>}
                {d.proposals_open > 0 && <button className="btn small" onClick={() => go('propuestas')}>{d.proposals_open} propuesta(s) de comercios</button>}
              </Card>
            )}
            <div className="grid g4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <Card><Stat value={num(d.people_total)} label="Personas registradas" /></Card>
              <Card><Stat value={num(d.people_active)} label="Personas activas" /></Card>
              <Card><Stat value={num(d.merchants_active)} label="Comercios activos" /></Card>
              <Card><Stat value={num(d.branches_active)} label="Locales activos" /></Card>
              <Card><Stat value={num(d.visits_period)} label="Visitas validadas" /></Card>
              <Card><Stat value={num(d.challenges_active)} label="Desafíos activos" /></Card>
              <Card><Stat value={num(d.pasos_credited)} label="PASOS otorgados" /></Card>
              <Card><Stat value={num(d.pasos_spent)} label="PASOS canjeados" /></Card>
              <Card><Stat value={num(d.coupons_issued)} label="Cupones generados" /></Card>
              <Card><Stat value={num(d.coupons_redeemed)} label="Cupones entregados" /></Card>
              {isCeo && <Card onClick={() => go('control')}><Stat value={num(d.alerts_open)} label="Alertas abiertas" /></Card>}
              {isCeo && <Card onClick={() => go('cobros')}><Stat value={ars(d.billing_pending)} label="Cobros pendientes" /></Card>}
            </div>
            <Card>
              <div className="section-title"><b>Visitas por día</b><span className="small muted">14 días</span></div>
              {(() => {
                const max = Math.max(1, ...d.series.map((x: J) => x.visits));
                return (
                  <>
                    <div className="chart" role="img" aria-label="Visitas por día">
                      {d.series.map((x: J) => <i key={x.day} title={`${x.day}: ${x.visits} visitas · ${num(x.pasos)} PASOS`} style={{ height: `${Math.max(3, (x.visits / max) * 100)}%` }} />)}
                    </div>
                    <div className="row between tiny muted" style={{ marginTop: 4 }}>{d.series.map((x: J, i: number) => <span key={x.day}>{i % 2 === 0 ? dayShort(x.day) : ''}</span>)}</div>
                  </>
                );
              })()}
            </Card>
          </>
        )}
      </Load>
    </div>
  );
}
