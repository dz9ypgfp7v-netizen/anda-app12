# 1 · Supabase (base de datos, login, fotos y funciones del servidor)

Tiempo estimado: 40–60 minutos la primera vez.

> **Qué es:** Supabase guarda todo (personas, desafíos, PASOS, cupones), maneja el login y las fotos. La app **nunca** toca las tablas directamente: todo pasa por funciones seguras de la base (RPC). Las tablas tienen RLS activado y sin permisos de acceso directo.

---

## Paso 1 · Crear el proyecto

1. Entrá a <https://supabase.com> → **Sign in** → creá tu cuenta (con GitHub o email).
2. **New project**. Elegí tu organización.
3. Completá:
   - **Name:** `anda`
   - **Database password:** generá una larga y **guardala en un gestor de contraseñas** (no se puede recuperar, solo cambiar).
   - **Region:** la más cercana a tu público. Para Argentina, **South America (São Paulo)**.
4. **Create new project** y esperá 1–2 minutos.

**Comprobá:** ves el panel del proyecto con el menú lateral (Table Editor, SQL Editor, Authentication…).

## Paso 2 · Copiar las 3 claves que necesita la app

En el panel: **Project Settings** (engranaje) → **API** (o **API Keys**).

| Dato | Dónde se usa | ¿Es secreto? |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | `VITE_SUPABASE_URL` en Vercel | No |
| **anon / publishable key** | `VITE_SUPABASE_ANON_KEY` en Vercel | No (es pública por diseño; la seguridad está en la base) |
| **service_role / secret key** | **Nunca** en la app ni en Vercel | **SÍ. No la pegues en ningún lado.** Las funciones del servidor la reciben solas. |

## Paso 3 · Crear las tablas y funciones (migraciones)

Las migraciones están en `supabase/migrations/` y **se corren en orden, una sola vez**:

| Archivo | Qué hace |
|---|---|
| `0001_tablas.sql` | Tablas, restricciones, RLS |
| `0002_ayudas_privadas.sql` | Funciones internas (esquema `private`, no accesible desde la API) |
| `0003_funciones_persona.sql` | Todo lo que puede hacer una persona |
| `0004_funciones_comercio.sql` | Todo lo que puede hacer un comercio |
| `0005_funciones_admin.sql` | Todo lo que puede hacer el CEO / Equipo |
| `0006_seguridad.sql` | Cierra el acceso directo a tablas y limita quién puede llamar a cada función |
| `0007_storage_fotos.sql` | Bucket de fotos y sus permisos |

### Opción A · Pegar en el editor SQL (la más simple)

1. En Supabase: **SQL Editor** → **New query**.
2. Abrí `0001_tablas.sql` en tu computadora, copiá **todo**, pegalo y tocá **Run**.
3. Repetí con 0002, 0003… hasta 0007, **en ese orden**, cada uno en una consulta nueva.
4. Cada una debe terminar con **Success. No rows returned**. Si alguna da error, **frená**: no sigas con la siguiente (ver "Si algo falla" abajo).

### Opción B · Con la línea de comandos (Supabase CLI)

```bash
# 1) instalar el CLI (necesita Node 20+)
npm install -g supabase
# 2) iniciar sesión (abre el navegador)
supabase login
# 3) enlazar con tu proyecto (el "ref" es la parte xxxx de https://xxxx.supabase.co)
cd anda-app
supabase link --project-ref TU_REF
# 4) aplicar las migraciones en orden
supabase db push
```

Si el CLI se queja de `supabase/config.toml`, borrá ese archivo y corré `supabase init` (no toca tus migraciones ni funciones).
Si el CLI avisa que *saltea* algún archivo por su nombre, usá la opción A (pegar en el editor SQL): el resultado es el mismo.

> ⚠️ **NO ejecutes** `supabase/seed.sql` ni `supabase/demo/*.sql` en tu proyecto real: son datos y usuarios de **demostración**. En producción la base empieza vacía.

**Comprobá:** en **Table Editor** aparecen tablas como `profiles`, `challenges`, `rewards`, `coupons`, `pasos_ledger`, `audit_log`. Si abrís una, dice **RLS enabled**.

## Paso 4 · Configurar el login (Authentication)

Menú: **Authentication** → **URL Configuration**:

- **Site URL:** la dirección final de tu app (por ahora, la de Vercel, ej. `https://anda.vercel.app`; la cambiás cuando tengas tu dominio).
- **Redirect URLs:** agregá la misma dirección y también `http://localhost:5173` (para desarrollo).

Menú: **Authentication** → **Sign In / Providers**:

### 4.1 · Google (para Personas)

1. Entrá a <https://console.cloud.google.com> → creá un proyecto `anda`.
2. **APIs & Services → OAuth consent screen**: tipo **External**, nombre de la app `ANDÁ`, tu mail de soporte. Agregá tu dominio cuando lo tengas.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → tipo **Web application**.
4. En **Authorized redirect URIs** pegá la dirección que te muestra Supabase en *Providers → Google* (termina en `/auth/v1/callback`).
5. Copiá **Client ID** y **Client secret** y pegalos en Supabase (*Providers → Google*), activá **Enable** y **Save**.

### 4.2 · Apple (para Personas, requerido si publicás en App Store con login social)

