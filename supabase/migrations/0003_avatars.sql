-- Profile photos for the people she actually messages.
--
-- Deliberately different from company logos in two ways:
--   * a PRIVATE bucket, read through short-lived signed URLs. A company logo is
--     a brand asset; a person's photograph is not, and it should not sit on a
--     guessable public URL.
--   * fetched only for people with real outreach, never for the whole contact
--     list, and only from her own logged-in browser while she is working on
--     that conversation anyway.

alter table jobhunt.people add column if not exists avatar_path text;
alter table jobhunt.people add column if not exists avatar_checked_at timestamptz;

grant update (notes, updated_at) on jobhunt.people to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false;

-- Only she can read them, and only through a signed URL minted server-side.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select jobhunt.is_me()));
