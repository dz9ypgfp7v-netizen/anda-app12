// Prueba de humo de punta a punta en un navegador real (Chromium) contra la demo.
// Uso: (con la demo servida en BASE) node tests/e2e/smoke.mjs
// Recorre: Persona (visita → PASOS → canje) → Comercio (código y entrega del cupón) → CEO/Equipo (todas las secciones).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = process.env.SHOTS || 'shots';
const SCHEME = process.env.SCHEME || 'light';
mkdirSync(OUT, { recursive: true });

const results = [];
const problems = [];
const ok = (name, cond, extra = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'OK  ' : 'FALLA'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function session(kind) {
  const mobile = kind === 'mobile';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: mobile ? 2 : 1, colorScheme: SCHEME, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${kind}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${kind}] console.error: ${m.text()}`); });
  page.setDefaultTimeout(60000);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${SCHEME}-${name}.png` });
const text = (page, t, o = {}) => page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout: 60000, ...o });

// ---------------------------------------------------------------- Persona + Comercio (móvil)
{
  const { ctx, page } = await session('mobile');
  await page.goto(BASE + '/');
  await text(page, '¿Cómo querés entrar?');
  ok('Pantalla de perfiles visible', true);
  await shot(page, 'm-01-gate');

  await page.getByRole('button', { name: /Persona/ }).click();
  await text(page, 'Modo demo');
  await shot(page, 'm-02-login-persona');
  await page.getByRole('button', { name: /Sofía/ }).click();
  await text(page, 'Hola, Sofía');
  ok('Persona entra y ve su saldo', await page.getByText('4.000').first().isVisible());
  await shot(page, 'm-03-inicio');

  // Desafío de visita con código (modo prueba trae el código)
  await page.getByRole('button', { name: 'Desafíos' }).click();
  await text(page, 'Desafíos');
  const card = page.locator('.card.clickable', { hasText: 'Café de la Esquina' }).first();
  await card.waitFor();
  await shot(page, 'm-04-desafios');
  await card.click();
  await page.getByRole('button', { name: /traer el código/i }).click();
  await page.waitForFunction(() => document.querySelector('input.codeinput')?.value.length === 6);
  await shot(page, 'm-05-claim-codigo');
  await page.getByRole('button', { name: 'Validar visita' }).click();
  await text(page, '¡Sumaste PASOS!');
  ok('Visita validada y PASOS acreditados', true);
  await shot(page, 'm-06-sumaste');
  await page.getByRole('button', { name: 'Seguir' }).click();

  // Segundo intento el mismo día: el desafío ya no está disponible (según su regla)
  // Canje
  await page.getByRole('button', { name: 'Premios' }).first().click();
  await text(page, 'Café con medialuna');
  await shot(page, 'm-07-premios');
  await page.locator('.card.clickable', { hasText: 'Café con medialuna' }).first().click();
  await page.getByRole('button', { name: /Canjear por/ }).click();
  await text(page, '¡Canje listo!');
  const code = (await page.locator('.coupon .code').first().innerText()).trim();
  ok('Canje genera cupón XXXX-XXXX', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), code);
  await shot(page, 'm-08-cupon');
  await page.getByRole('button', { name: 'Listo' }).click();

  // Yo
  await page.getByRole('button', { name: 'Yo' }).click();
  await text(page, 'Historial de PASOS');
  await shot(page, 'm-09-yo');
  await page.getByRole('button', { name: /Historial de PASOS/ }).click();
  await text(page, 'Canje de premio');
  await shot(page, 'm-10-historial');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Cambiar perfil/ }).click();
  await text(page, '¿Cómo querés entrar?');

  // Comercio
  await page.getByRole('button', { name: /Comercio/ }).click();
  await page.getByRole('button', { name: /Café de la Esquina/ }).click();
  await text(page, 'Resumen');
  await shot(page, 'm-11-comercio-resumen');
  await page.getByRole('button', { name: 'Código' }).click();
  await page.locator('.bigcode').waitFor();
  const shown = (await page.locator('.bigcode').innerText()).replace(/\s/g, '');
  ok('Comercio muestra código de 6 dígitos', /^\d{6}$/.test(shown), shown);
  await shot(page, 'm-12-comercio-codigo');
  await page.getByRole('button', { name: 'Cupones' }).click();
  await page.getByLabel('Código del cupón').fill(code);
  await page.getByRole('button', { name: /Verificar cupón/ }).click();
  await text(page, 'Café con medialuna');
  await shot(page, 'm-13-comercio-cupon');
  await page.getByRole('button', { name: 'Entregar premio' }).click();
  await page.getByRole('button', { name: 'Sí, entregar' }).click();
  await page.locator('.banner.ok', { hasText: 'Entregado.' }).waitFor();
  ok('Comercio entrega el cupón', true);
  // Reintentar el mismo cupón → rechazado
  await page.getByLabel('Código del cupón').fill(code);
  await page.getByRole('button', { name: /Verificar cupón/ }).click();
  await text(page, 'ya fue utilizado');
  ok('Cupón de un solo uso: no se puede reutilizar', true);
  await shot(page, 'm-14-comercio-reuso');
  await page.getByRole('button', { name: 'Campañas' }).click();
  await text(page, 'Proponer campaña');
  await shot(page, 'm-15-comercio-campanias');
  await page.getByRole('button', { name: 'Cobros' }).click();
  await text(page, 'Cobros');
  await ctx.close();
}

