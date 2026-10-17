import { Fragment, useState } from 'react';
import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Btn, Empty, Load, TextField, useAsync } from '../ui/kit';
import { dtFull } from '../ui/format';

export function Auditoria() {
  const { rpc } = useApp();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [more, setMore] = useState<J[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const first = useAsync<J[]>(() => { setMore([]); return rpc('admin_list_audit', { p_limit: 50, p_search: applied || null }); }, [applied]);
  const all = [...(first.data ?? []), ...more];
  return (
    <div className="col">
      <div className="section-title"><h1>Auditoría</h1></div>
      <div className="small muted">Registro de quién hizo qué y cuándo. No se puede editar ni borrar; cada entrada se encadena con la anterior.</div>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
        <div className="grow"><TextField aria-label="Buscar" placeholder="Buscar acción o detalle…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Btn type="submit" icon="search">Buscar</Btn>
      </form>
      <Load q={first} empty={<Empty icon="book" title="No hay registros" />}>
        {() => (
          <>
            <div className="table-wrap"><table className="table"><thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead>
              <tbody>{all.map((a) => (
                <Fragment key={a.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <td>{dtFull(a.ts)}</td><td>{a.actor_name ?? 'Sistema'}<div className="tiny muted">{a.actor_role}</div></td><td className="mono">{a.action}</td><td>{a.summary}</td></tr>
                  {open === a.id && <tr><td colSpan={4}><pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(a.details ?? {}, null, 2)}</pre></td></tr>}
                </Fragment>))}</tbody></table></div>
            {all.length >= 50 && <Btn className="ghost" onClick={async () => { const r = await rpc<J[]>('admin_list_audit', { p_limit: 50, p_before: all[all.length - 1].id, p_search: applied || null }); setMore((x) => [...x, ...r]); }}>Ver más</Btn>}
          </>
        )}
      </Load>
    </div>
  );
}
