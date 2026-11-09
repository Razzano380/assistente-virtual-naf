-- Assistente Virtual NAF: base vetorial (pgvector) + papéis de administrador.

create extension if not exists vector with schema extensions;

-- Documentos e chunks ---------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  categoria text not null check (categoria in ('IRPF', 'MEI', 'DIRF', 'Outros')),
  total_paginas int not null check (total_paginas >= 1),
  created_at timestamptz not null default now()
);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  conteudo text not null,
  pagina int not null check (pagina >= 1),
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now()
);

create index chunks_document_id_idx on public.chunks (document_id);
create index chunks_embedding_hnsw_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- Retriever: top-k por similaridade de cosseno (k = 5 por padrão).
create or replace function public.match_documents(
  query_embedding extensions.vector(384),
  match_count int default 5
)
returns table (conteudo text, pagina int, nome text, categoria text, similaridade float)
language sql stable
set search_path = public, extensions
as $$
  select c.conteudo, c.pagina, d.nome, d.categoria,
         1 - (c.embedding <=> query_embedding) as similaridade
  from public.chunks c
  join public.documents d on d.id = c.document_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Só a Edge Function (service role) consulta o retriever.
revoke execute on function public.match_documents(extensions.vector, int) from public, anon, authenticated;
grant execute on function public.match_documents(extensions.vector, int) to service_role;

-- Papéis ------------------------------------------------------------------------
create type public.app_role as enum ('admin');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

-- Primeiro usuário cadastrado vira admin; os demais entram sem papel.
create or replace function public.handle_first_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('naf_first_admin')); -- evita dois admins em cadastros simultâneos
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created_first_admin
  after insert on auth.users
  for each row execute function public.handle_first_admin();

-- RLS ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.user_roles enable row level security;

create policy "admin gerencia documents" on public.documents
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "admin gerencia chunks" on public.chunks
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "usuario le o proprio papel" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());
