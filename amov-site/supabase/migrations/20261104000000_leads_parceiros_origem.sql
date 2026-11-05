-- =====================================================================
-- Amov Network — leads, parceiros e origem (atribuição) de cada envio
-- Banco: Supabase "GRAY Desert" (integração Vercel do projeto amov)
--
-- Idempotente: pode rodar mais de uma vez sem perder dados.
-- Aplicada automaticamente pelas funções /api (api/_lib/migrar.js) ou
-- manualmente com `npm run db:migrate` / colando no SQL Editor.
--
-- Segurança:
--   * RLS ligado em todas as tabelas, sem nenhuma policy => a Data API
--     (anon / authenticated, chave pública) não lê nem grava nada.
--   * Privilégios de anon/authenticated revogados (defesa em profundidade).
--   * Gravação só pelo servidor (funções da Vercel com POSTGRES_URL).
--   * Rate limit e infraestrutura interna no schema `private`, que não é
--     exposto pela Data API.
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. LEADS (tabela já existente — só acrescenta colunas)
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id           bigint generated always as identity primary key,
  nome         text not null,
  negocio      text,
  momento      text,
  desafio      text,
  investimento text,
  contato      text not null,
  obs          text,
  origem       text,
  criado_em    timestamptz default now()
);

alter table public.leads
  add column if not exists pagina      text,          -- URL em que o formulário foi enviado
  add column if not exists sessao_id   text,          -- id anônimo do navegador (atribuicao.js)
  add column if not exists ip_hash     text,          -- sha256(ip + sal), nunca o IP puro
  add column if not exists user_agent  text,
  add column if not exists geo_pais    text,          -- cabeçalhos de geolocalização da Vercel
  add column if not exists geo_estado  text,
  add column if not exists geo_cidade  text,
  add column if not exists status      text not null default 'novo',
  add column if not exists payload     jsonb;         -- corpo original (sem a atribuição)

do $$ begin
  alter table public.leads
    add constraint leads_status_chk
    check (status in ('novo','em_contato','qualificado','cliente','perdido','spam'));
exception when duplicate_object then null; end $$;

comment on table public.leads is 'Leads dos formulários do site (institucional, imobiliárias, médicos...). Origem em public.origens.';

create index if not exists leads_criado_em_idx on public.leads (criado_em desc);
create index if not exists leads_origem_idx    on public.leads (origem);

