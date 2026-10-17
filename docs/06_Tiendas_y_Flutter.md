# 6 · Tiendas de apps y versión nativa (Etapa 2)

## Qué es esto y en qué punto estás

- **Etapa 1 (esto que tenés):** web instalable (PWA). Se publica en minutos, no pasa por las tiendas y funciona en iPhone y Android.
- **Etapa 2 (nativa):** una app para App Store y Google Play, con lo que la web **no puede** hacer: leer pasos reales, GPS, QR y notificaciones.

**La app nativa todavía no está construida.** Lo que sí está listo es el **servidor** que va a usar: la misma base de datos, el mismo login y las mismas funciones. No se rehace nada del lado del servidor.

## Qué trae la versión nativa

| Función | Cómo |
|---|---|
| Pasos reales | Apple Salud (HealthKit) en iPhone · Health Connect en Android. La app nativa le informaría al servidor los pasos del día. |
| Validar visita con GPS | Se suma a la validación por código: la persona tiene que estar cerca del local. (En Configuración ya existe el interruptor *Exigir ubicación*, hoy apagado porque la web no lo puede cumplir.) |
| Escanear QR del comercio | Cámara. |
| Notificaciones | Push (avisos de PASOS, cupones por vencer, desafíos nuevos). |
| Mapa interactivo | Mapa con los comercios cercanos. |

> ⚠️ **Falta del lado del servidor para los pasos reales:** hoy no existe la función que recibe los pasos medidos por el teléfono (solo existe la de modo prueba). Hay que **agregarla** (con tope diario y protección contra manipulación) cuando empiece la Etapa 2. Hasta entonces, los desafíos de "meta de pasos" no se pueden cumplir en producción.

## Camino recomendado

1. **Primero salí con la PWA** y aprendé qué usan las personas y los comercios.
2. Cuando la Etapa 1 esté estable, construí la app en **Flutter** (un solo código para iPhone y Android), conectada al mismo Supabase. Los pasos de abajo preparan las cuentas para ese momento.

## Cuentas de tienda (se pueden abrir desde ya; demoran)

### Apple (iPhone)
1. Necesitás una **Apple ID** con verificación en dos pasos y una Mac con **Xcode** para compilar y subir la app.
2. **Apple Developer Program:** <https://developer.apple.com/programs/> → *Enroll*. Es **anual** (alrededor de USD 99; verificá el valor vigente). Para cuenta de **organización** piden un número D-U-N-S y la aprobación puede tardar días.
3. Con la cuenta: *App Store Connect → Apps → +* → crear la ficha (nombre, idioma, categoría, política de privacidad con URL pública, capturas).
4. Si la app ofrece "Continuar con Google", **Apple exige** ofrecer también "Continuar con Apple" (ya está previsto en el login).
5. Prueba antes de publicar: **TestFlight** (hasta decenas de miles de testers por invitación).

### Google Play (Android)
1. **Google Play Console:** <https://play.google.com/console> → pago **único** (alrededor de USD 25; verificá).
2. Cuentas personales nuevas tienen requisitos de **prueba cerrada** antes de publicar (cantidad mínima de testers durante cierto tiempo); revisá las condiciones vigentes en la consola.
3. *Crear app* → ficha, **política de privacidad** (URL pública), formulario de **seguridad de los datos** y clasificación de contenido.
4. Prueba antes de publicar: **Prueba interna** / **Prueba cerrada**.

## Qué piden las tiendas (prepará esto con tiempo)

- **Política de privacidad** pública y consistente con lo que la app hace (revisada por un abogado).
- **Eliminación de cuenta dentro de la app:** ✅ ya existe (*Yo → Eliminar mi cuenta*) y también *Descargar mis datos*.
- **Solo mayores de 18:** ✅ ya existe la declaración y el control de edad; sin DNI.
- **Permisos justificados:** ubicación (para validar visitas), cámara (QR), actividad física/pasos, notificaciones. Cada uno con un texto claro de por qué se pide.
- **Cuenta de prueba para los revisores** de Apple y Google (con instrucciones). Para esto hay que armar un entorno con datos de ejemplo.
- Capturas e ícono: en el paquete visual están el ícono y las capturas reales de la PWA como punto de partida.

## Entre medio: "empaquetar" la PWA (opcional)

Existen herramientas que envuelven una web en una app de tienda (por ejemplo, Capacitor). Es una vía más rápida, pero las tiendas pueden rechazar apps que son solo una web envuelta sin funciones nativas, y la validación de pasos/GPS sigue necesitando código nativo. **No lo recomiendo como destino final**; sí puede servir para pruebas internas.

## Contrato del servidor para el equipo de Flutter

Todo se llama por RPC de Supabase con la sesión de la persona. Funciones principales de Persona: `my_context`, `register_profile`, `person_home`, `list_challenges`, `accept_challenge`, `cancel_acceptance`, `claim_visit`, `claim_step_goal`, `list_rewards`, `claim_reward`, `my_coupons`, `cancel_coupon`, `my_ledger`, `my_steps`, `export_my_data`, `delete_my_account`. Las respuestas de rechazo de negocio vienen como `{ ok: false, reason: '...' }`; los errores de acceso lanzan `PT401`/`PT403`. Los textos para cada `reason` están en `web/src/ui/reasons.ts`.
