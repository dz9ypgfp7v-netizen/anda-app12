# 2 · Vercel (publicar la web)

Vercel publica la carpeta `web/` y te da una dirección `https://….vercel.app` (y después tu dominio propio). Cada vez que subís cambios, se vuelve a publicar solo.

Necesitás: una cuenta en <https://vercel.com> (podés entrar con GitHub) y **Node 20+** en tu computadora si vas a usar la línea de comandos.

> 💡 **Plan:** el plan gratis (Hobby) de Vercel es para uso **no comercial**. Para probar y mostrar la demo alcanza. Para publicar ANDÁ como negocio (le cobrás a comercios), corresponde un plan pago. Confirmalo en <https://vercel.com/pricing>.

---

## Parte 1 · Publicar la DEMO (sin Supabase, sin claves)

Es lo más rápido para verla en tu celular. Todo corre en el navegador de cada persona.

### Camino A · Con GitHub (recomendado: se actualiza solo)

1. Creá un repositorio **privado** en <https://github.com/new> (nombre: `anda-app`).
2. En tu computadora, dentro de la carpeta `anda-app`:

```bash
git init
git add .
git commit -m "ANDÁ primera versión"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/anda-app.git
git push -u origin main
```

3. En Vercel: **Add New… → Project** → importá `anda-app`.
4. Configurá:
   - **Root Directory:** `web`  ← importante
   - **Framework Preset:** Vite (lo detecta solo)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Environment Variables:** `VITE_APP_MODE` = `demo`
5. **Deploy**. Tarda 1–3 minutos.

### Camino B · Sin GitHub (línea de comandos)

```bash
npm install -g vercel
cd anda-app/web
vercel login
vercel            # responde las preguntas: proyecto nuevo, carpeta actual, build por defecto
vercel env add VITE_APP_MODE production     # escribí: demo
vercel --prod
```

**Comprobá:**
- Abrís la dirección y ves **"¿Cómo querés entrar?"** con la barra amarilla **MODO DEMO**.
- Entrás como **Persona → Sofía**, vas a **Desafíos**, abrís el del café, tocás **"Modo prueba: traer el código del comercio"** → **Validar visita** → "¡Sumaste PASOS!".

La primera vez que se abre la demo descarga el motor de base de datos (unos 16 MB); después queda guardado en el dispositivo.

---

## Parte 2 · Publicar la versión REAL (con Supabase)

Antes: tenés que haber hecho `01_Supabase.md` hasta el Paso 5 (migraciones, login y CEO).

1. En Vercel → tu proyecto → **Settings → Environment Variables**. Cargá (para **Production**, y si querés también Preview):

| Variable | Valor |
|---|---|
| `VITE_APP_MODE` | `supabase` |
| `VITE_SUPABASE_URL` | tu *Project URL* (`https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | tu *anon / publishable key* |

   ⚠️ **No cargues nunca la clave `service_role`.**

2. **Deployments → ⋯ → Redeploy** (las variables solo se aplican en un deploy nuevo).
3. Copiá la dirección final y pegala en Supabase → **Authentication → URL Configuration** (*Site URL* y *Redirect URLs*).

**Comprobá:**
- Ya **no** aparece la barra amarilla de demo.
- **Persona → Continuar con Google** te lleva a Google y vuelve a ANDÁ.
- Si falta una variable, la app lo dice en pantalla: *"Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY"*.
- La versión real **no incluye** el motor de la demo (la web pesa ~1,4 MB en vez de ~18 MB).

## Dominio propio (opcional, cuando quieras)

1. Comprás el dominio (por ejemplo, en NIC Argentina para `.com.ar`).
2. Vercel → **Settings → Domains → Add** → sigue las instrucciones de DNS que te muestra.
3. Actualizá *Site URL* / *Redirect URLs* en Supabase, el redirect de Google y (si lo usaste) `ALLOWED_ORIGIN` de las funciones.

## Qué ya trae la web para publicarla bien

- `web/vercel.json`: redirige todas las rutas a la app y agrega encabezados de seguridad (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`).
- `Permissions-Policy` bloquea hoy cámara, micrófono y ubicación (la etapa 1 no los usa). Cuando se sume GPS/QR en la versión nativa, se ajusta.
- La app es una **PWA**: se instala en la pantalla de inicio y abre sin barra del navegador (ver `03_Probar_en_el_celular.md`).

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| El build falla en Vercel | Entrá al deploy → **Build Logs**. Lo más común: *Root Directory* no está en `web`. |
| Pantalla en blanco | Abrí la consola del navegador. Casi siempre falta una variable `VITE_…` → cargala y hacé *Redeploy*. |
| Al recargar una pantalla da 404 | Revisá que exista `web/vercel.json` y que el *Root Directory* sea `web`. |
| El login vuelve a "localhost" | La *Site URL* de Supabase sigue apuntando a localhost: cambiala a tu dirección de Vercel. |
