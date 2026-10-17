-- ============================================================================
-- ANDÁ · Datos de EJEMPLO (solo para el proyecto de PRUEBA, nunca producción)
-- Todo queda marcado como "Ejemplo" (is_example = true). Se pueden borrar desde
-- el panel o con:  delete from public.merchants where is_example;  (si no hay visitas)
-- ============================================================================

update public.app_config set
  test_mode = true,                    -- botones de prueba (solo entorno de prueba)
  require_merchant_active = false,     -- para probar sin dos dispositivos; en producción dejar en true
  daily_cap = 3, fee_per_visit = 200, max_uses_per_code = 4, code_rotation_s = 45, code_grace_s = 30;

-- Comercios de ejemplo
insert into public.merchants (id, name, category, description, neighborhood, is_example) values
  ('a1000000-0000-4000-8000-000000000001', 'Café de la Esquina', 'cafe', 'Café de especialidad y medialunas. (Ejemplo)', 'Palermo', true),
  ('a1000000-0000-4000-8000-000000000002', 'Panadería La Espiga', 'panaderia', 'Panadería de barrio con facturas del día. (Ejemplo)', 'Villa Crespo', true),
  ('a1000000-0000-4000-8000-000000000003', 'Librería Rayuela', 'libreria', 'Libros nuevos y usados. (Ejemplo)', 'Almagro', true)
on conflict (id) do nothing;

insert into public.branches (id, merchant_id, name, address, lat, lng, radius_m) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Palermo', 'Dirección de ejemplo 1234', -34.5880, -58.4300, 80),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'Recoleta', 'Dirección de ejemplo 5678', -34.5880, -58.3960, 80),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Villa Crespo', 'Dirección de ejemplo 910', -34.5990, -58.4390, 80),
  ('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 'Almagro', 'Dirección de ejemplo 1112', -34.6090, -58.4210, 80)
on conflict (id) do nothing;

-- Desafíos de ejemplo (ya aprobados y activos)
insert into public.challenges (id, title, description, category, type, merchant_id, reward_pasos, repeat_rule,
                               goal_steps, status, is_example) values
  ('c1000000-0000-4000-8000-000000000001', 'Un café en la esquina', 'Visitá el Café de la Esquina y pedí el código en el mostrador.',
   'visitas', 'visita', 'a1000000-0000-4000-8000-000000000001', 500, 'diaria', null, 'activo', true),
  ('c1000000-0000-4000-8000-000000000002', 'Medialunas de la mañana', 'Pasá por la panadería y sumá PASOS una sola vez.',
   'visitas', 'visita', 'a1000000-0000-4000-8000-000000000002', 800, 'una_vez', null, 'activo', true),
  ('c1000000-0000-4000-8000-000000000003', 'Meta de 8.000 pasos', 'Caminá 8.000 pasos en el día y reclamá tu recompensa.',
   'pasos', 'meta_pasos', null, 300, 'diaria', 8000, 'activo', true),
  ('c1000000-0000-4000-8000-000000000004', 'Una vuelta por la librería', 'Entrá a Rayuela y mostrá el código.',
   'visitas', 'visita', 'a1000000-0000-4000-8000-000000000003', 400, 'diaria', null, 'activo', true)
on conflict (id) do nothing;

-- Premios de ejemplo
insert into public.rewards (id, merchant_id, title, description, category, cost_pasos, stock, valid_days, conditions,
                            status, is_example) values
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Café con medialuna',
   'Un café y una medialuna.', 'cafe', 3000, 20, 30, 'Válido de lunes a viernes. No acumulable con otras promos.', 'activo', true),
  ('d1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Docena de facturas',
   'Una docena de facturas surtidas.', 'panaderia', 6000, 10, 30, 'Retirar en el local presentando el cupón.', 'activo', true),
  ('d1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', '10% en tu próximo libro',
   'Descuento del 10% en una compra.', 'libreria', 10000, null, 60, 'Un solo uso. No aplica a libros en oferta.', 'activo', true)
on conflict (id) do nothing;

insert into public.reward_price_history (reward_id, old_cost, new_cost)
select id, null, cost_pasos from public.rewards r
where is_example and not exists (select 1 from public.reward_price_history h where h.reward_id = r.id);

-- Propuestas de ejemplo (para probar la revisión del CEO)
insert into public.proposals (id, merchant_id, kind, payload, status) values
  ('f1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'campana',
   '{"title":"Dos medialunas por una visita","description":"Visitanos por la tarde y sumá PASOS.","reward_pasos":600,"repeat_rule":"diaria","quota_total":200}', 'enviada'),
  ('f1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'premio',
   '{"title":"Marcapáginas de regalo","description":"Marcapáginas ilustrado.","cost_pasos":2500,"stock":40,"valid_days":30,"conditions":"Hasta agotar stock."}', 'enviada')
on conflict (id) do nothing;
