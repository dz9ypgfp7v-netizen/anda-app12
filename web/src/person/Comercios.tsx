import { useApp } from '../app/state';
import type { J } from '../data/api';
import { Badge, Card, Empty, Load, Photo, useAsync } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { num } from '../ui/format';

const mapsUrl = (b: J) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${b.lat},${b.lng}`)}&travelmode=walking`;

export function Comercios() {
  const { rpc, photo } = useApp();
  const q = useAsync<J[]>(() => rpc('list_merchants_map'), []);
  return (
    <div className="col">
      <div className="section-title"><h2>Comercios</h2></div>
      <div className="small muted">Comercios adheridos con desafíos activos. Tocá “Cómo llegar” para abrir el recorrido a pie en tu app de mapas.</div>
      <Load q={q} empty={<Empty icon="store" title="Todavía no hay comercios">Muy pronto vas a ver comercios cerca tuyo.</Empty>}>
        {(list) => (
          <div className="col">
            {list.map((m) => (
              <Card key={m.id}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <Photo src={photo(m.photo_path)} size={64} icon="store" />
                  <div className="grow col tight">
                    <b>{m.name}</b>
                    <div className="small muted">{[m.category, m.neighborhood].filter(Boolean).join(' · ')}</div>
                    {m.challenges?.length > 0 && (
                      <div className="row wrap" style={{ gap: 6 }}>
                        {m.challenges.map((c: J) => <Badge key={c.id} tone="info">{c.title} · +{num(c.reward_pasos)}</Badge>)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="col tight" style={{ marginTop: 10 }}>
                  {(m.branches ?? []).map((b: J) => (
                    <div key={b.id} className="row between small" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <span><Icon name="location" size={16} /> {b.name}{b.address ? ` · ${b.address}` : ''}</span>
                      {b.lat != null && b.lng != null && (
                        <a className="btn small soft" href={mapsUrl(b)} target="_blank" rel="noopener noreferrer"><Icon name="route" size={16} />Cómo llegar</a>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Load>
    </div>
  );
}
