import { useEffect } from 'react';
import logo from '../assets/anda-logo.png';
import { go, useApp, useHash } from '../app/state';
import { Icon } from '../ui/Icon';
import { useAsync, type Query } from '../ui/kit';
import { num } from '../ui/format';
import type { J } from '../data/api';
import { AceptarTerminos, Registro } from './Registro';
import { Inicio } from './Inicio';
import { Desafios } from './Desafios';
import { Comercios } from './Comercios';
import { Premios } from './Premios';
import { Yo } from './Yo';

export type Home = Query<J>;

const TABS = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'desafios', label: 'Desafíos', icon: 'trophy' },
  { id: 'comercios', label: 'Comercios', icon: 'store' },
  { id: 'premios', label: 'Premios', icon: 'gift' },
  { id: 'yo', label: 'Yo', icon: 'user' },
] as const;

export default function PersonApp() {
  const { ctx } = useApp();
  if (!ctx.profile) return <Registro />;
  if (ctx.profile.needs_terms) return <AceptarTerminos />;
  return <Shell />;
}

function Shell() {
  const { rpc } = useApp();
  const route = useHash();
  const tab = TABS.find((t) => t.id === route[0])?.id ?? 'inicio';
  const home = useAsync<J>(() => rpc('person_home'), []);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  // Al volver a la app, se refresca el saldo.
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'visible') home.refresh(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  });

  return (
    <>
      <div className="pshell">
        <header className="topbar">
          <img className="brand" src={logo} alt="ANDÁ" />
          {home.data && <div className="badge info" aria-label="Tus PASOS"><Icon name="footsteps" size={16} /> <span className="num">{num(home.data.balance)}</span> PASOS</div>}
        </header>
        <main>
          {tab === 'inicio' && <Inicio home={home} />}
          {tab === 'desafios' && <Desafios home={home} />}
          {tab === 'comercios' && <Comercios />}
          {tab === 'premios' && <Premios home={home} />}
          {tab === 'yo' && <Yo home={home} />}
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
