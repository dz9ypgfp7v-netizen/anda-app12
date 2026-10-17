import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Banner, Btn, Card, Check, Field, Load, TextField, useAction, useAsync } from '../ui/kit';
import { dt } from '../ui/format';

interface Spec { key: string; label: string; hint?: string; kind: 'int' | 'num' | 'bool' | 'text' }
const GROUPS: { title: string; items: Spec[] }[] = [
  { title: 'Reglas de PASOS y visitas', items: [
    { key: 'daily_cap', label: 'Tope de visitas por persona y día', hint: '1 a 50', kind: 'int' },
    { key: 'coupon_valid_days', label: 'Validez por defecto de un cupón (días)', hint: '1 a 365', kind: 'int' },
    { key: 'refund_on_expiry', label: 'Devolver PASOS si un cupón vence sin usar', kind: 'bool' },
  ] },
  { title: 'Código de visita', items: [
    { key: 'code_rotation_s', label: 'Cambio de código cada (segundos)', hint: '20 a 600', kind: 'int' },
    { key: 'code_grace_s', label: 'Tolerancia del código anterior (segundos)', hint: '0 a 300', kind: 'int' },
    { key: 'max_uses_per_code', label: 'Usos máximos por código', hint: '1 a 200', kind: 'int' },
    { key: 'claim_window_s', label: 'Tiempo para reclamar tras validar (segundos)', hint: '30 a 3600', kind: 'int' },
    { key: 'heartbeat_s', label: 'Tiempo que el local figura “validando” (segundos)', hint: '20 a 600', kind: 'int' },
    { key: 'max_failed_attempts', label: 'Intentos fallidos antes de bloquear', hint: '3 a 30', kind: 'int' },
  ] },
  { title: 'Cobro y controles', items: [
    { key: 'fee_per_visit', label: 'Tarifa por visita por defecto (ARS)', kind: 'num' },
    { key: 'require_merchant_active', label: 'Exigir comercio activo para validar visitas', kind: 'bool' },
    { key: 'require_gps', label: 'Exigir ubicación (GPS) para validar visitas', hint: 'Solo funciona en la app nativa; en la web dejalo apagado.', kind: 'bool' },
    { key: 'mfa_required', label: 'Exigir segundo factor (TOTP) a Equipo, Comercio y CEO', hint: 'Antes de activarlo, cada cuenta debe poder configurarlo.', kind: 'bool' },
  ] },
  { title: 'Textos legales', items: [
    { key: 'terms_version', label: 'Versión de Términos y condiciones', hint: 'Si cambia, todas las personas deberán aceptar de nuevo.', kind: 'text' },
    { key: 'privacy_version', label: 'Versión de Política de privacidad', kind: 'text' },
  ] },
  { title: 'Pruebas', items: [
    { key: 'test_mode', label: 'Modo prueba (botones para sumar PASOS de prueba)', hint: 'Nunca en producción: el servidor lo bloquea.', kind: 'bool' },
  ] },
];

export function Configuracion() {
  const { rpc, reloadCtx } = useApp();
  const cfg = useAsync<J>(() => rpc('admin_get_config'), []);
  const hist = useAsync<J[]>(() => rpc('admin_config_history', { p_limit: 30 }), []);
  return (
    <div className="col loose">
      <div className="section-title"><h1>Configuración</h1></div>
      <Load q={cfg}>{(c) => <Form c={c} onSaved={() => { cfg.refresh(); hist.refresh(); void reloadCtx(); }} />}</Load>
      <div className="col">
        <h2>Historial de cambios</h2>
        <Load q={hist}>{(list) => list.length === 0 ? <div className="small muted">Todavía no se cambió nada.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Cuándo</th><th>Quién</th><th>Ajuste</th><th>Antes → después</th><th>Motivo</th></tr></thead>
            <tbody>{list.map((h, i) => <tr key={i}><td>{dt(h.ts)}</td><td>{h.by}</td><td className="mono">{h.key}</td><td>{h.old_value} → <b>{h.new_value}</b></td><td>{h.reason}</td></tr>)}</tbody></table></div>
        )}</Load>
      </div>
    </div>
  );
}

function Form({ c, onSaved }: { c: J; onSaved: () => void }) {
  const { rpc } = useApp();
  const init: Record<string, string | boolean> = {};
  GROUPS.forEach((g) => g.items.forEach((s) => { init[s.key] = s.kind === 'bool' ? !!c[s.key] : String(c[s.key] ?? ''); }));
  const [vals, setVals] = useState(init);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const changes: Record<string, string | boolean> = {};
  Object.keys(init).forEach((k) => { if (String(vals[k]) !== String(init[k])) changes[k] = vals[k]; });
  const dirty = Object.keys(changes).length;
  return (
    <>
      <Banner tone="" icon="shield">Entorno: <b>{c.environment}</b>. {c.environment === 'prueba' ? 'El pasaje a producción se hace desde el editor SQL de Supabase (guía de lanzamiento).' : 'En producción el modo prueba está bloqueado.'}</Banner>
      {GROUPS.map((g) => (
        <Card key={g.title} className="col">
          <h2>{g.title}</h2>
          {g.items.map((s) => s.kind === 'bool'
            ? <div key={s.key}><Check checked={!!vals[s.key]} onChange={(v) => setVals((o) => ({ ...o, [s.key]: v }))}>{s.label}</Check>{s.hint && <div className="hint tiny muted" style={{ marginLeft: 34 }}>{s.hint}</div>}</div>
            : <TextField key={s.key} label={s.label} hint={s.hint} inputMode={s.kind === 'text' ? 'text' : 'decimal'} value={String(vals[s.key])}
                onChange={(e) => setVals((o) => ({ ...o, [s.key]: s.kind === 'text' ? e.target.value : e.target.value.replace(s.kind === 'int' ? /\D/g : /[^0-9.]/g, '') }))} />)}
        </Card>
      ))}
      <Card className="col">
        <Field label={`Motivo del cambio${dirty ? '' : ' (cambiá algo para habilitar)'}`}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: subimos el tope diario para la campaña de octubre" /></Field>
        <Btn busy={busy} disabled={!dirty || reason.trim().length < 3} onClick={async () => {
          const r = await run(() => rpc('admin_update_config', { p_changes: changes, p_reason: reason.trim() }), { ok: 'Configuración guardada' });
          if (r?.ok) { setReason(''); onSaved(); }
        }}>Guardar {dirty ? `${dirty} cambio(s)` : ''}</Btn>
      </Card>
    </>
  );
}
