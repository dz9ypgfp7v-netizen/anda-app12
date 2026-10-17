# 7 · Qué está probado y qué no (la verdad, sin maquillaje)

## ✅ Probado de verdad

**Base de datos y reglas — 180 pruebas automáticas, contra PostgreSQL real**
- Seguridad: las tablas no se pueden tocar directo; cada función exige la sesión y el rol correctos; una persona no ve datos de otra; un comercio ve solo datos agregados de su local; el Equipo solo hace lo que su permiso permite.
- PASOS: libro de movimientos que solo se agrega (nunca se edita ni se borra; los errores se corrigen con un movimiento compensatorio), saldo coherente con los movimientos, reclamos idempotentes (tocar dos veces no suma dos veces).
- Visitas: código de 6 dígitos que rota, tolerancia, tope de usos por código, tope diario por persona, bloqueo por intentos fallidos, comercio suspendido.
- Cupos: aceptar un desafío con cupo reserva un lugar con vencimiento; se pueden soltar; cuando se ocupan todos, el desafío desaparece para quien no lo aceptó; 8 personas aceptando a la vez no pasan el cupo.
- Cupones: código único, un solo uso, válido solo en su comercio; canje con stock bajo concurrencia.
- Desafíos: estados borrador → revisión → programado → activo → pausado → finalizado; separación de funciones (quien propone no aprueba); desafíos vigentes no admiten cambios sustanciales.
- Cobros a comercios: tarifa histórica por visita; estados pendiente → facturado → pagado.
- Auditoría con cadena de verificación; verificación de integridad de saldos.
- Funciones del servidor (crear cuenta, restablecer clave, borrar cuenta): 19 pruebas de su lógica contra la base real (solo el CEO, rollback si falla, no se puede tocar al CEO, no se borran cuentas con rol).

**App — probada en un navegador real (Chromium), en modo claro y oscuro**
- Recorrido Persona → Comercio → CEO/Equipo (22 comprobaciones) y flujos de escritura (21 comprobaciones): alta con control 18+ y sin DNI, visita → PASOS → canje, entrega del cupón y su rechazo al reusarlo, propuestas de comercio y su aprobación, ciclo completo de un desafío, cupos con aceptación, pausa de emergencia con lista de control, alta de cuenta, verificación de integridad, permisos del Equipo.
- Sin errores en la consola del navegador durante esos recorridos.
- La versión "real" (Supabase) **compila** y no incluye el motor de la demo.

## ⚠️ Escrito pero NO ejecutado desde mi entorno

Mi entorno no llega a tus cuentas (Supabase, Vercel, Google, Apple, tiendas), así que estas partes están **escritas y explicadas paso a paso, pero no las vi funcionando**:

| Parte | Qué hay | Cómo comprobarla vos |
|---|---|---|
| Conexión real a Supabase desde la web | Código escrito (`web/src/data/supa.ts`), compila | Guía 01 y 02, "Comprobá" |
| Login con Google / Apple | Botones y flujo (PKCE) | Entrar con tu cuenta |
| Segundo factor (TOTP) | Pantalla de alta y de verificación | Activarlo en tu cuenta CEO |
| Fotos en Supabase Storage | Permisos en la migración 0007; subida desde la app | Subir una foto en *Imagen y fotos* |
| Funciones del servidor desplegadas | Código + lógica probada | `supabase functions deploy` y crear una cuenta |
| Instalación como PWA en celulares reales | Manifiesto, íconos y service worker generados | Guía 03, parte B |
| Migraciones en un Supabase real | Probadas en PostgreSQL 16 local, con una capa que imita a Supabase | Correrlas en tu proyecto vacío |

Probé las migraciones en PostgreSQL con una capa de compatibilidad (`supabase/demo/supabase_shim.sql`). Supabase es PostgreSQL, pero puede haber diferencias menores; por eso la guía pide correrlas en un proyecto **nuevo y vacío** y frenar ante el primer error.

## ❌ No implementado (y no lo simulé)

- **SMS / WhatsApp** para verificar teléfonos.
- **Pagos** y **facturación fiscal**. El cobro a comercios es un control interno.
- **Pasos reales** (Apple Salud / Health Connect), **GPS**, **QR**, **notificaciones push**: son de la Etapa 2.
- **Segmentación de desafíos**: un desafío puede tener cupo ("los primeros N que lo acepten"), pero **no se puede asignar a personas o grupos concretos**.
- **Mapa interactivo:** hoy es una lista con "Cómo llegar".

## 🧩 Decisiones que quedaron abiertas

1. **Eslogan:** el brand book dice **"Movete a tu manera."** y la Etapa 9 mencionaba "Más pasos. Más oportunidades." La app usa el del brand book. Decidí cuál queda.
2. **Cupón vencido:** por defecto no devuelve los PASOS. Es una decisión de negocio.
3. **Textos legales:** son borrador (`v0.1-borrador`) hasta la revisión de un abogado.
4. **Demo en modo real:** en la demo no hay contraseñas ni OAuth reales y siempre se actúa con "segundo factor cumplido".
