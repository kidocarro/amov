-- =====================================================================
-- Painel de parceiros (/admin): anotações internas e data da última
-- mudança de status. Idempotente.
-- =====================================================================

alter table public.parceiros
  add column if not exists notas_internas     text,         -- só a equipe Amov vê (painel /admin)
  add column if not exists status_alterado_em timestamptz;  -- última mudança de status feita no painel

create index if not exists parceiros_atualizado_em_idx on public.parceiros (atualizado_em desc);

-- atualizado_em marca o último ENVIO do parceiro. Mudar status ou anotação no
-- painel não deve mexer nele, então o gatilho só dispara nas colunas do formulário.
drop trigger if exists parceiros_atualizado_em on public.parceiros;
create trigger parceiros_atualizado_em
  before update of documento, tipo_documento, nome, empresa, tipo_cadastro, cidade, remoto, whatsapp,
                   email, portfolio, redes, areas, experiencia, emite_nf, modelo_parceria, capacidade,
                   total_envios
  on public.parceiros
  for each row execute function private.tocar_atualizado_em();

-- mantém o mesmo bloqueio da Data API da migração anterior
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.parceiros from %I', r);
    end if;
  end loop;
end $$;
