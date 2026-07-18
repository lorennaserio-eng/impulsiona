-- ================================================================
-- Migração: Gestão da Equipe (papel diretora/consultora, telefone,
-- agenda de treinamentos).
-- Rode este script INTEIRO no SQL Editor do Supabase (uma vez só).
-- Seguro mesmo já tendo rodado o schema.sql original antes — só
-- adiciona o que ainda não existe, sem apagar nada.
-- ================================================================

alter table profiles add column if not exists role text not null default 'consultora';
alter table profiles add column if not exists phone text;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'consultora'),
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$ language plpgsql security definer;

create table if not exists trainings (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  training_date date not null,
  training_time time,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now()
);

alter table trainings enable row level security;

drop policy if exists "trainings_select" on trainings;
drop policy if exists "trainings_insert_diretora" on trainings;
drop policy if exists "trainings_update_diretora" on trainings;
drop policy if exists "trainings_delete_diretora" on trainings;

create policy "trainings_select" on trainings for select using (auth.role() = 'authenticated');
create policy "trainings_insert_diretora" on trainings for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'diretora')
);
create policy "trainings_update_diretora" on trainings for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'diretora')
);
create policy "trainings_delete_diretora" on trainings for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'diretora')
);

-- ================================================================
-- IMPORTANTE: sua conta já existia antes desta migração, então ela
-- recebeu o papel padrão 'consultora'. Se você é a diretora, rode
-- o comando abaixo (troque o e-mail pelo seu) para virar diretora:
--
--   update profiles set role = 'diretora'
--   where id = (select id from auth.users where email = 'seu-email@exemplo.com');
-- ================================================================