Requiere cuenta **Apple Developer** (paga). Pasos en <https://supabase.com/docs/guides/auth/social-login/auth-apple>: crear un **Services ID**, una **Key** de "Sign in with Apple" y completar los datos en *Providers → Apple*. Es el paso más largo; podés dejar Google primero y sumar Apple después.

### 4.3 · Email (lo usan Comercios y Equipo, de forma invisible)

Las cuentas de comercio y equipo entran con **teléfono + contraseña**. Por dentro, Supabase las guarda con un correo "sintético" (`p5491155551234@cuentas.anda.app`). Por eso:

- Dejá **Email** habilitado en *Providers*.
- Las cuentas las crea la función del servidor `admin-create-account` ya confirmadas: no necesitan mail real ni verificación.

### 4.4 · Segundo factor (MFA) para el CEO y el Equipo

**Authentication → Sign In / Providers → Multi-Factor** (o *Settings → MFA*): activá **TOTP** (app autenticadora). La app ya trae la pantalla para registrar el código QR. Para **exigirlo**, ver `04_Pasar_a_produccion.md`.

## Paso 5 · Crear la primera cuenta CEO

El CEO no se crea desde la app (por seguridad). Se asigna **una sola vez desde el editor SQL**:

1. Abrí tu app (ver `02_Vercel.md`) → **Persona** → **Continuar con Google** con **tu cuenta de Google**. (Así se crea tu usuario en Supabase.)
2. En Supabase → **SQL Editor** → ejecutá, con tu mail real:

```sql
select private.bootstrap_ceo('tu_mail@gmail.com', 'Tu nombre');
```

3. Debe responder: `Listo: tu_mail@gmail.com ahora es CEO.`
4. En la app, **Cambiar perfil** → **CEO / Equipo** → entrás con la misma cuenta de Google.

> Nota: esa misma cuenta de Google tendrá a la vez acceso de Persona y de CEO. La app lo permite con perfiles separados (elegís con cuál entrar). Si preferís mantenerlos totalmente separados, usá una cuenta de Google distinta para la persona de prueba.

## Paso 6 · Fotos (Storage)

La migración `0007` ya creó el bucket público **`fotos`** (máx. 1 MB por imagen; solo PNG, JPG o WebP) y sus permisos: subir o borrar solo puede quien tenga el permiso `fotos.gestionar`.

**Comprobá:** **Storage** muestra el bucket `fotos`. La app reduce y convierte las fotos a WebP antes de subirlas.

## Paso 7 · Funciones del servidor (Edge Functions)

Son 3 funciones, en `supabase/functions/`:

| Función | Para qué | Quién puede |
|---|---|---|
| `admin-create-account` | Crear una cuenta de comercio o equipo con contraseña temporal | Solo el CEO |
| `admin-reset-password` | Restablecer la contraseña de una cuenta de comercio/equipo | Solo el CEO |
| `delete-account` | Borrar el usuario de acceso de una persona que ya eliminó sus datos | La propia persona |

Por qué existen: crear usuarios y cambiar contraseñas exige la clave secreta (`service_role`), que **no puede estar en el navegador**. Cada función primero comprueba quién llama, y recién después usa la clave.

Desplegar (con el CLI del Paso 3, opción B):

```bash
cd anda-app
supabase functions deploy admin-create-account
supabase functions deploy admin-reset-password
supabase functions deploy delete-account
```

- Supabase les entrega solas `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. **No hay que cargar secretos a mano.**
- Opcional (recomendado cuando tengas dominio): limitar quién puede llamarlas desde un navegador:

```bash
supabase secrets set ALLOWED_ORIGIN=https://tu-dominio.com
```

**Comprobá:** **Edge Functions** en el panel muestra las 3 funciones como *Active*. Después, entrando como CEO → **Equipo → Nueva cuenta**, crear un comercio de prueba debe mostrar la contraseña temporal **una sola vez**.

> ℹ️ La lógica de estas funciones está probada acá contra la base real (19 pruebas). El despliegue en sí **no lo pude probar** desde mi entorno (no llega a tu Supabase): por eso el "Comprobá" de arriba es importante.

## Paso 8 · Datos iniciales reales

Con el CEO adentro, desde el panel (no desde SQL):

1. **Comercios** → crear los comercios reales (nombre, rubro, barrio, local con dirección y coordenadas).
2. **Equipo / cuentas** → crear una cuenta de comercio para cada uno.
3. **Premios** → cargar el catálogo (con stock y vigencia).
4. **Desafíos** → crear, enviar a revisión, aprobar y activar.
5. **Imagen y fotos** → logo, banner y fotos.

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Error al correr una migración | Se saltó una anterior o se corrió dos veces | Mirá el mensaje. Si es proyecto nuevo y vacío, lo más simple es borrar el proyecto y recrearlo; no corras migraciones a medias. |
| "No existe ese usuario" en `bootstrap_ceo` | Todavía no entraste con Google | Hacé el login primero y repetí. |
| El login con Google vuelve con error | La *redirect URI* de Google no coincide | Copiala exacta desde Supabase (*Providers → Google*). |
| "Falta configurar VITE_SUPABASE_URL…" | Faltan las variables en Vercel | Ver `02_Vercel.md`, parte 2. |
| Crear cuenta de comercio da error | Función no desplegada o no sos CEO / MFA exigido sin segundo factor | Revisá *Edge Functions → Logs*. |
