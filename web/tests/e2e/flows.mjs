// Flujos de escritura y reglas en un navegador real contra la demo:
// alta de persona (18+), ciclo de vida de un desafío, propuesta de comercio → aprobación, pausa de emergencia, alta de cuenta.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = process.env.SHOTS || 'shots';
mkdirSync(OUT, { recursive: true });
const results = [];
const problems = [];
const ok = (name, cond, extra = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'OK  ' : 'FALLA'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function open(w = 1280, h = 800) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.setDefaultTimeout(60000);
  await page.goto(BASE + '/');
  await page.getByText('¿Cómo querés entrar?').first().waitFor();
  return { ctx, page };
}
const text = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ state: 'visible' });
const enter = async (page, perfil, cuenta) => {
  await page.getByRole('button', { name: perfil }).click();
  await page.getByRole('button', { name: cuenta }).first().click();
};
const leave = async (page) => { await page.evaluate(() => { location.hash = ''; }); };

// ---------- 1) Alta de persona: solo mayores de 18, sin DNI ----------
{
  const { ctx, page } = await open(390, 844);
  await page.getByRole('button', { name: /Persona/ }).click();
  await page.getByRole('button', { name: /Persona nueva/ }).first().click();
  await text(page, 'Creá tu perfil');
  ok('El alta NO pide DNI ni documento', !(await page.locator('body').innerText()).match(/dni|documento de identidad (número|n°)/i) || /No te pedimos documento/.test(await page.locator('body').innerText()));
  const labels = (await page.locator('label').allInnerTexts()).join(' | ');
  ok('Campos del alta: nombre, nacimiento y declaraciones', /Cómo te llamamos/.test(labels) && /Fecha de nacimiento/.test(labels) && !/DNI|CUIL|documento/i.test(labels), labels.replace(/\n/g, ' '));
  await page.getByLabel(/Cómo te llamamos/).fill('Lucía E2E');
  const hoy = new Date(); const menor = `${hoy.getFullYear() - 16}-06-15`;
  await page.getByLabel('Fecha de nacimiento').fill(menor);
  for (const c of await page.getByRole('checkbox').all()) await c.check();
  ok('Menor de 18: el botón "Empezar" queda bloqueado', await page.getByRole('button', { name: 'Empezar' }).isDisabled());
  await page.getByLabel('Fecha de nacimiento').fill('1992-05-10');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await text(page, 'Hola, Lucía E2E');
  ok('Persona mayor de 18 completa el alta y entra', true);
  await page.screenshot({ path: `${OUT}/flow-01-alta.png` });
  await ctx.close();
}

