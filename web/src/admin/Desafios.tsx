import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Confirm, Empty, Field, Load, Modal, PhotoPicker, Photo, Segmented, StateBadge, TextField, useAction, useAsync } from '../ui/kit';
import { dateOnly, dt, isoToLocalInput, localToIso, num } from '../ui/format';
import { ACTION_LABEL, ACTION_PERM, CHALLENGE_STATES, actionsFor, uploadAndSetPhoto } from './common';

export function Desafios() {
  const { rpc, can, isCeo, photo } = useApp();
  const [state, setState] = useState<string>('todos');
  const q = useAsync<J[]>(() => rpc('admin_list_challenges'), []);
  const [edit, setEdit] = useState<J | 'nuevo' | null>(null);
  const [act, setAct] = useState<{ c: J; action: string } | null>(null);
  const [versions, setVersions] = useState<J | null>(null);

  return (
    <div className="col">
      <div className="section-title">
        <h1>Desafíos</h1>
        {(isCeo || can('desafios.editar')) && <Btn icon="plus" onClick={() => setEdit('nuevo')}>Nuevo desafío</Btn>}
      </div>
      <div className="small muted">Ciclo: borrador → revisión → programado → activo → pausado → finalizado. Quien crea o envía un desafío no puede aprobarlo.</div>
      <Load q={q} empty={<Empty icon="trophy" title="Todavía no hay desafíos">Creá el primero con “Nuevo desafío”.</Empty>}>
        {(list) => {
          const count = (s: string) => list.filter((c) => c.state === s).length;
          const items = list.filter((c) => state === 'todos' || c.state === state);
          return (
            <>
              <Segmented value={state} onChange={setState} options={[{ value: 'todos', label: 'Todos', count: list.length }, ...CHALLENGE_STATES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), count: count(s) }))]} />
              <div className="col">
                {items.map((c) => (
                  <Card key={c.id}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <Photo src={photo(c.photo_path)} size={56} icon={c.type === 'visita' ? 'store' : 'footsteps'} />
                      <div className="grow col tight">
                        <div className="row wrap" style={{ gap: 8 }}><b>{c.title}</b><StateBadge state={c.state} />{c.is_example && <Badge>Ejemplo</Badge>}{c.self_approved && <Badge tone="warn">Autoaprobado</Badge>}</div>
                        <div className="small muted">
                          {c.type === 'visita' ? `Visita · ${c.merchant_name}` : `Meta de ${num(c.goal_steps)} pasos`} · +{num(c.reward_pasos)} PASOS · {c.repeat_rule === 'diaria' ? 'una vez por día' : 'una sola vez'}
                          {c.quota_total ? ` · cupo ${num(c.quota_total)}` : ''}{c.per_person_max ? ` · máx. ${c.per_person_max} por persona` : ''}
                        </div>
                        <div className="tiny muted">Usado {num(c.used)} veces · v{c.version} · creado por {c.created_by_name ?? '—'}{c.approved_by_name ? ` · aprobado por ${c.approved_by_name}` : ''}{c.ends_at ? ` · hasta ${dateOnly(c.ends_at)}` : ''}</div>
                        <div className="row wrap" style={{ marginTop: 6 }}>
                          {actionsFor(c.status).filter((a) => isCeo || can(ACTION_PERM[a])).map((a) => (
                            <Btn key={a} className={'small ' + (a === 'finalizar' ? 'danger ghost' : a === 'solicitar_cambios' ? 'ghost' : '')} onClick={() => setAct({ c, action: a })}>{ACTION_LABEL[a]}</Btn>
                          ))}
                          {(isCeo || can('desafios.editar')) && ['borrador', 'programado', 'activo', 'pausado'].includes(c.status) && <Btn className="small ghost" icon="edit" onClick={() => setEdit(c)}>Editar</Btn>}
                          <Btn className="small ghost" icon="clock" onClick={() => setVersions(c)}>Historial</Btn>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          );
        }}
      </Load>

      {edit && <ChallengeForm c={edit === 'nuevo' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); q.refresh(); }} />}
      {act && (
        <Confirm title={`${ACTION_LABEL[act.action]}: ${act.c.title}`} confirmLabel={ACTION_LABEL[act.action]} danger={act.action === 'finalizar'} onClose={() => setAct(null)}
          reason={act.action === 'solicitar_cambios' ? { label: '¿Qué hay que cambiar?', min: 3 } : undefined}
          text={act.action === 'finalizar' ? 'Al finalizar, el desafío deja de estar disponible y no se puede reactivar.' : act.action === 'activar' ? 'Va a quedar visible y disponible para todas las personas.' : act.action === 'aprobar' ? 'Queda programado; después hay que activarlo.' : '¿Confirmás?'}
          onConfirm={async (note) => { const r = await rpc('admin_challenge_transition', { p_id: act.c.id, p_action: act.action, p_note: note || null }); if (r?.ok) q.refresh(); return r; }} />
      )}
      {versions && <Versions c={versions} onClose={() => setVersions(null)} />}
    </div>
  );
}

