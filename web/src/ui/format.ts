const nf = new Intl.NumberFormat('es-AR');
export const num = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '—' : nf.format(Number(n)));
export const pasos = (n: number | string | null | undefined) => `${num(n)} PASOS`;
export const ars = (n: number | string | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n));

const dtf = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const dtfFull = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const df = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const dt = (v: string | Date | null | undefined) => (v ? dtf.format(new Date(v)) : '—');
export const dtFull = (v: string | Date | null | undefined) => (v ? dtfFull.format(new Date(v)) : '—');
export const dateOnly = (v: string | Date | null | undefined) => {
  if (!v) return '—';
  const s = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v);
  return df.format(s);
};
export const monthName = (v: string) => {
  const d = new Date(v + 'T12:00:00');
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(d);
};
export const dayShort = (v: string) => new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(new Date(v + 'T12:00:00')).replace('.', '');

/** "Vence en 3 días" / "Vence en 5 h" / "Vencido" */
export function expiresIn(v: string): string {
  const ms = new Date(v).getTime() - Date.now();
  if (ms <= 0) return 'Vencido';
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return `Vence en ${d} día${d === 1 ? '' : 's'}`;
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `Vence en ${h} h` : 'Vence en minutos';
}

export function age18Max(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}
/** "2026-08-11T10:00" (hora local del navegador) → ISO UTC; vacío → null */
export function localToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
export function isoToLocalInput(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
