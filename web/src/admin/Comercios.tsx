import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Banner, Btn, Card, Confirm, Empty, Field, Load, Modal, Photo, PhotoPicker, TextField, useAction, useAsync } from '../ui/kit';
import { ars, num } from '../ui/format';
import { uploadAndSetPhoto } from './common';

export function Comercios() {
  const app = useApp();
  const { rpc, isCeo, can, photo } = app;
  const q = useAsync<J[]>(() => rpc('admin_list_merchants'), []);
  const [edit, setEdit] = useState<J | 'nuevo' | null>(null);
  const [branch, setBranch] = useState<{ m: J; b: J | null } | null>(null);
  const [status, setStatus] = useState<J | null>(null);
  return (
    <div className="col">
      <div className="section-title"><h1>Comercios</h1>{isCeo && <Btn icon="plus" onClick={() => setEdit('nuevo')}>Nuevo comercio</Btn>}</div>
      <div className="small muted">Los comercios los da de alta solo el CEO. Cada comercio ve únicamente datos agregados.</div>
      <Load q={q} empty={<Empty icon="store" title="Todavía no hay comercios" />}>
        {(list) => list.map((m) => (
          <Card key={m.id} className="col">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Photo src={photo(m.photo_path)} size={56} icon="store" />
              <div className="grow col tight">
                <div className="row wrap" style={{ gap: 8 }}><b>{m.name}</b><Badge tone={m.status === 'activo' ? 'ok' : 'err'}>{m.status === 'activo' ? 'Activo' : 'Suspendido'}</Badge>{m.is_example && <Badge>Ejemplo</Badge>}</div>
                <div className="small muted">{[m.category, m.neighborhood].filter(Boolean).join(' · ')} · {num(m.visits)} visitas{isCeo ? ` · ${m.accounts} cuenta(s) · tarifa ${ars(m.fee_per_visit)} por visita` : ''}</div>
                {m.status_reason && <div className="tiny muted">Motivo: {m.status_reason}</div>}
              </div>
            </div>
            <div className="col tight">
              {m.branches.map((b: J) => (
                <div key={b.id} className="row between small" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span>{b.name}{b.address ? ` · ${b.address}` : ''} {b.status !== 'activo' && <Badge tone="err">Suspendido</Badge>}</span>
                  {isCeo && <Btn className="small ghost" icon="edit" onClick={() => setBranch({ m, b })}>Editar</Btn>}
                </div>
              ))}
            </div>
            {isCeo && (
              <div className="row wrap">
                <Btn className="small ghost" icon="edit" onClick={() => setEdit(m)}>Editar comercio</Btn>
                <Btn className="small ghost" icon="plus" onClick={() => setBranch({ m, b: null })}>Agregar local</Btn>
                <Btn className={'small ghost ' + (m.status === 'activo' ? 'danger' : '')} onClick={() => setStatus(m)}>{m.status === 'activo' ? 'Suspender' : 'Reactivar'}</Btn>
              </div>
            )}
            {can('fotos.gestionar') && (
              <PhotoPicker path={m.photo_path} resolve={photo} label="Foto del comercio" size={44}
                onPick={async (file) => { await uploadAndSetPhoto(app, file, 'merchant', m.id); q.refresh(); }} />
            )}
          </Card>
        ))}
      </Load>
      {edit && <MerchantForm m={edit === 'nuevo' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); q.refresh(); }} />}
      {branch && <BranchForm m={branch.m} b={branch.b} onClose={() => setBranch(null)} onDone={() => { setBranch(null); q.refresh(); }} />}
      {status && (
        <Confirm title={status.status === 'activo' ? `Suspender ${status.name}` : `Reactivar ${status.name}`} confirmLabel={status.status === 'activo' ? 'Suspender' : 'Reactivar'} danger={status.status === 'activo'}
          reason={{ label: 'Motivo', min: 3 }}
          text={status.status === 'activo' ? 'El comercio deja de validar visitas y de entregar cupones, y sus desafíos dejan de estar disponibles.' : 'Vuelve a operar con normalidad.'}
          onClose={() => setStatus(null)}
          onConfirm={async (reason) => { const r = await rpc('admin_set_merchant_status', { p_id: status.id, p_status: status.status === 'activo' ? 'suspendido' : 'activo', p_reason: reason }); if (r?.ok) q.refresh(); return r; }} />
      )}
    </div>
  );
}