-- ---------------------------------------------------------------------
-- 2. PARCEIROS (cadastro único por CPF/CNPJ)
-- ---------------------------------------------------------------------
create table if not exists public.parceiros (
  id                bigint generated always as identity primary key,
  documento         text not null unique,     -- só dígitos/letras (CNPJ alfanumérico)
  tipo_documento    text not null check (tipo_documento in ('cpf','cnpj')),
  nome              text not null,
  empresa           text not null,
  tipo_cadastro     text,                      -- Pessoa física / MEI / Empresa
  cidade            text,
  remoto            text,
  whatsapp          text,
  email             text,
  portfolio         text,
  redes             text,
  areas             text[] not null default '{}',
  experiencia       text,
  emite_nf          boolean,
  modelo_parceria   text,
  capacidade        integer,
  status            text not null default 'novo'
                    check (status in ('novo','em_revisao','aprovado','recusado','inativo')),
  total_envios      integer not null default 1,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.parceiros is 'Rede de parceiros Amov. Um registro por CPF/CNPJ; cada envio do /parceiros gera uma nova tabela de valores.';

create index if not exists parceiros_status_idx on public.parceiros (status);
create index if not exists parceiros_areas_idx  on public.parceiros using gin (areas);

-- Cada envio do formulário /parceiros = uma "tabela de valores" versionada
create table if not exists public.parceiro_tabelas (
  id                 bigint generated always as identity primary key,
  parceiro_id        bigint not null references public.parceiros(id) on delete cascade,
  protocolo          text not null unique,
  validade           text,
  reajuste           text,
  cancelamento       text,
  observacoes        text,
  aceites            jsonb not null default '[]'::jsonb,
  dados_parceiro     jsonb not null,           -- foto dos dados no momento do envio
  margem_amov        numeric(5,4) not null default 0.20,
  pagina             text,
  sessao_id          text,
  ip_hash            text,
  user_agent         text,
  geo_pais           text,
  geo_estado         text,
  geo_cidade         text,
  enviado_em_cliente timestamptz,
  criado_em          timestamptz not null default now()
);

create index if not exists parceiro_tabelas_parceiro_idx on public.parceiro_tabelas (parceiro_id, criado_em desc);

-- Serviços de cada tabela
create table if not exists public.parceiro_servicos (
  id                bigint generated always as identity primary key,
  tabela_id         bigint not null references public.parceiro_tabelas(id) on delete cascade,
  parceiro_id       bigint not null references public.parceiros(id) on delete cascade,
  ordem             integer not null,
  area              text not null,
  servico           text not null,
  descricao         text,
  incluso           text,
  nao_incluso       text,
  unidade           text,
  valor_min         numeric(12,2) not null check (valor_min > 0),
  valor_max         numeric(12,2) not null check (valor_max >= valor_min),
  margem_amov       numeric(5,4) not null default 0.20,
  valor_cliente_min numeric(12,2) generated always as (round(valor_min * (1 + margem_amov), 2)) stored,
  valor_cliente_max numeric(12,2) generated always as (round(valor_max * (1 + margem_amov), 2)) stored,
  criterio          text,
  prazo_dias        integer,
  revisoes          integer,
  valor_extra       numeric(12,2),
  pagamento         text,
  custos            text[] not null default '{}',
  requisitos        text,
  exemplo_url       text,
  especificacoes    jsonb not null default '{}'::jsonb,
  criado_em         timestamptz not null default now()
);

create index if not exists parceiro_servicos_tabela_idx   on public.parceiro_servicos (tabela_id);
create index if not exists parceiro_servicos_parceiro_idx on public.parceiro_servicos (parceiro_id);
create index if not exists parceiro_servicos_area_idx     on public.parceiro_servicos (area);

-- ---------------------------------------------------------------------
-- 3. ORIGENS — de onde veio cada envio (primeiro e último toque)
-- ---------------------------------------------------------------------
create table if not exists public.origens (
  id                  bigint generated always as identity primary key,
  lead_id             bigint references public.leads(id) on delete cascade,
  parceiro_tabela_id  bigint references public.parceiro_tabelas(id) on delete cascade,
  toque               text not null check (toque in ('primeiro','ultimo')),
  canal               text,          -- classificação: meta_ads, google_ads, organico_busca, social, referencia, direto...
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_term            text,
  utm_content         text,
  utm_id              text,
  campaign_id         text,
  campaign_name       text,
  adset_id            text,
  adset_name          text,          -- conjunto de anúncios (ad set)
  ad_id               text,
  ad_name             text,          -- nome do anúncio / criativo
  placement           text,
  site_source_name    text,          -- fb, ig, an, msg (macro da Meta)
  gclid               text,
  gbraid              text,
  wbraid              text,
  gad_source          text,
  gad_campaignid      text,
  fbclid              text,
  ttclid              text,
  msclkid             text,
  li_fat_id           text,
  fbp                 text,          -- cookie _fbp
  fbc                 text,          -- cookie _fbc (ou montado a partir do fbclid)
  ga_client_id        text,          -- cookie _ga
  referrer            text,
  landing_page        text,
  capturado_em        timestamptz,   -- quando esse toque aconteceu no navegador
  params              jsonb not null default '{}'::jsonb,  -- todos os parâmetros da URL
  criado_em           timestamptz not null default now(),
  constraint origens_um_dono_chk check (num_nonnulls(lead_id, parceiro_tabela_id) = 1)
);

comment on table public.origens is 'Atribuição de cada envio: UTMs, IDs de campanha/conjunto/anúncio, click IDs, referrer e página de entrada. Um registro para o primeiro toque e outro para o último.';

create unique index if not exists origens_lead_toque_uq     on public.origens (lead_id, toque) where lead_id is not null;
create unique index if not exists origens_parceiro_toque_uq on public.origens (parceiro_tabela_id, toque) where parceiro_tabela_id is not null;
create index if not exists origens_campanha_idx on public.origens (utm_source, utm_campaign);
create index if not exists origens_canal_idx    on public.origens (canal);

-- ---------------------------------------------------------------------
-- 4. atualizado_em automático
-- ---------------------------------------------------------------------
create or replace function private.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists parceiros_atualizado_em on public.parceiros;
create trigger parceiros_atualizado_em
  before update on public.parceiros
  for each row execute function private.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- 5. RATE LIMIT (janela fixa, por chave = rota + hash do IP)
-- ---------------------------------------------------------------------
create table if not exists private.rate_limits (
  chave          text primary key,
  janela_inicio  timestamptz not null default now(),
  contagem       integer not null default 0
);

-- Retorna true se a requisição está DENTRO do limite.
create or replace function private.rate_limit_ok(p_chave text, p_limite integer, p_janela_seg integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_contagem integer;
begin
  insert into private.rate_limits as r (chave, janela_inicio, contagem)
  values (p_chave, now(), 1)
  on conflict (chave) do update
    set contagem      = case when r.janela_inicio < now() - make_interval(secs => p_janela_seg)
                             then 1 else r.contagem + 1 end,
        janela_inicio = case when r.janela_inicio < now() - make_interval(secs => p_janela_seg)
                             then now() else r.janela_inicio end
  returning contagem into v_contagem;

  -- limpeza ocasional de janelas antigas
  if random() < 0.02 then
    delete from private.rate_limits where janela_inicio < now() - interval '1 day';
  end if;

  return v_contagem <= p_limite;
end $$;

-- ---------------------------------------------------------------------
-- 6. VIEWS para análise (security_invoker => respeitam RLS de quem consulta)
-- ---------------------------------------------------------------------
create or replace view public.vw_leads_origem
with (security_invoker = true) as
select
  l.id, l.criado_em, l.status, l.origem as formulario, l.nome, l.negocio, l.contato,
  l.momento, l.desafio, l.investimento, l.obs,
  u.canal          as canal,
  u.utm_source     as utm_source,
  u.utm_medium     as utm_medium,
  u.utm_campaign   as utm_campaign,
  u.utm_term       as utm_term,
  u.utm_content    as utm_content,
  u.campaign_id, u.campaign_name, u.adset_id, u.adset_name, u.ad_id, u.ad_name, u.placement,
  u.site_source_name,
  coalesce(u.gclid, u.gbraid, u.wbraid) as google_click_id,
  u.fbclid, u.referrer, u.landing_page,
  p.canal        as primeiro_canal,
  p.utm_source   as primeiro_utm_source,
  p.utm_campaign as primeiro_utm_campaign,
  p.adset_name   as primeiro_adset_name,
  p.ad_name      as primeiro_ad_name,
  p.landing_page as primeiro_landing_page,
  p.referrer     as primeiro_referrer,
  p.capturado_em as primeiro_toque_em,
  l.geo_cidade, l.geo_estado, l.geo_pais, l.pagina
from public.leads l
left join public.origens u on u.lead_id = l.id and u.toque = 'ultimo'
left join public.origens p on p.lead_id = l.id and p.toque = 'primeiro';

create or replace view public.vw_parceiros_origem
with (security_invoker = true) as
select
  t.id as tabela_id, t.protocolo, t.criado_em,
  pa.id as parceiro_id, pa.nome, pa.empresa, pa.documento, pa.whatsapp, pa.email,
  pa.areas, pa.status, pa.total_envios,
  (select count(*) from public.parceiro_servicos s where s.tabela_id = t.id) as servicos,
  u.canal, u.utm_source, u.utm_medium, u.utm_campaign, u.utm_term, u.utm_content,
  u.campaign_id, u.adset_id, u.adset_name, u.ad_id, u.ad_name, u.referrer, u.landing_page,
  p.canal as primeiro_canal, p.utm_source as primeiro_utm_source,
  p.utm_campaign as primeiro_utm_campaign, p.landing_page as primeiro_landing_page,
  t.geo_cidade, t.geo_estado, t.geo_pais
from public.parceiro_tabelas t
join public.parceiros pa on pa.id = t.parceiro_id
left join public.origens u on u.parceiro_tabela_id = t.id and u.toque = 'ultimo'
left join public.origens p on p.parceiro_tabela_id = t.id and p.toque = 'primeiro';

-- Resumo de performance por origem (último toque)
create or replace view public.vw_origem_resumo
with (security_invoker = true) as
select
  case when o.lead_id is not null then 'lead' else 'parceiro' end as tipo,
  coalesce(l.origem, 'parceiros') as formulario,
  coalesce(o.canal, 'desconhecido')        as canal,
  coalesce(o.utm_source, '(sem utm)')      as utm_source,
  coalesce(o.utm_medium, '(sem utm)')      as utm_medium,
  coalesce(o.utm_campaign, '(sem utm)')    as utm_campaign,
  coalesce(o.adset_name, o.utm_term, '—')  as conjunto,
  coalesce(o.ad_name, o.utm_content, '—')  as anuncio,
  count(*)                                 as envios,
  min(o.criado_em)                         as primeiro_envio,
  max(o.criado_em)                         as ultimo_envio
from public.origens o
left join public.leads l on l.id = o.lead_id
where o.toque = 'ultimo'
group by 1,2,3,4,5,6,7,8;

-- ---------------------------------------------------------------------
-- 7. SEGURANÇA: RLS + revogar acesso da Data API
-- ---------------------------------------------------------------------
alter table public.leads             enable row level security;
alter table public.parceiros         enable row level security;
alter table public.parceiro_tabelas  enable row level security;
alter table public.parceiro_servicos enable row level security;
alter table public.origens           enable row level security;
alter table private.rate_limits      enable row level security;

-- Nenhuma policy é criada de propósito: sem policy, anon/authenticated
-- não enxergam nem gravam nenhuma linha. O servidor grava como dono da
-- tabela (role postgres), que não é afetado pelo RLS.

do $$
declare r text; t text; s text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.leads, public.parceiros, public.parceiro_tabelas, public.parceiro_servicos, public.origens from %I', r);
      execute format('revoke all on table public.vw_leads_origem, public.vw_parceiros_origem, public.vw_origem_resumo from %I', r);
      foreach t in array array['public.leads','public.parceiros','public.parceiro_tabelas','public.parceiro_servicos','public.origens'] loop
        s := pg_get_serial_sequence(t, 'id');
        if s is not null then execute format('revoke all on sequence %s from %I', s, r); end if;
      end loop;
      execute format('revoke all on schema private from %I', r);
      execute format('revoke all on all tables in schema private from %I', r);
      execute format('revoke all on all functions in schema private from %I', r);
    end if;
  end loop;
end $$;

revoke all on schema private from public;
revoke all on all functions in schema private from public;