// ---------------------------------------------------------------- CEO (escritorio)
{
  const { ctx, page } = await session('desktop');
  await page.goto(BASE + '/');
  await text(page, '¿Cómo querés entrar?');
  await shot(page, 'd-01-gate');
  await page.getByRole('button', { name: /CEO \/ Equipo/ }).click();
  await page.getByRole('button', { name: /^CEO/ }).first().click();
  await text(page, 'Personas registradas');
  ok('CEO ve el panel', true);
  await shot(page, 'd-02-panel');
  const sections = ['Desafíos', 'Propuestas', 'Premios', 'Comercios', 'Personas', 'Visitas y cupones', 'Cobros', 'Equipo', 'Control', 'Configuración', 'Auditoría', 'Imagen y fotos'];
  let i = 3;
  for (const s of sections) {
    await page.locator('.anav').getByRole('button', { name: new RegExp('^' + s) }).click();
    await page.locator('.amain h1').filter({ hasText: s === 'Imagen y fotos' ? 'Imagen' : s.split(' ')[0] }).first().waitFor();
    await page.waitForTimeout(500);
    await shot(page, `d-${String(i++).padStart(2, '0')}-${s.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    ok(`CEO abre ${s}`, true);
  }
  await page.locator('.anav').getByRole('button', { name: /^Desafíos/ }).click();
  await text(page, 'Nuevo desafío');
  await page.getByRole('button', { name: 'Nuevo desafío' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'd-20-desafio-form');
  await page.keyboard.press('Escape');
  await ctx.close();

  // Equipo con permisos acotados: el Gestor no ve Equipo/Control/Cobros
  const g = await session('desktop');
  await g.page.goto(BASE + '/');
  await text(g.page, '¿Cómo querés entrar?');
  await g.page.getByRole('button', { name: /CEO \/ Equipo/ }).click();
  await g.page.getByRole('button', { name: /Equipo · Gestor/ }).click();
  await g.page.locator('.anav').waitFor();
  const navItems = (await g.page.locator('.anav button').allInnerTexts()).map((t) => t.trim());
  const nav = navItems.join(' | ');
  ok('Gestor NO ve Equipo, Control, Cobros ni Configuración', !navItems.some((t) => /^(Equipo|Control|Cobros|Configuración)/.test(t)), nav);
  ok('Gestor ve Desafíos y Premios', navItems.some((t) => /^Desafíos/.test(t)) && navItems.some((t) => /^Premios/.test(t)));
  await shot(g.page, 'd-21-gestor');
  await g.ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
if (problems.length) { console.log('\nErrores de consola / página:'); [...new Set(problems)].forEach((p) => console.log(' -', p)); }
process.exit(failed.length || problems.length ? 1 : 0);
