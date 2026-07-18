# Amov Network — Site

Site institucional + landing de imobiliárias. HTML/CSS/JS vanilla, arquivo único por página, com captura de leads via função serverless.

## Estrutura

```
amov-site/
├── index.html                → https://seu-dominio.com/          (institucional)
├── imobiliarias/index.html   → https://seu-dominio.com/imobiliarias
├── api/lead.js               → POST /api/lead (grava lead no Vercel Postgres)
├── package.json              → dependência @vercel/postgres
└── .gitignore
```

## Deploy (GitHub + Vercel) — passo a passo

### 1. Subir para o GitHub

```bash
cd amov-site
git init
git add .
git commit -m "amov site v1"
# crie o repositório vazio em github.com/new (ex.: amov-site), depois:
git remote add origin https://github.com/SEU-USUARIO/amov-site.git
git branch -M main
git push -u origin main
```

### 2. Conectar na Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** o repositório `amov-site`.
2. Framework preset: **Other** (é estático + api). Build command: vazio. Output: raiz.
3. **Deploy**. O site sobe; o formulário ainda não grava (falta o banco).

### 3. Criar o banco (Vercel Postgres)

1. No projeto na Vercel → aba **Storage** → **Create Database** → **Postgres** (Neon).
2. Conecte ao projeto quando perguntado. As variáveis de ambiente
   (`POSTGRES_URL` etc.) são injetadas automaticamente — o `api/lead.js` as usa
   sem configuração extra.
3. **Redeploy** (Deployments → ⋯ → Redeploy) para a função enxergar as variáveis.

A tabela `leads` é criada automaticamente no primeiro envio (idempotente):
`id, nome, negocio, momento, desafio, investimento, contato, obs, origem, criado_em`.

### 4. Ver os leads

- Vercel → Storage → seu Postgres → **Data** → tabela `leads`; ou
- Query no painel: `SELECT * FROM leads ORDER BY criado_em DESC;`

## Como o formulário envia

Ambas as páginas fazem `POST /api/lead` com JSON
`{nome, negocio, momento, desafio, investimento, contato, obs, origem}` —
`origem` = `institucional` ou `imobiliarias`. Em ambiente local/file:// o envio
falha silenciosamente (console.warn) e a jornada do usuário segue normal.

## Domínio

Vercel → Settings → Domains → adicionar `amov.network` e seguir as instruções
de DNS do registrador.

## Manutenção

- Edite os HTML, commit, push — a Vercel redeploya sozinha.
- Cópia de trabalho/backups ficam fora deste repo (pasta AMOV.NETWORK).
