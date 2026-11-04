# Amov Network — Site

Site institucional, landings (imobiliárias, médicos) e o formulário de parceiros (`/parceiros`).
HTML/CSS/JS vanilla, um arquivo por página, com captura de leads e da **origem** de cada um
(UTMs, campanha, conjunto, anúncio, click IDs) no Supabase **GRAY Desert**, o banco que a
integração da Vercel criou no projeto `amov`.

## Estrutura

```
amov-site/
├── index.html                  → /              (institucional)
├── imobiliarias/index.html     → /imobiliarias
├── medicos/index.html          → /medicos
├── parceiros/index.html        → /parceiros     (Tabela do Parceiro, 4 etapas)
├── js/atribuicao.js            → guarda a origem do visitante (1º e último toque)
├── api/lead.js                 → POST /api/lead      (landings)
├── api/parceiro.js             → POST /api/parceiro  (/parceiros)
├── api/_lib/                   → conexão, migrações, segurança, atribuição (não vira rota)
├── supabase/migrations/*.sql   → schema do banco (tabelas, RLS, rate limit, views)
├── scripts/migrate.mjs         → aplica as migrações pela linha de comando
└── vercel.json                 → cabeçalhos de segurança, anti-iframe, bloqueio de arquivos internos
```

## Banco (Supabase GRAY Desert)

As funções usam as variáveis que a integração Supabase da Vercel já injeta no projeto
(`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`…). Não precisa configurar nada.

**As tabelas são criadas sozinhas.** Na primeira requisição após o deploy, a função aplica
as migrações pendentes de `supabase/migrations/` e registra em `private.schema_migrations`.
Também dá para aplicar antes:

- **SQL Editor do Supabase:** cole o conteúdo de `supabase/migrations/20261104000000_leads_parceiros_origem.sql` e rode (é idempotente).
- **Linha de comando:** `vercel env pull .env.local` e depois `node --env-file=.env.local scripts/migrate.mjs`.

### Tabelas

| Tabela | O que guarda |
|---|---|
| `leads` | Leads das landings (a tabela que já existia, com colunas novas: página, sessão, geo, status, hash do IP) |
| `parceiros` | Um cadastro por CPF/CNPJ. Reenvio com o mesmo documento atualiza os dados e soma `total_envios` |
| `parceiro_tabelas` | Cada envio do `/parceiros` = uma tabela versionada, com `protocolo`, condições e aceites |
| `parceiro_servicos` | Serviços de cada tabela: faixa de valor, valor ao cliente (+20%, calculado), prazo, escopo, especificações |
| `origens` | **De onde veio cada envio**: um registro de primeiro toque e outro de último toque |

Colunas de `origens`: `canal` (classificado: `meta_ads`, `google_ads`, `tiktok_ads`, `organico_busca`,
`social`, `referencia`, `email`, `whatsapp`, `direto`…), `utm_source`, `utm_medium`, `utm_campaign`,
`utm_term`, `utm_content`, `utm_id`, `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `ad_id`,
`ad_name`, `placement`, `site_source_name`, `gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid`,
`fbclid`, `ttclid`, `msclkid`, `li_fat_id`, cookies `_fbp`/`_fbc`/`_ga`, `referrer`, `landing_page`,
`capturado_em` e `params` (todos os parâmetros da URL em JSON).

### Views prontas

```sql
select * from vw_leads_origem order by criado_em desc;      -- lead + origem (último e primeiro toque)
select * from vw_parceiros_origem order by criado_em desc;  -- envios de parceiros + origem
select * from vw_origem_resumo order by envios desc;        -- envios por canal / campanha / conjunto / anúncio
```

## Como montar os links dos anúncios

O `js/atribuicao.js` lê qualquer parâmetro da URL. Para ter campanha, conjunto e anúncio separados:

**Meta Ads** (campo "Parâmetros de URL" do anúncio):

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&adset_name={{adset.name}}&ad_id={{ad.id}}&ad_name={{ad.name}}&placement={{placement}}
```

**Google Ads** (modelo de acompanhamento ou sufixo do URL final). O `gclid` é capturado sozinho:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&utm_content={creative}&campaign_id={campaignid}&adset_id={adgroupid}&ad_id={creative}&placement={placement}
```

Também são aceitos os apelidos `utm_adset` (→ `adset_name`) e `utm_ad` (→ `ad_name`).

**Primeiro e último toque:** a primeira visita fica guardada por 90 dias. O último toque é
substituído só quando a pessoa volta por campanha ou por link externo. Uma visita direta
depois de um anúncio não apaga a campanha.

## Segurança

- **RLS ligado** em todas as tabelas, sem nenhuma policy, e privilégios de `anon`/`authenticated`
  revogados. A chave pública do Supabase (Data API) não lê nem grava nada. Só as funções da
  Vercel gravam, pelo servidor.
- **Rate limit** no Postgres (`private.rate_limit_ok`): `/api/lead` aceita 5 envios a cada 10 min
  por IP (300/h no total) e `/api/parceiro` 5 por hora por IP (150/h no total). Acima disso, responde 429.
- **Proteção contra iframe:** `X-Frame-Options: DENY` e `Content-Security-Policy: frame-ancestors 'none'`
  em todas as páginas, além de `nosniff`, `Referrer-Policy`, `Permissions-Policy` e `COOP`.
- **Só aceita envio do próprio site** (checagem de `Origin`), só JSON, com limite de tamanho, validação no
  servidor e honeypot contra robôs no `/parceiros`.
- **LGPD:** o IP nunca é guardado. Só um hash com sal (defina `IP_HASH_SALT` na Vercel para um sal próprio).
- `/supabase`, `/scripts`, `README.md` e `package.json` não ficam acessíveis pelo site.

Opcional: no painel da Vercel → Firewall dá para criar uma regra de rate limit para `/api/*`
como camada extra, antes de a requisição chegar à função.

## Como os formulários enviam

- Landings: `POST /api/lead` com `{nome, negocio, momento, desafio, investimento, contato, obs, origem, atribuicao}`.
  `origem` = `institucional`, `imobiliarias` ou `medicos`.
- Parceiros: `POST /api/parceiro` com `{parceiro, servicos[], condicoes, aceites, atribuicao}`. A resposta
  traz o `protocolo` exibido na tela final.

## Deploy

Commit e push na `main`: a Vercel redeploya sozinha (Root Directory = `amov-site`).
Domínio `amov.network` já configurado no projeto.
