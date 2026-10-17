# 5 · Figma (diseño)

**Importante:** el código de la app es la fuente de verdad del diseño. Figma sirve para **explorar variantes, mostrar pantallas y trabajar con diseñadores**. No hay nada que "exportar de Figma" para que la app funcione.

> Nada de lo que hay en este paquete se creó ni se modificó en tu cuenta de Figma. Si querés que arme el archivo de Figma por vos (biblioteca de colores, tipografías, componentes y pantallas), decímelo y lo hago **después de que me confirmes en qué archivo**.

---

## Paso 1 · Crear el archivo

1. <https://www.figma.com> → **New design file** → nombre: `ANDÁ — Sistema de diseño`.
2. Páginas sugeridas: `Marca`, `Colores y tipografías`, `Iconos`, `Componentes`, `Persona`, `Comercio`, `CEO-Equipo`.

## Paso 2 · Marca

1. En la página `Marca`, arrastrá los archivos de `01_Marca/` del paquete visual (`ANDA_Paquete_Visual_Etapa_8.zip`).
2. Respetá la guía: logo **blanco sobre negro** (principal) o **negro sobre blanco** (invertido). Sin sombras, degradados ni colores nuevos; sin estirar. La **ardilla sola** se usa como ícono cuando el nombre ya está visible.

## Paso 3 · Colores y tipografías (tokens)

Los valores están en `tokens/design-tokens.json` del paquete (los mismos que usa la app en `web/src/ui/styles.css`).

### Opción A · A mano (10 minutos)

En Figma → panel derecho → **Variables** (icono de variables) → creá una colección `Color` con dos modos: **Claro** y **Oscuro**, y cargá estos valores:

| Variable | Claro | Oscuro |
|---|---|---|
| `fondo` | `#F2F6F9` | `#0A1620` |
| `superficie` | `#FFFFFF` | `#12212D` |
| `superficie-2` | `#E8EFF4` | `#1A2D3C` |
| `texto` | `#0F2A43` | `#E7EFF6` |
| `texto-secundario` | `#566B7F` | `#9BB0C2` |
| `borde` | `#D5E0E8` | `#27394A` |
| `acento` | `#1C6FB3` | `#6DB6EE` |
| `acento-texto` | `#FFFFFF` | `#06223A` |
| `acento-suave` | `#DCEBF7` | `#16344B` |
| `sol` (destacado) | `#F6B40E` | `#F6C23E` |
| `sol-texto` | `#3A2A00` | `#302300` |
| `sol-suave` | `#FFF1C7` | `#463817` |
| `ok` / `ok-suave` | `#16794C` / `#DDF3E8` | `#5FD39B` / `#14392E` |
| `aviso` / `aviso-suave` | `#8A5700` / `#FFF0CC` | `#F2BE5C` / `#3E321C` |
| `error` / `error-suave` | `#B3261E` / `#FBE3E1` | `#FF8B82` / `#442321` |

### Opción B · Importar el JSON

Con el plugin gratuito **Tokens Studio for Figma** (buscalo en *Plugins* de Figma): *Settings → Import → JSON* y elegí `design-tokens.json`; luego *Create variables*. (Su interfaz cambia con las versiones; si no coincide con estos pasos, usá la opción A.)

### Tipografías (gratis, licencia SIL OFL)

| Uso | Fuente | Dónde |
|---|---|---|
| Títulos | **Bricolage Grotesque** (700–800) | Google Fonts |
| Texto | **Figtree** (400–700) | Google Fonts |
| Códigos y cifras | **IBM Plex Mono** | Google Fonts |

Tamaños de la app: H1 28 px / H2 22 px / H3 18 px / texto 16 px / chico 14 px / mínimo 12 px.

### Forma y espacio
- Radios: campos 9 px · tarjetas 14 px · ventanas 20 px · botones y chips: píldora (999).
- Alto mínimo de botón: **44 px** (accesibilidad táctil).
- Sombra de tarjeta: `0 2 12 rgba(15,42,67,.07)`.

## Paso 4 · Iconos

Los 48 iconos están en `03_Iconografia/` (SVG, trazo de 2 px, 24×24). Arrastralos a Figma y convertí cada uno en componente. Los de la app se pintan con `currentColor`, así que heredan el color del texto.

## Paso 5 · Pantallas

Marcos recomendados: **móvil 390 × 844** (Persona y Comercio) y **escritorio 1280 × 800** (CEO / Equipo).

En `05_Pantallas/` del paquete hay capturas **reales** de la app (claro y oscuro) para usar de referencia. Para rearmarlas en Figma, tomá los componentes de la app como guía: botones (`primario`, `sol`, `fantasma`, `suave`, `peligro`), tarjetas (`clara`, `noche`, `sol`), etiquetas, pestañas inferiores, tabla, ventana modal, código grande.

## Del diseño al código

Si en Figma cambiás un color o un radio, el cambio **se hace en `web/src/ui/styles.css`** (bloque `:root` al comienzo) y se vuelve a publicar. Un solo lugar, sin copiar y pegar por toda la app.