// ---------- 2) Desafío: borrador → revisión → aprobado → activo ; propuesta de comercio ----------
{
  const { ctx, page } = await open();
  // Comercio envía una propuesta
  await enter(page, /Comercio/, /Café de la Esquina/);
  await page.getByRole('button', { name: 'Campañas' }).click();
  await page.getByRole('button', { name: 'Proponer campaña' }).click();
  await page.getByLabel('Título').fill('Campaña E2E del café');
  await page.getByLabel('PASOS por visita').fill('250');
  await page.getByRole('button', { name: 'Enviar a ANDÁ' }).click();
  await text(page, 'Campaña E2E del café');
  ok('Comercio envía una propuesta de campaña', true);
  await page.getByRole('button', { name: 'Salir' }).click();
  await page.getByText('¿Cómo querés entrar?').first().waitFor();

  // CEO: aprueba la propuesta
  await enter(page, /CEO \/ Equipo/, /^CEO/);
  await page.locator('.anav').getByRole('button', { name: /^Propuestas/ }).click();
  const prop = page.locator('.card', { hasText: 'Campaña E2E del café' }).first();
  await prop.waitFor();
  await prop.getByRole('button', { name: 'Aprobar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aprobar' }).click();
  await text(page, 'Campaña aprobada');
  ok('CEO aprueba la propuesta: nace un desafío programado', true);

  // CEO: crea un desafío de meta de pasos y recorre el ciclo
  await page.locator('.anav').getByRole('button', { name: /^Desafíos/ }).click();
  await text(page, 'Campaña E2E del café');
  await page.getByRole('button', { name: 'Nuevo desafío' }).click();
  await page.getByLabel('Título').fill('Meta E2E 3000');
  await page.getByLabel('Tipo').selectOption('meta_pasos');
  await page.getByLabel(/Meta de pasos/).fill('3000');
  await page.getByLabel('PASOS que otorga').fill('120');
  await page.getByRole('button', { name: 'Guardar' }).click();
  const card = page.locator('.card', { hasText: 'Meta E2E 3000' }).first();
  await card.waitFor();
  ok('Se crea como Borrador', /Borrador/.test(await card.innerText()));
  const step = async (accion, estado, confirmLabel = accion) => {
    await page.locator('.card', { hasText: 'Meta E2E 3000' }).first().getByRole('button', { name: accion }).click();
    await page.getByRole('dialog').getByRole('button', { name: confirmLabel }).click();
    await page.locator('.card', { hasText: 'Meta E2E 3000' }).first().getByText(estado, { exact: true }).waitFor();
    ok(`Desafío pasa a ${estado}`, true);
  };
  await step('Enviar a revisión', 'En revisión');
  await step('Aprobar', 'Programado');
  await page.screenshot({ path: `${OUT}/flow-02-programado.png` });
  await step('Activar', 'Activo');
  // Un desafío vigente no admite cambiar la recompensa
  await page.locator('.card', { hasText: 'Meta E2E 3000' }).first().getByRole('button', { name: 'Editar' }).click();
  ok('Desafío vigente: los campos sustanciales quedan bloqueados', await page.getByLabel('PASOS que otorga').isDisabled());
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ---------- 3) Pausa de emergencia + alta de cuenta de comercio ----------
{
  const { ctx, page } = await open();
  await enter(page, /CEO \/ Equipo/, /^CEO/);
  await page.locator('.anav').getByRole('button', { name: /^Control/ }).click();
  await page.getByRole('button', { name: 'Pausar ANDÁ' }).click();
  await page.getByLabel('Motivo').fill('Prueba de pausa automatizada');
  await page.getByRole('dialog').getByRole('button', { name: 'Pausar ahora' }).click();
  await page.locator('.pausebar').waitFor();
  ok('La pausa general se activa y se ve el aviso', true);
  await page.screenshot({ path: `${OUT}/flow-03-pausa.png` });
  // Reactivar exige el checklist completo
  await page.getByRole('button', { name: /Reactivar/ }).first().click();
  ok('Reactivar sin checklist está bloqueado', await page.getByRole('dialog').getByRole('button', { name: 'Reactivar' }).isDisabled());
  for (const c of await page.getByRole('dialog').getByRole('checkbox').all()) await c.check();
  await page.getByRole('dialog').getByRole('button', { name: 'Reactivar' }).click();
  await page.locator('.pausebar').waitFor({ state: 'detached' });
  ok('Con el checklist completo se reactiva', true);

  await page.locator('.anav').getByRole('button', { name: /^Equipo/ }).click();
  await page.getByRole('button', { name: 'Nueva cuenta' }).click();
  await page.getByLabel('Comercio').selectOption({ index: 1 });
  await page.getByLabel('Nombre').fill('Mostrador E2E');
  await page.getByLabel(/Teléfono/).fill('+54 9 11 5555 9999');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await text(page, 'Contraseña temporal');
  ok('Alta de cuenta de comercio con contraseña temporal', true);
  await page.screenshot({ path: `${OUT}/flow-04-cuenta.png` });
  await page.getByRole('button', { name: 'Ya los anoté' }).click();

  // Verificación de integridad
  await page.locator('.anav').getByRole('button', { name: /^Control/ }).click();
  await page.getByRole('button', { name: 'Verificar ahora' }).click();
  await page.locator('.banner.ok', { hasText: 'Todo en orden' }).waitFor();
  ok('Verificación de integridad: todo en orden', true);
  await ctx.close();
}