function ChallengeForm({ c, onClose, onDone }: { c: J | null; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const { rpc, photo, can } = app;
  const merchants = useAsync<J[]>(() => rpc('admin_list_merchants'), []);
  const live = !!c && ['programado', 'activo', 'pausado'].includes(c.status);
  const [f, setF] = useState({
    title: c?.title ?? '', description: c?.description ?? '', type: c?.type ?? 'visita', merchant_id: c?.merchant_id ?? '',
    reward_pasos: String(c?.reward_pasos ?? ''), repeat_rule: c?.repeat_rule ?? 'una_vez', per_person_max: c?.per_person_max != null ? String(c.per_person_max) : '',
    quota_total: c?.quota_total != null ? String(c.quota_total) : '', goal_steps: c?.goal_steps != null ? String(c.goal_steps) : '',
    starts_at: isoToLocalInput(c?.starts_at), ends_at: isoToLocalInput(c?.ends_at),
  });
  const [photoPath, setPhotoPath] = useState<string | null>(c?.photo_path ?? null);
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const { busy, run } = useAction();
  const digits = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value.replace(/\D/g, ''));
  const n = (s: string) => (s.trim() === '' ? null : Number(s));
  const payload = {
    title: f.title, description: f.description, type: f.type, merchant_id: f.type === 'visita' ? f.merchant_id || null : null,
    reward_pasos: n(f.reward_pasos), repeat_rule: f.repeat_rule, per_person_max: n(f.per_person_max), quota_total: n(f.quota_total),
    goal_steps: f.type === 'meta_pasos' ? n(f.goal_steps) : null, starts_at: localToIso(f.starts_at), ends_at: localToIso(f.ends_at), photo_path: photoPath,
  };
  const ok = f.title.trim().length >= 3 && Number(f.reward_pasos) >= 1 && (f.type === 'meta_pasos' ? Number(f.goal_steps) >= 1000 : !!f.merchant_id);
  return (
    <Modal wide title={c ? 'Editar desafío' : 'Nuevo desafío'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!ok} onClick={async () => {
        const r = await run(() => rpc('admin_save_challenge', { p_id: c?.id ?? null, p_data: payload }), { ok: c ? 'Cambios guardados' : 'Borrador creado' });
        if (r?.ok) onDone();
      }}>Guardar</Btn>
    </>}>
      {live && <Banner tone="warn" icon="lock">Este desafío ya está vigente: solo podés cambiar título, descripción y foto. Para cambiar la recompensa, los límites o las fechas, finalizalo y creá uno nuevo.</Banner>}
      <TextField label="Título" value={f.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
      <Field label="Descripción"><textarea className="input" rows={3} maxLength={600} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="grid g2">
        <Field label="Tipo"><select className="input" disabled={live} value={f.type} onChange={(e) => set('type', e.target.value)}>
          <option value="visita">Visita a un comercio</option><option value="meta_pasos">Meta de pasos del día</option></select></Field>
        {f.type === 'visita' ? (
          <Field label="Comercio"><select className="input" disabled={live} value={f.merchant_id} onChange={(e) => set('merchant_id', e.target.value)}>
            <option value="">Elegí un comercio…</option>{(merchants.data ?? []).filter((m) => m.status === 'activo' || m.id === c?.merchant_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        ) : <TextField label="Meta de pasos (1.000 a 100.000)" inputMode="numeric" disabled={live} value={f.goal_steps} onChange={digits('goal_steps')} />}
        <TextField label="PASOS que otorga" inputMode="numeric" disabled={live} value={f.reward_pasos} onChange={digits('reward_pasos')} />
        <Field label="Frecuencia"><select className="input" disabled={live} value={f.repeat_rule} onChange={(e) => set('repeat_rule', e.target.value)}>
          <option value="una_vez">Una sola vez por persona</option><option value="diaria">Una vez por día</option></select></Field>
        <TextField label="Máximo por persona (opcional)" inputMode="numeric" disabled={live} value={f.per_person_max} onChange={digits('per_person_max')} />
        <TextField label="Cupo total (opcional)" inputMode="numeric" disabled={live} value={f.quota_total} onChange={digits('quota_total')} />
        <TextField label="Desde (opcional)" type="datetime-local" disabled={live} value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
        <TextField label="Hasta (opcional)" type="datetime-local" disabled={live} value={f.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
      </div>
      {c && can('fotos.gestionar') && (
        <PhotoPicker path={photoPath} resolve={photo} label="Cambiar foto"
          onPick={async (file) => { setPhotoPath(await uploadAndSetPhoto(app, file, 'challenge', c.id)); }} />
      )}
      {!c && <div className="small muted">La foto se puede cargar después de crear el borrador.</div>}
    </Modal>
  );
}

function Versions({ c, onClose }: { c: J; onClose: () => void }) {
  const { rpc } = useApp();
  const q = useAsync<J[]>(() => rpc('admin_challenge_versions', { p_id: c.id }), [c.id]);
  return (
    <Modal wide title={`Historial: ${c.title}`} onClose={onClose}>
      <div className="small muted">Cada fila es la versión anterior a un cambio.</div>
      <Load q={q} empty={<Empty icon="clock" title="Sin cambios registrados" />}>
        {(list) => list.map((v) => (
          <Card key={v.version} className="flat col tight">
            <div className="row between"><b>Versión {v.version}</b><span className="small muted">{dt(v.ts)} · {v.by ?? '—'}</span></div>
            <div className="small">{v.snapshot.title} · +{num(v.snapshot.reward_pasos)} PASOS · estado {v.snapshot.status}</div>
            {v.snapshot.description && <div className="small muted">{v.snapshot.description}</div>}
          </Card>
        ))}
      </Load>
    </Modal>
  );
}
