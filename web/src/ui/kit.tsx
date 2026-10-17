import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { STATE_LABEL, STATE_TONE, reasonText } from './reasons';
import { ApiError } from '../data/api';

/* ---------- Avisos ---------- */
type ToastItem = { id: number; text: string; kind: '' | 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: '' | 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: '' | 'ok' | 'err' = '') => {
    const id = Date.now() + Math.random();
    setItems((a) => [...a.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((a) => a.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- Carga de datos ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, set] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const alive = useRef(true);
  const seq = useRef(0);
  const run = useCallback(async (silent = false) => {
    const my = ++seq.current;
    if (!silent) set((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await fn();
      if (alive.current && my === seq.current) set({ data, loading: false });
    } catch (e) {
      if (alive.current && my === seq.current) set((s) => ({ data: s.data, loading: false, error: e instanceof ApiError ? e : new ApiError(String((e as Error).message)) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; void run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: () => run(), refresh: () => run(true) };
}
export type Query<T> = ReturnType<typeof useAsync<T>>;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return reasonText(e.message, e.message || 'Algo salió mal.');
  return 'Algo salió mal. Probá de nuevo.';
}

/** Muestra el estado de una carga: esqueleto, error con reintento o el contenido. */
export function Load<T>({ q, children, empty }: { q: Query<T>; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (q.loading && q.data === undefined) return <div className="col"><div className="skeleton" /><div className="skeleton" style={{ height: 40 }} /></div>;
  if (q.error && q.data === undefined) {
    return (
      <div className="banner err" role="alert"><Icon name="alert" /><div className="grow"><b>No se pudo cargar.</b> {errorText(q.error)}</div>
        <button className="btn small ghost" onClick={() => q.reload()}>Reintentar</button></div>
    );
  }
  const d = q.data as T;
  if (empty && Array.isArray(d) && d.length === 0) return <>{empty}</>;
  return <>{children(d)}</>;
}

/* ---------- Botón con estado de envío ---------- */
export function Btn({ busy, icon, children, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; icon?: string }) {
  return (
    <button {...p} className={'btn ' + className} disabled={p.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" style={{ width: 18, height: 18, borderTopColor: 'currentColor' }} /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

/** Ejecuta una acción con control de doble toque, aviso de error y mensaje de éxito. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, opt: { ok?: string } = {}): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      const r = await fn();
      const rr = r as { ok?: boolean; reason?: string } | undefined;
      if (rr && typeof rr === 'object' && 'ok' in rr && rr.ok === false) { toast(reasonText(rr.reason), 'err'); return r; }
      if (opt.ok) toast(opt.ok, 'ok');
      return r;
    } catch (e) {
      toast(errorText(e), 'err');
      return undefined;
    } finally { lock.current = false; setBusy(false); }
  }, [toast]);
  return { busy, run };
}

/* ---------- Campos ---------- */
export function Field({ label, hint, error, children, htmlFor }: { label?: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  const auto = useId();
  // Si el control es un select/textarea/input sin id, se lo asignamos para que la etiqueta quede asociada (accesibilidad).
  let control = children;
  let forId = htmlFor;
  if (isValidElement(children) && typeof children.type === 'string' && ['select', 'textarea', 'input'].includes(children.type)) {
    const el = children as ReactElement<{ id?: string }>;
    forId = forId ?? el.props.id ?? auto;
    if (!el.props.id) control = cloneElement(el, { id: forId });
  }
  return (
    <div className="field">
      {label && <label htmlFor={forId}>{label}</label>}
      {control}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
export function TextField({ label, hint, error, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string | null }) {
  const id = useRef('f' + Math.random().toString(36).slice(2, 8)).current;
  return <Field label={label} hint={hint} error={error} htmlFor={id}><input id={id} {...p} className={'input ' + (error ? 'invalid ' : '') + (p.className || '')} /></Field>;
}
export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{children}</span></label>;
}

/* ---------- Estructura ---------- */
export function Card({ children, className = '', onClick, tone }: { children: ReactNode; className?: string; onClick?: () => void; tone?: 'night' | 'sun' }) {
  return <div className={`card ${tone || ''} ${onClick ? 'clickable' : ''} ${className}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}>{children}</div>;
}
export function Badge({ tone = '', children }: { tone?: string; children: ReactNode }) { return <span className={'badge ' + tone}>{children}</span>; }
export function StateBadge({ state }: { state: string }) { return <Badge tone={STATE_TONE[state] ?? ''}>{STATE_LABEL[state] ?? state}</Badge>; }
export function Banner({ tone = '', icon = 'alert', children }: { tone?: '' | 'warn' | 'err' | 'ok' | 'sun'; icon?: string; children: ReactNode }) {
  return <div className={'banner ' + tone} role={tone === 'err' ? 'alert' : undefined}><Icon name={icon} /><div className="grow">{children}</div></div>;
}
export function Empty({ icon = 'footsteps', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} /><div><b style={{ color: 'var(--text)' }}>{title}</b></div>{children && <div className="small" style={{ marginTop: 4 }}>{children}</div>}</div>;
}
export function Crosswalk({ value, max, n = 8 }: { value: number; max: number; n?: number }) {
  const on = max <= 0 ? n : Math.min(n, Math.floor((Math.max(0, value) / max) * n));
  return <div className="crosswalk" style={{ ['--n' as string]: n }} role="img" aria-label={`Progreso: ${on} de ${n}`}>{Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</div>;
}
export function Photo({ src, size = 64, icon = 'image', round }: { src: string | null; size?: number; icon?: string; round?: boolean }) {
  return <div className="photo" style={{ width: size, height: size, borderRadius: round ? '50%' : undefined }}>{src ? <img src={src} alt="" loading="lazy" /> : <Icon name={icon} />}</div>;
}
export function Stat({ value, label }: { value: ReactNode; label: string }) { return <div className="stat"><b>{value}</b><span>{label}</span></div>; }

/* ---------- Ventana ---------- */
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="btn small icon ghost" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={18} /></button>
        </div>
        <div className="col">{children}</div>
        {footer && <div className="row wrap" style={{ marginTop: 16, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = 'Confirmar', danger, onConfirm, onClose, reason }: {
  title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown> | unknown; reason?: { label: string; min?: number };
}) {
  const [why, setWhy] = useState('');
  const { busy, run } = useAction();
  const need = reason?.min ?? 0;
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <Btn className={danger ? 'danger' : ''} busy={busy} disabled={!!reason && why.trim().length < need}
        onClick={async () => { const r = await run(async () => onConfirm(why.trim())); const rr = r as { ok?: boolean } | undefined; if (r !== undefined && rr?.ok !== false) onClose(); }}>{confirmLabel}</Btn>
    </>}>
      <div>{text}</div>
      {reason && <TextField label={reason.label} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Escribí el motivo" autoFocus />}
    </Modal>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return <div className="filters" role="tablist">{options.map((o) => <button key={o.value} className="chip" role="tab" aria-pressed={value === o.value} aria-selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined ? ` · ${o.count}` : ''}</button>)}</div>;
}

/** Foto editable: elige un archivo, lo reduce y lo sube. */
export function PhotoPicker({ path, resolve, onPick, label = 'Cambiar foto', size = 72 }: { path: string | null; resolve: (p: string | null) => string | null; onPick: (file: File) => Promise<unknown>; label?: string; size?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  return (
    <div className="row">
      <Photo src={resolve(path)} size={size} />
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={label}
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await run(() => onPick(f), { ok: 'Foto actualizada' }); }} />
      <Btn className="small ghost" icon="camera" busy={busy} onClick={() => ref.current?.click()}>{label}</Btn>
    </div>
  );
}
