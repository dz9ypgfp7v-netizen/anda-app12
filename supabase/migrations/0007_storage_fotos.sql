-- ============================================================================
-- ANDÁ · 0007 · Fotos (Supabase Storage)
-- Bucket público de lectura (son imágenes de marketing). Subir, reemplazar o
-- borrar solo puede quien tenga el permiso "fotos.gestionar" (CEO o equipo).
-- Solo para Supabase: el modo demostración guarda las imágenes en el navegador.
-- ============================================================================

create or replace function public.can_manage_photos() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_perm('fotos.gestionar')
$$;
revoke all on function public.can_manage_photos() from public, anon;
grant execute on function public.can_manage_photos() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 1048576,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists fotos_lectura on storage.objects;
drop policy if exists fotos_subir on storage.objects;
drop policy if exists fotos_reemplazar on storage.objects;
drop policy if exists fotos_borrar on storage.objects;

create policy fotos_lectura on storage.objects for select to anon, authenticated
  using (bucket_id = 'fotos');
create policy fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.can_manage_photos());
create policy fotos_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.can_manage_photos())
  with check (bucket_id = 'fotos' and public.can_manage_photos());
create policy fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.can_manage_photos());
