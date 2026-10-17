-- ============================================================================
-- ANDÁ · 0006 · Seguridad
-- 1) Las tablas NO son accesibles desde la API: todo pasa por funciones (RPC).
-- 2) Solo usuarios con sesión (rol "authenticated") pueden ejecutar funciones,
--    salvo public_config() que alimenta la pantalla de ingreso.
-- 3) El esquema "private" no es accesible desde la API.
-- ============================================================================

-- Tablas y secuencias: sin acceso directo para anon/authenticated (RLS ya está activo, sin políticas)
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Funciones públicas: nadie por defecto, luego se habilitan explícitamente
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.public_config() to anon, authenticated;

-- Esquema private: invisible para la API
revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- Objetos futuros: mismo criterio (hay que habilitarlos a propósito)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
