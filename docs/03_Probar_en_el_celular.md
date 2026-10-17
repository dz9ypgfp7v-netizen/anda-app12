# 3 · Probar ANDÁ (computadora y celular)

## Parte A · Probar la demo en tu computadora (sin cuentas, sin internet después de instalar)

Necesitás **Node 20 o más nuevo** (<https://nodejs.org>, versión LTS).

```bash
cd anda-app/web
npm install                          # una sola vez
VITE_APP_MODE=demo npm run dev       # abre http://localhost:5173
```

En Windows (PowerShell):

```powershell
cd anda-app\web
npm install
$env:VITE_APP_MODE="demo"; npm run dev
```

Para ver la versión "como la del celular" (instalable, ya compilada):

```bash
VITE_APP_MODE=demo npm run build
npm run preview                      # abre http://localhost:4173
```

### Recorrido sugerido (15 minutos)

**Persona**
1. *Persona → Sofía* (4.000 PASOS de prueba).
2. **Desafíos →** "Un café en la esquina" → **Modo prueba: traer el código** → **Validar visita**.
3. **Premios →** "Café con medialuna" → **Canjear**. Te da un cupón `XXXX-XXXX`. Anotalo.
4. **Persona nueva** (desde "Cambiar perfil"): probá el alta. Con una fecha de nacimiento de menor de 18 el botón **Empezar** queda bloqueado. No se pide DNI.
5. **Desafío con cupo:** pedile al CEO (paso siguiente) que cree uno con "Cupo total" = 1. Con Sofía lo ves con "Cupo limitado · quedan 1"; al **Aceptar desafío** te guardan el lugar y, para otra persona, el desafío desaparece.

**Comercio**
6. *Comercio → Café de la Esquina*: **Código** (cambia solo cada ~45 s), **Cupones** → pegá el cupón → **Entregar premio**. Probá usarlo de nuevo: dice que ya fue utilizado.
7. **Campañas → Proponer campaña** (queda pendiente de aprobación del CEO).

**CEO / Equipo**
8. *CEO / Equipo → CEO*: recorré el panel. En **Propuestas** aprobá la campaña. En **Desafíos** creá uno nuevo y llevalo por *Borrador → En revisión → Programado → Activo*.
9. **Control:** probá **Pausar ANDÁ** (se frenan sumas y canjes) y **Verificar ahora** (comprueba saldos y auditoría).
10. *Equipo · Gestor*: ve solo lo que su permiso permite (no ve Equipo, Control, Cobros ni Configuración).

**Modo oscuro / claro:** botón **Tema** (o sigue el del dispositivo).
**Volver a empezar:** barra amarilla → **Reiniciar demo**.

---

## Parte B · Instalar en el celular (PWA)

Una PWA es una web que se instala como si fuera una app: ícono en la pantalla de inicio y pantalla completa. **Necesita una dirección `https://`** (por ejemplo, la de Vercel, ver `02_Vercel.md`).

### iPhone (Safari)
1. Abrí la dirección en **Safari** (no en Chrome).
2. Tocá **Compartir** (cuadrado con flecha hacia arriba).
3. **Agregar a inicio** → **Agregar**.
4. Abrila desde el ícono de ANDÁ.

### Android (Chrome)
1. Abrí la dirección en **Chrome**.
2. Menú **⋮** → **Instalar app** (o **Agregar a la pantalla principal**).
3. Abrila desde el ícono.

**Comprobá:** abre sin barra de direcciones, con el ícono de la ardilla, y funciona en modo oscuro si el teléfono está en oscuro.

### Qué NO hace la PWA (queda para la versión nativa)
- **No lee los pasos reales** del teléfono (Apple Salud / Health Connect). Hoy los pasos solo se muestran en modo prueba.
- **No usa GPS ni escanea QR** para validar visitas: valida con el **código de 6 dígitos** que muestra el comercio.
- **No manda notificaciones push.**

Ver `06_Tiendas_y_Flutter.md`.

---

## Parte C · Probar desde el celular **mientras desarrollás** (misma red Wi-Fi)

```bash
cd anda-app/web
VITE_APP_MODE=demo npm run dev -- --host
```

La consola muestra una dirección tipo `http://192.168.1.20:5173`. Abrila en el navegador del celular (conectado al mismo Wi-Fi). Para **instalarla** hace falta `https`, así que para eso usá Vercel.

---

## Pruebas automáticas (para quien desarrolla)

```bash
# Base de datos y funciones del servidor (requiere PostgreSQL 16 local)
scripts/pg-test.sh start
scripts/test-db.sh               # 180 pruebas

# Navegador real (Chromium), contra la demo compilada y servida en :4173
cd web
npx playwright install chromium  # una sola vez
node tests/e2e/smoke.mjs         # recorrido Persona → Comercio → CEO (22 comprobaciones)
node tests/e2e/flows.mjs         # alta 18+, ciclo de desafíos, cupos, pausa, cuentas (21 comprobaciones)
SCHEME=dark node tests/e2e/smoke.mjs   # lo mismo en modo oscuro
```
