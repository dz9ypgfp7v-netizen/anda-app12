import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Btn, Card, Empty, Field, Load, Modal, Photo, PhotoPicker, TextField, useAction, useAsync } from '../ui/kit';
import { dt, num } from '../ui/format';
import { uploadAndSetPhoto } from './common';

const STATUS: Record<string, string> = { borrador: 'Borrador', activo: 'Activo', pausado: 'Pausado' };

export function Premios() {
  const { rpc, can, isCeo, photo } = useApp();
  const q = useAsync<J[]>(() => rpc('admin_list_rewards'), []);
  const [edit, setEdit] = useState<J | 'nuevo' | null>(null);
  const [hist, setHist] = useState<J | null>(null);
  const manage = isCeo || can('catalogo.gestionar');
  return (
    <div className="col">
      <div className="section-title"><h1>Premios</h1>{manage && <Btn icon="plus" onClick={() => setEdit('nuevo')}>Nuevo premio</Btn>}</div>
      <Load q={q} empty={<Empty icon="gift" title="Todavía no hay premios" />}>
        {(list) => list.map((r) => (
          <Card key={r.id}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Photo src={photo(r.photo_path)} size={56} icon="gift" />
              <div className="grow col tight">
                <div className="row wrap" style={{ gap: 8 }}><b>{r.title}</b><Badge tone={r.status === 'activo' ? 'ok' : 'warn'}>{STATUS[r.status] ?? r.status}</Badge>{r.is_example && <Badge>Ejemplo</Badge>}</div>
                <div className="small muted">{r.merchant_name} · {num(r.cost_pasos)} PASOS · {r.unlimited ? 'sin límite de stock' : `stock ${r.stock}`} · válido {r.valid_days} días{r.per_person_max ? ` · máx. ${r.per_person_max} por persona` : ''}</div>
                <div className="row wrap" style={{ marginTop: 6 }}>
                  {manage && <Btn className="small ghost" icon="edit" onClick={() => setEdit(r)}>Editar</Btn>}
                  <Btn className="small ghost" icon="clock" onClick={() => setHist(r)}>Historial</Btn>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </Load>
      {edit && <RewardForm r={edit === 'nuevo' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); q.refresh(); }} />}
      {hist && <History r={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function RewardForm({ r, onClose, onDone }: { r: J | null; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const { rpc, can, photo } = app;
  const merchants = useAsync<J[]>(() => rpc('admin_list_merchants'), []);
  const [f, setF] = useState({
    merchant_id: r?.merchant_id ?? '', title: r?.title ?? '', description: r?.description ?? '', cost_pasos: String(r?.cost_pasos ?? ''),
    stock: r && !r.unlimited ? String(r.stock) : '', per_person_max: r?.per_person_max != null ? String(r.per_person_max) : '',
    valid_days: String(r?.valid_days ?? 30), conditions: r?.conditions ?? '', status: r?.status ?? 'borrador',
  });
  const [photoPath, setPhotoPath] = useState<string | null>(r?.photo_path ?? null);
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const digits = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value.replace(/\D/g, ''));
  const n = (s: string) => (s.trim() === '' ? null : Number(s));
  const { busy, run } = useAction();
  const ok = f.title.trim().length >= 3 && Number(f.cost_pasos) >= 1 && !!f.merchant_id;
  return (
    <Modal wide title={r ? 'Editar premio' : 'Nuevo premio'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={!ok} onClick={async () => {
        const data = { merchant_id: f.merchant_id, title: f.title, description: f.description, cost_pasos: n(f.cost_pasos), stock: n(f.stock), per_person_max: n(f.per_person_max),
          valid_days: n(f.valid_days) ?? 30, conditions: f.conditions, status: f.status, photo_path: photoPath };
        const res = await run(() => rpc('admin_save_reward', { p_id: r?.id ?? null, p_data: data }), { ok: 'Premio guardado' });
        if (res?.ok) onDone();
      }}>Guardar</Btn>
    </>}>
      <Field label="Comercio"><select className="input" value={f.merchant_id} onChange={(e) => set('merchant_id', e.target.value)}>
        <option value="">Elegí un comercio…</option>{(merchants.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <TextField label="Título" value={f.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
      <Field label="Descripción"><textarea className="input" rows={2} maxLength={600} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="grid g2">
        <TextField label="Costo en PASOS" inputMode="numeric" value={f.cost_pasos} onChange={digits('cost_pasos')} />
        <TextField label="Stock (vacío = sin límite)" inputMode="numeric" value={f.stock} onChange={digits('stock')} />
        <TextField label="Máximo por persona (opcional)" inputMode="numeric" value={f.per_person_max} onChange={digits('per_person_max')} />
        <TextField label="Días de validez del cupón" inputMode="numeric" value={f.valid_days} onChange={digits('valid_days')} />
      </div>
      <Field label="Condiciones (opcional)"><textarea className="input" rows={2} maxLength={600} value={f.conditions} onChange={(e) => set('conditions', e.target.value)} /></Field>
      <Field label="Estado"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
        <option value="borrador">Borrador (no se ve)</option><option value="activo">Activo (visible)</option><option value="pausado">Pausado</option></select></Field>
      {r && can('fotos.gestionar') && <PhotoPicker path={photoPath} resolve={photo} onPick={async (file) => { setPhotoPath(await uploadAndSetPhoto(app, file, 'reward', r.id)); }} />}
      {!r && <div className="small muted">La foto se puede cargar después de crear el premio.</div>}
    </Modal>
  );
}

function History({ r, onClose }: { r: J; onClose: () => void }) {
  const { rpc } = useApp();
  const q = useAsync<J>(() => rpc('admin_reward_history', { p_id: r.id }), [r.id]);
  return (
    <Modal title={`Historial: ${r.title}`} onClose={onClose}>
      <Load q={q}>{(h) => (
        <>
          <b>Cambios de precio</b>
          {h.prices.length === 0 ? <div className="small muted">Sin cambios.</div> : h.prices.map((p: J, i: number) => (
            <div key={i} className="row between small"><span>{p.old_cost == null ? 'Alta' : `${num(p.old_cost)} → `}{num(p.new_cost)} PASOS</span><span className="muted">{dt(p.changed_at)} · {p.by ?? '—'}</span></div>
          ))}
          <b>Ediciones</b>
          {h.versions.length === 0 ? <div className="small muted">Sin ediciones.</div> : h.versions.map((v: J) => (
            <div key={v.version} className="row between small"><span>Versión {v.version}</span><span className="muted">{dt(v.ts)} · {v.by ?? '—'}</span></div>
          ))}
        </>
      )}</Load>
    </Modal>
  );
}
