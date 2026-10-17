import { useEffect, type ReactNode } from 'react';
import logo from '../assets/anda-logo.png';
import { go, useApp, useHash } from '../app/state';
import { Icon } from '../ui/Icon';
import { useAsync } from '../ui/kit';
import type { J } from '../data/api';
import { Panel } from './Panel';
import { Desafios } from './Desafios';
import { Propuestas } from './Propuestas';
import { Premios } from './Premios';
import { Comercios } from './Comercios';
import { Personas } from './Personas';
import { Actividad } from './Actividad';
import { Cobros } from './Cobros';
import { Equipo } from './Equipo';
import { Control } from './Control';
import { Configuracion } from './Configuracion';
import { Auditoria } from './Auditoria';
import { Imagen } from './Imagen';

interface Item { id: string; label: string; icon: string; show: boolean; el: ReactNode; badge?: number | null }

export default function AdminApp() {
  const { can, isCeo, role, signOut, theme, setTheme, rpc } = useApp();
  const route = useHash();
  // Contadores de pendientes para la barra (se refrescan cada minuto)
  const dash = useAsync<J>(() => rpc('admin_dashboard', { p_days: 30 }), []);
  useEffect(() => { const t = setInterval(() => dash.refresh(), 60000); return () => clearInterval(t); });

  const items: Item[] = [
    { id: 'panel', label: 'Panel', icon: 'chart', show: true, el: <Panel dash={dash} /> },
    { id: 'desafios', label: 'Desafíos', icon: 'trophy', show: isCeo || can('desafios.editar') || can('desafios.aprobar'), el: <Desafios />, badge: dash.data?.challenges_review },
    { id: 'propuestas', label: 'Propuestas', icon: 'campaign', show: true, el: <Propuestas />, badge: dash.data?.proposals_open },
    { id: 'premios', label: 'Premios', icon: 'gift', show: true, el: <Premios /> },
    { id: 'comercios', label: 'Comercios', icon: 'store', show: true, el: <Comercios /> },
    { id: 'personas', label: 'Personas', icon: 'users', show: can('personas.ver'), el: <Personas /> },
    { id: 'actividad', label: 'Visitas y cupones', icon: 'ticket', show: can('visitas.ver') || can('cupones.ver'), el: <Actividad /> },
    { id: 'cobros', label: 'Cobros', icon: 'wallet-steps', show: isCeo, el: <Cobros /> },
    { id: 'equipo', label: 'Equipo', icon: 'shield', show: isCeo, el: <Equipo /> },
    { id: 'control', label: 'Control', icon: 'alert', show: isCeo, el: <Control />, badge: dash.data?.alerts_open },
    { id: 'config', label: 'Configuración', icon: 'settings', show: isCeo, el: <Configuracion /> },
    { id: 'auditoria', label: 'Auditoría', icon: 'book', show: can('auditoria.ver'), el: <Auditoria /> },
    { id: 'imagen', label: 'Imagen y fotos', icon: 'image', show: can('fotos.gestionar'), el: <Imagen /> },
  ];
  const visible = items.filter((i) => i.show);
  const current = visible.find((i) => i.id === route[0]) ?? visible[0];

  useEffect(() => { window.scrollTo(0, 0); }, [current.id]);

  return (
    <div className="ashell">
      <nav className="anav" aria-label="Administración">
        <div className="brandrow">
          <img src={logo} alt="ANDÁ" style={{ filter: 'brightness(0) invert(1)' }} />
          <div className="small" style={{ opacity: 0.8 }}>{role?.display_name ?? (isCeo ? 'CEO' : 'Equipo')} · {isCeo ? 'CEO' : 'Equipo'}</div>
        </div>
        {visible.map((i) => (
          <button key={i.id} aria-current={current.id === i.id ? 'page' : undefined} onClick={() => go(i.id)}>
            <Icon name={i.icon} size={18} />{i.label}
            {i.badge ? <span className="dot">{i.badge}</span> : null}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />Tema</button>
        <button onClick={() => void signOut()}><Icon name="logout" size={18} />Salir</button>
      </nav>
      <main className="amain">{current.el}</main>
    </div>
  );
}