// ---------- 4) Desafío con cupo: se acepta, se reserva y deja de verse para el resto ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
  const fresh = async () => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
    page.setDefaultTimeout(60000);
    await page.goto(BASE + '/');
    // La demo recuerda quién entró (localStorage); la base de datos (IndexedDB) se conserva
    await page.evaluate(() => { localStorage.clear(); location.hash = ''; });
    await page.reload();
    await page.getByText('¿Cómo querés entrar?').first().waitFor();
    return page;
  };
  // CEO crea y activa un desafío con cupo para UNA sola persona
  let page = await fresh();
  await enter(page, /CEO \/ Equipo/, /^CEO/);
  await page.locator('.anav').getByRole('button', { name: /^Desafíos/ }).click();
  await page.getByRole('button', { name: 'Nuevo desafío' }).click();
  await page.getByLabel('Título').fill('Cupo E2E');
  await page.getByLabel('Tipo').selectOption('meta_pasos');
  await page.getByLabel(/Meta de pasos/).fill('1000');
  await page.getByLabel('PASOS que otorga').fill('50');
  await page.getByLabel('Cupo total').fill('1');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.locator('.card', { hasText: 'Cupo E2E' }).first().waitFor();
  for (const [accion, estado] of [['Enviar a revisión', 'En revisión'], ['Aprobar', 'Programado'], ['Activar', 'Activo']]) {
    await page.locator('.card', { hasText: 'Cupo E2E' }).first().getByRole('button', { name: accion }).click();
    await page.getByRole('dialog').getByRole('button', { name: accion }).click();
    await page.locator('.card', { hasText: 'Cupo E2E' }).first().getByText(estado, { exact: true }).waitFor();
  }
  ok('CEO crea y activa un desafío con cupo 1', true);
  await page.close();

  // Sofía lo ve con cupo limitado y lo acepta
  page = await fresh();
  await enter(page, /Persona/, /Sofía/);
  await text(page, 'Hola, Sofía');
  await page.getByRole('button', { name: 'Desafíos' }).click();
  const c1 = page.locator('.card', { hasText: 'Cupo E2E' }).first();
  await c1.waitFor();
  ok('Se muestra como "Cupo limitado · quedan 1"', /Cupo limitado · quedan 1/.test(await c1.innerText()));
  await c1.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reclamar PASOS' }).waitFor({ state: 'detached' }).catch(() => {});
  ok('Antes de aceptar no se puede reclamar', (await page.getByRole('dialog').getByRole('button', { name: 'Reclamar PASOS' }).count()) === 0);
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar desafío' }).click();
  await text(page, 'Tu lugar está reservado');
  ok('Sofía acepta: lugar reservado con tiempo para completarlo', /Te quedan/.test(await page.getByRole('dialog').innerText()));
  await page.screenshot({ path: `${OUT}/flow-05-cupo-aceptado.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Yo' }).click();
  await page.getByRole('button', { name: /Cambiar perfil/ }).click();
  await page.getByText('¿Cómo querés entrar?').first().waitFor();

  // Otra persona (alta nueva): el desafío ya no aparece, porque el único cupo está reservado
  await page.getByRole('button', { name: /Persona/ }).click();
  await page.getByRole('button', { name: /Persona nueva/ }).first().click();
  await text(page, 'Creá tu perfil');
  await page.getByLabel(/Cómo te llamamos/).fill('Martín E2E');
  await page.getByLabel('Fecha de nacimiento').fill('1990-03-02');
  for (const c of await page.getByRole('checkbox').all()) await c.check();
  await page.getByRole('button', { name: 'Empezar' }).click();
  await text(page, 'Hola, Martín E2E');
  await page.getByRole('button', { name: 'Desafíos' }).click();
  await page.locator('.card', { hasText: 'Café de la Esquina' }).first().waitFor();
  ok('Cupo agotado: el desafío desaparece para quien no lo aceptó', (await page.locator('.card', { hasText: 'Cupo E2E' }).count()) === 0);
  await page.screenshot({ path: `${OUT}/flow-06-cupo-oculto.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
if (problems.length) { console.log('\nErrores de consola / página:'); [...new Set(problems)].forEach((p) => console.log(' -', p)); }
process.exit(failed.length || problems.length ? 1 : 0);
