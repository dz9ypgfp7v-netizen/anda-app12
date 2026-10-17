import type { CSSProperties } from 'react';

const files = import.meta.glob('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const icons: Record<string, string> = {};
for (const [path, raw] of Object.entries(files)) {
  const name = path.split('/').pop()!.replace('.svg', '');
  icons[name] = raw.replace(/ width="24" height="24"/, '');
}

export type IconName = string;

/** Íconos del sistema de diseño (SVG de trazo, 24×24, color heredado). Son archivos propios del proyecto. */
export function Icon({ name, size, style, label }: { name: IconName; size?: number; style?: CSSProperties; label?: string }) {
  const svg = icons[name] ?? icons['help'];
  return (
    <span
      className="icon-svg"
      style={{ ...(size ? { fontSize: size } : null), ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
