-- ============================================================================
-- ANDÁ · Usuarios de DEMOSTRACIÓN (solo modo demo y pruebas automáticas)
-- NO ejecutar en Supabase: allí los usuarios se crean con el login real.
-- ============================================================================

insert into auth.users (id, email, phone) values
  ('e0000000-0000-4000-8000-000000000001', 'ceo@demo.anda.test', null),
  ('e0000000-0000-4000-8000-000000000002', 'equipo.gestor@demo.anda.test', '+5491100000002'),
  ('e0000000-0000-4000-8000-000000000003', 'equipo.aprobador@demo.anda.test', '+5491100000003'),
  ('e0000000-0000-4000-8000-000000000011', 'cafe@demo.anda.test', '+5491100000011'),
  ('e0000000-0000-4000-8000-000000000012', 'panaderia@demo.anda.test', '+5491100000012'),
  ('e0000000-0000-4000-8000-000000000021', 'persona.nueva@demo.anda.test', null),
  ('e0000000-0000-4000-8000-000000000022', 'sofia@demo.anda.test', null)
on conflict (id) do nothing;

insert into public.user_roles (id, user_id, role, merchant_id, perms, display_name, phone, must_change_password) values
  ('90000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'ceo', null, '{}', 'CEO (demo)', null, false),
  ('90000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'equipo', null,
     array['desafios.editar','catalogo.gestionar','fotos.gestionar'], 'Equipo · Gestor (demo)', '+5491100000002', false),
  ('90000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'equipo', null,
     array['desafios.aprobar','visitas.ver','cupones.ver'], 'Equipo · Aprobador (demo)', '+5491100000003', false),
  ('90000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000011', 'comercio', 'a1000000-0000-4000-8000-000000000001',
     '{}', 'Café de la Esquina (demo)', '+5491100000011', false),
  ('90000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000012', 'comercio', 'a1000000-0000-4000-8000-000000000002',
     '{}', 'Panadería La Espiga (demo)', '+5491100000012', false)
on conflict (id) do nothing;

-- Sofía: persona de ejemplo ya registrada, con PASOS de prueba para reclamar premios
insert into public.profiles (user_id, display_name, birth_date, adult_declared_at, terms_version, privacy_version, accepted_at)
values ('e0000000-0000-4000-8000-000000000022', 'Sofía (ejemplo)', date '1992-04-15', now(), '0.1-borrador', '0.1-borrador', now())
on conflict (user_id) do nothing;
insert into public.consents (user_id, kind, version) values
  ('e0000000-0000-4000-8000-000000000022', 'terminos', '0.1-borrador'),
  ('e0000000-0000-4000-8000-000000000022', 'privacidad', '0.1-borrador')
on conflict do nothing;
insert into public.wallets (user_id) values ('e0000000-0000-4000-8000-000000000022') on conflict do nothing;
select private.ledger_add('e0000000-0000-4000-8000-000000000022', 'prueba', 4000, 'prueba:demo:sofia-inicial',
                          'prueba', null, 'PASOS de prueba iniciales (demo)', null);
