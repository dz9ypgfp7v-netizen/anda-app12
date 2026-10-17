# ANDÁ — Leeme primero

ANDÁ es **una sola app** con tres perfiles separados:

| Perfil | Quién es | Cómo entra |
|---|---|---|
| **Persona** | Quien camina, visita comercios y canjea premios | Apple o Google. Solo mayores de 18. No se pide DNI. |
| **Comercio** | Mostrador de un local | Teléfono + contraseña que le da el CEO (la cambia al primer ingreso) |
| **CEO / Equipo** | Quien aprueba y controla todo | CEO: cuenta propia + segundo factor. Equipo: teléfono + contraseña dada por el CEO, con permisos acotados |

Las personas **suman PASOS** visitando comercios (con un código de 6 dígitos que cambia solo) o cumpliendo desafíos (por ejemplo, una meta de pasos del día). Los PASOS **no tienen valor en dinero** y se canjean por cupones de un solo uso, válidos solo en el comercio que los ofrece.

---

## Qué hay en esta carpeta

```
anda-app/
├── docs/        ← estas guías (empezá por acá)
├── supabase/    ← la base de datos (migraciones 0001–0007) y las 3 funciones del servidor
├── web/         ← la app (React + Vite + TypeScript, instalable como PWA)
├── tests/       ← 180 pruebas automáticas de la base de datos y de las funciones del servidor
└── scripts/     ← ayudas para correr las pruebas
```

## Orden recomendado (de menos a más compromiso)

1. **Probar la demo ya mismo, sin crear ninguna cuenta** → `03_Probar_en_el_celular.md` (parte A).
2. **Publicar la demo en Vercel** (gratis) para verla desde el celular → `02_Vercel.md` (parte 1).
3. **Crear tu proyecto de Supabase** y correr la base → `01_Supabase.md`.
4. **Conectar la app a Supabase** y publicarla de verdad → `02_Vercel.md` (parte 2).
5. **Pasar a producción** (checklist) → `04_Pasar_a_produccion.md`.
6. **Figma** (diseño) → `05_Figma.md`.
7. **Tiendas de apps y versión nativa** → `06_Tiendas_y_Flutter.md`.

## Dos modos de la misma app

- **Modo demo** (`VITE_APP_MODE=demo`): la base de datos corre *dentro del navegador*. No hay servidor, ni cuentas reales, ni contraseñas reales. Los datos quedan solo en ese navegador. Sirve para probar y mostrar. Tiene un botón "Reiniciar demo" y una barra amarilla que avisa que es demo.
- **Modo real** (`VITE_APP_MODE=supabase`): usa tu proyecto de Supabase. Es el que se publica para el público.

## Costos (verificá los precios vigentes antes de contratar)

| Servicio | Para qué | Costo orientativo |
|---|---|---|
| Supabase | Base de datos, login, fotos, funciones | Plan gratis para probar. Para producción conviene un plan pago: el gratis pausa proyectos sin uso y no tiene copias de seguridad diarias. |
| Vercel | Publicar la web | El plan gratis (Hobby) es para uso **no comercial**; ANDÁ le cobra a comercios, así que para producción corresponde un plan pago. |
| Dominio propio | `anda.com.ar` o similar | Pago anual (NIC Argentina para `.com.ar`). |
| Apple Developer | App Store y "Iniciar sesión con Apple" | Pago anual (alrededor de USD 99). |
| Google Play | Play Store | Pago único (alrededor de USD 25). |
| Google Cloud | Credenciales de "Continuar con Google" | Gratis para este uso. |

Los precios cambian: confirmalos en cada sitio oficial. Este cuadro es una guía, no una cotización.

## Qué está probado y qué no

Leé `07_Que_esta_probado_y_que_no.md`. Resumen: la base, las reglas y la app están probadas de punta a punta **en modo demo**. Lo que depende de tus cuentas (login con Google/Apple, Supabase real, Vercel, tiendas) está explicado paso a paso pero **no se pudo ejecutar desde mi entorno**: lo vas a verificar vos al hacerlo, con los controles que dejo en cada guía.
