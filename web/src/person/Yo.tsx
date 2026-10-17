import { useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Banner, Btn, Card, Empty, Load, Modal, TextField, useAction, useAsync } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { downloadJson, dt, num } from '../ui/format';
import type { Home } from './PersonApp';

const KIND: Record<string, string> = {
  visita: 'Visita a comercio', meta_pasos: 'Meta de pasos', canje: 'Canje de premio', devolucion: 'Devolución',
  reversion: 'Corrección', ajuste: 'Ajuste', prueba: 'Movimiento de prueba',
};

export function Yo({ home }: { home: Home }) {
  const { rpc, ctx, theme, setTheme, signOut, backend } = useApp();
  const [editName, setEditName] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [del, setDel] = useState(false);
  const { busy, run } = useAction();

  return (
    <div className="col loose">
      <div className="section-title"><h2>Yo</h2></div>
      <Card>
        <div className="row between">
          <div><b style={{ fontSize: 20 }}>{ctx.profile?.display_name}</b><div className="small muted">{home.data ? `${num(home.data.balance)} PASOS` : ''}</div></div>
          <Btn className="small ghost" icon="edit" onClick={() => setEditName(true)}>Cambiar nombre</Btn>
        </div>
      </Card>

      <Card className="col">
        <Btn className="ghost block" icon="wallet-steps" onClick={() => setShowLedger(true)}>Historial de PASOS</Btn>
        <div className="col tight">
          <b>Apariencia</b>
          <div className="filters">
            {([['auto', 'Automática'], ['light', 'Clara'], ['dark', 'Oscura']] as const).map(([v, l]) =>
              <button key={v} className="chip" aria-pressed={theme === v} onClick={() => setTheme(v)}>{l}</button>)}
          </div>
        </div>
      </Card>

      <Card className="col">
        <b>Tus datos</b>
        <div className="small muted">Guardamos tu nombre y tu fecha de nacimiento (privada). No guardamos documento de identidad. Podés descargar o eliminar tus datos cuando quieras.</div>
        <Btn className="ghost block" icon="download" busy={busy} onClick={() => run(async () => { downloadJson('anda-mis-datos.json', await rpc('export_my_data')); return { ok: true }; }, { ok: 'Descarga lista' })}>Descargar mis datos</Btn>
        <Btn className="danger ghost block" icon="trash" onClick={() => setDel(true)}>Eliminar mi cuenta</Btn>
      </Card>

      <Card className="col">
        <div className="small muted">Términos v{ctx.config.terms_version} · Privacidad v{ctx.config.privacy_version}. Los PASOS no tienen valor monetario ni se pueden transferir o vender.</div>
        <Btn className="ghost block" icon="logout" onClick={() => void signOut()}>Cambiar perfil / salir</Btn>
      </Card>

      {editName && <NameModal onClose={() => setEditName(false)} />}
      {showLedger && <Ledger onClose={() => setShowLedger(false)} />}
      {del && (
        <DeleteModal onClose={() => setDel(false)} onConfirm={async () => {
          const r = await backend.accounts.deleteMyAccount();
          if (r.ok) await signOut();
          return r;
        }} />
      )}
    </div>
  );
}

function NameModal({ onClose }: { onClose: () => void }) {
  const { rpc, ctx, reloadCtx } = useApp();
  const [n, setN] = useState(ctx.profile?.display_name ?? '');
  const { busy, run } = useAction();
  return (
    <Modal title="Cambiar nombre" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn busy={busy} disabled={n.trim().length < 2} onClick={async () => {
        const r = await run(() => rpc('update_my_name', { p_name: n.trim() }), { ok: 'Nombre actualizado' });
        if (r?.ok) { await reloadCtx(); onClose(); }
      }}>Guardar</Btn>
    </>}>
      <TextField label="Nombre" value={n} maxLength={60} onChange={(e) => setN(e.target.value)} autoFocus />
    </Modal>
  );
}

function Ledger({ onClose }: { onClose: () => void }) {
  const { rpc } = useApp();
  const first = useAsync<J[]>(() => rpc('my_ledger', { p_limit: 30 }), []);
  const [more, setMore] = useState<J[]>([]);
  const [done, setDone] = useState(false);
  const { busy, run } = useAction();
  const all = [...(first.data ?? []), ...more];
  return (
    <Modal title="Historial de PASOS" onClose={onClose} wide>
      <Load q={first} empty={<Empty icon="wallet-steps" title="Todavía no hay movimientos" />}>
        {() => (
          <div className="col tight">
            {all.map((l) => (
              <div key={l.id} className="row between" style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
                <div>
                  <b>{l.label ?? KIND[l.kind] ?? l.kind}</b>
                  <div className="tiny muted">{KIND[l.kind] ?? l.kind} · {dt(l.created_at)}{l.reason ? ' · ' + l.reason : ''}</div>
                </div>
                <b className="num" style={{ color: l.amount > 0 ? 'var(--ok)' : 'var(--err)' }}>{l.amount > 0 ? '+' : ''}{num(l.amount)}</b>
              </div>
            ))}
            {!done && all.length >= 30 && (
              <Btn className="ghost" busy={busy} onClick={() => run(async () => {
                const r = await rpc<J[]>('my_ledger', { p_limit: 30, p_before: all[all.length - 1].id });
                setMore((m) => [...m, ...r]); if (r.length < 30) setDone(true); return { ok: true };
              })}>Ver más</Btn>
            )}
          </div>
        )}
      </Load>
    </Modal>
  );
}

function DeleteModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<unknown> }) {
  const [t, setT] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal title="Eliminar mi cuenta" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn className="danger" busy={busy} disabled={t.trim().toUpperCase() !== 'ELIMINAR'} onClick={() => run(onConfirm)}>Eliminar para siempre</Btn>
    </>}>
      <Banner tone="err" icon="alert">Se borran tu perfil y tus datos. Perdés tus PASOS y se anulan tus cupones pendientes. No se puede deshacer.</Banner>
      <TextField label="Para confirmar, escribí ELIMINAR" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="small muted"><Icon name="shield" size={14} /> Por obligaciones de control, algunos registros de movimientos se conservan sin tus datos personales.</div>
    </Modal>
  );
}
