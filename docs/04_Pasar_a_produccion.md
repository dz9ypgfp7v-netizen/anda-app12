# 4 · Pasar a producción (checklist)

Hacelo **en este orden** y tildá cada punto. Todo lo que dice "SQL" se ejecuta en Supabase → **SQL Editor**.

## A · Antes de abrir al público

- [ ] **Supabase en un plan pago** (copias de seguridad diarias; el plan gratis pausa proyectos sin uso). Verificá en <https://supabase.com/pricing>.
- [ ] **Vercel en un plan que permita uso comercial.** Verificá en <https://vercel.com/pricing>.
- [ ] **Dominio propio** conectado (ver `02_Vercel.md`) y *Site URL* / *Redirect URLs* de Supabase actualizadas.
- [ ] Login con **Google** funcionando (y **Apple** si vas a publicar en App Store).
- [ ] **Cuenta CEO** creada con `private.bootstrap_ceo(...)` y **segundo factor (TOTP)** configurado en esa cuenta.
- [ ] Las 3 **funciones del servidor** desplegadas y probadas (crear una cuenta de comercio de prueba y borrarla desde el panel).
- [ ] **Comercios, locales, premios y desafíos reales** cargados desde el panel. Ningún dato de ejemplo (`is_example`).
- [ ] **Textos legales revisados por un abogado.** Los Términos, la Privacidad y la declaración de mayor de 18 que trae la app son un **borrador** (`v0.1-borrador`). No los publiques tal cual. Cuando tengas la versión final, cambiá `terms_version` y `privacy_version` en **Configuración**: la app le pide a cada persona que acepte la nueva versión.
- [ ] Revisar con tu contador/abogado: el **cobro mensual a comercios** (en ANDÁ es un **control interno**: pendiente → facturado → pagado; **no emite facturas fiscales**), las **promociones/cupones** y el tratamiento de **datos personales** (Ley 25.326 de Protección de Datos Personales y, si corresponde, el registro de la base ante la autoridad).

## B · Pasar el sistema de "prueba" a "producción"

SQL (una sola vez):

```sql
select private.set_environment('produccion');
```

Esto **apaga el modo prueba para siempre** (los botones +500 / +2.000 / +5.000 PASOS y "traer el código del comercio" dejan de funcionar) y deja constancia en la auditoría.

Después, en el panel del CEO → **Configuración**, confirmá:

- [ ] **Exigir segundo factor (TOTP)** = activado. *Antes de activarlo, cada cuenta de Equipo y de Comercio debe poder configurarlo; si no, quedan afuera.*
- [ ] **Exigir comercio activo para validar visitas** = activado (viene así por defecto).
- [ ] **Tope diario de visitas por persona**, **duración del código**, **horas para completar un desafío con cupo**, etc. con los valores que decidas.
- [ ] **Vencimiento de cupones:** por defecto, un cupón vencido **no** devuelve los PASOS. Si querés que los devuelva, es una decisión de negocio: cambiala a propósito.

## C · Probar con gente real antes del lanzamiento

- [ ] 3–5 personas reales en iPhone y Android instalan la PWA y recorren: alta → visita → canje.
- [ ] 1–2 comercios reales: muestran el código, entregan un cupón.
- [ ] Un **ensayo de la pausa de emergencia** (Control → Pausar ANDÁ → Reactivar con la lista de control).
- [ ] **Control → Verificar ahora** da "Todo en orden".
- [ ] Mirar **Auditoría** y **Alertas** después de las pruebas.

## D · Limitaciones conocidas de la Etapa 1 (web) — decidí con esto en mano

| Tema | Qué pasa hoy | Qué recomiendo |
|---|---|---|
| **Pasos reales** | La web no puede leer los pasos del teléfono. En producción, los desafíos de **meta de pasos** no se pueden cumplir. | No actives desafíos de "meta de pasos" hasta la versión nativa (Apple Salud / Health Connect). Los de **visita a comercio** funcionan completos. |
| **Validación de visita** | Solo por código de 6 dígitos (rota cada ~45 s, con tolerancia y tope de usos). Sin GPS ni QR. | Suficiente para empezar. GPS y QR llegan con la versión nativa. |
| **Verificación por SMS / WhatsApp** | **No está implementada.** Comercio y Equipo entran con contraseña dada por el CEO. | No lo prometas. Es un objetivo posterior. |
| **Pagos / facturación fiscal** | **No hay pagos ni facturas fiscales.** Los PASOS no tienen valor en dinero. | Mantené el cobro a comercios fuera de la app. |
| **Notificaciones push** | No hay. | Versión nativa. |
| **Mapa de comercios** | Es una lista con enlace "Cómo llegar". | Mapa interactivo en la versión nativa. |
| **Texto legal** | Borrador. | Revisión legal (punto A). |

## E · Operación diaria

- **Pausa de emergencia:** *Control → Pausar ANDÁ*. Frena sumas, validaciones y canjes al instante. Para reactivar hay que completar una lista de control.
- **Alertas:** *Control → Alertas*. Tomalas, cerralas o confirmalas siempre con una nota.
- **Auditoría:** cada acción sensible queda registrada con una cadena de verificación; *Verificar ahora* detecta si algo fue alterado.
- **Ajustes manuales de PASOS** y **anulación de visitas/cupones**: requieren motivo y quedan auditados; los movimientos nunca se borran, se compensan con otro movimiento.
- **Eliminación de cuenta:** la persona puede borrar sus datos desde **Yo**; los movimientos se conservan anonimizados por trazabilidad.
