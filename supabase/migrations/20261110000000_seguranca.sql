-- Segurança (auditoria de 10/11/2026): limite de uso do chat e MFA obrigatório para o admin.

-- 1) Limite de uso da função chat (protege a cota da Groq).
-- Guarda só o hash SHA-256 do IP (dado pessoal), nunca o IP em claro.
create table if not exists public.chat_uso (
  chave text primary key,
  janela timestamptz not null,
  contagem integer not null
);
alter table public.chat_uso enable row level security; -- sem políticas: só o servidor acessa

create or replace function public.chat_permitido(_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  por_ip constant int := 20;      -- perguntas por IP a cada 10 minutos
  por_dia constant int := 500;    -- perguntas no total por dia (cota diária da Groq no plano gratuito)
  n_ip int;
  n_dia int;
begin
  delete from public.chat_uso where chave <> 'global' and janela < now() - interval '1 day';

  insert into public.chat_uso as u (chave, janela, contagem)
  values ('ip:' || encode(extensions.digest(coalesce(_ip, 'desconhecido'), 'sha256'), 'hex'), now(), 1)
  on conflict (chave) do update set
    contagem = case when u.janela < now() - interval '10 minutes' then 1 else u.contagem + 1 end,
    janela   = case when u.janela < now() - interval '10 minutes' then now() else u.janela end
  returning contagem into n_ip;

  insert into public.chat_uso as u (chave, janela, contagem)
  values ('global', now(), 1)
  on conflict (chave) do update set
    contagem = case when u.janela < now() - interval '1 day' then 1 else u.contagem + 1 end,
    janela   = case when u.janela < now() - interval '1 day' then now() else u.janela end
  returning contagem into n_dia;

  return n_ip <= por_ip and n_dia <= por_dia;
end;
$$;

revoke all on function public.chat_permitido(text) from public, anon, authenticated;
grant execute on function public.chat_permitido(text) to service_role;

-- 2) MFA: alterar a base exige sessão com segundo fator (aal2), além do papel admin.
-- Restritivas: somam (AND) às políticas "admin gerencia ..." já existentes.
drop policy if exists "exige mfa documents" on public.documents;
create policy "exige mfa documents" on public.documents
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "exige mfa chunks" on public.chunks;
create policy "exige mfa chunks" on public.chunks
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');