function MerchantForm({ m, onClose, onDone }: { m: J | null; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [f, setF] = useState({ name: m?.name ?? '', category: m?.category ?? '', neighborhood: m?.neighborhood ?? '', description: m?.description ?? '', fee: m?.fee_per_visit != null ? String(m.fee_per_visit) : '',
    bname: '', baddress: '', blat: '', blng: '' });
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const { busy, run } = useAction();
  return (
    <Modal wide title={m ? 'Editar comercio' : 'Nuevo comercio'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={f.name.trim().length < 2} onClick={async () => {
        const data: J = { name: f.name, category: f.category, neighborhood: f.neighborhood, description: f.description, fee_per_visit: f.fee === '' ? null : f.fee.replace(',', '.') };
        if (!m && f.bname.trim().length >= 2) data.branch = { name: f.bname, address: f.baddress, lat: f.blat.replace(',', '.'), lng: f.blng.replace(',', '.') };
        const r = await run(() => rpc('admin_save_merchant', { p_id: m?.id ?? null, p_data: data }), { ok: 'Comercio guardado' });
        if (r?.ok) onDone();
      }}>Guardar</Btn>
    </>}>
      <TextField label="Nombre" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
      <div className="grid g2">
        <TextField label="Rubro" value={f.category} placeholder="café, panadería…" onChange={(e) => set('category', e.target.value)} />
        <TextField label="Barrio" value={f.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />
      </div>
      <Field label="Descripción"><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <TextField label="Tarifa por visita validada (ARS)" inputMode="decimal" value={f.fee} onChange={(e) => set('fee', e.target.value.replace(/[^0-9.,]/g, ''))}
        hint="Es lo que se le cobra al comercio por cada visita. Los cambios no modifican visitas anteriores (queda el valor histórico)." />
      {!m && (
        <>
          <b>Primer local (opcional)</b>
          <div className="grid g2">
            <TextField label="Nombre del local" value={f.bname} onChange={(e) => set('bname', e.target.value)} />
            <TextField label="Dirección" value={f.baddress} onChange={(e) => set('baddress', e.target.value)} />
            <TextField label="Latitud" inputMode="decimal" value={f.blat} onChange={(e) => set('blat', e.target.value)} placeholder="-34.6037" />
            <TextField label="Longitud" inputMode="decimal" value={f.blng} onChange={(e) => set('blng', e.target.value)} placeholder="-58.3816" />
          </div>
        </>
      )}
      {!m && <Banner tone="" icon="help">Después de crearlo, cargá la cuenta de acceso del comercio desde Equipo → Nueva cuenta.</Banner>}
    </Modal>
  );
}

function BranchForm({ m, b, onClose, onDone }: { m: J; b: J | null; onClose: () => void; onDone: () => void }) {
  const { rpc } = useApp();
  const [f, setF] = useState({ name: b?.name ?? '', address: b?.address ?? '', lat: b?.lat != null ? String(b.lat) : '', lng: b?.lng != null ? String(b.lng) : '', radius: String(b?.radius_m ?? 80), status: b?.status ?? 'activo' });
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const { busy, run } = useAction();
  return (
    <Modal title={(b ? 'Editar local' : 'Nuevo local') + ' · ' + m.name} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={f.name.trim().length < 2} onClick={async () => {
        const r = await run(() => rpc('admin_save_branch', { p_id: b?.id ?? null, p_merchant: m.id, p_data: { name: f.name, address: f.address, lat: f.lat.replace(',', '.'), lng: f.lng.replace(',', '.'), radius_m: f.radius, status: f.status } }), { ok: 'Local guardado' });
        if (r?.ok) onDone();
      }}>Guardar</Btn>
    </>}>
      <TextField label="Nombre del local" value={f.name} onChange={(e) => set('name', e.target.value)} />
      <TextField label="Dirección" value={f.address} onChange={(e) => set('address', e.target.value)} />
      <div className="grid g2">
        <TextField label="Latitud" inputMode="decimal" value={f.lat} onChange={(e) => set('lat', e.target.value)} />
        <TextField label="Longitud" inputMode="decimal" value={f.lng} onChange={(e) => set('lng', e.target.value)} />
        <TextField label="Radio de validación (m)" inputMode="numeric" value={f.radius} onChange={(e) => set('radius', e.target.value.replace(/\D/g, ''))} hint="Se usa cuando la validación por ubicación (GPS) esté activa." />
        <Field label="Estado"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="activo">Activo</option><option value="suspendido">Suspendido</option></select></Field>
      </div>
    </Modal>
  );
}
