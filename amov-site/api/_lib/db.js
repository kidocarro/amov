// api/_lib/db.js — conexão com o Supabase "GRAY Desert" (integração Vercel)
// e aplicação automática das migrações em supabase/migrations.
//
// Arquivos/pastas com "_" dentro de /api não viram rota na Vercel.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// remove o sslmode da URL para a nossa config de SSL valer
function limparUrl(url) {
  return String(url || '')
    .replace(/([?&])sslmode=[^&]*&?/, '$1')
    .replace(/[?&]$/, '');
}

export function urlBanco({ semPool = false } = {}) {
  const e = process.env;
  const url = semPool
    ? (e.POSTGRES_URL_NON_POOLING || e.POSTGRES_URL)
    : (e.POSTGRES_URL || e.POSTGRES_URL_NON_POOLING);
  return limparUrl(url);
}

function usarSsl(url) {
  if (process.env.PGSSL === 'off') return false;
  return /localhost|127\.0\.0\.1|host=\//.test(url) ? false : { rejectUnauthorized: false };
}

let pool;
export function getPool() {
  if (!pool) {
    const cs = urlBanco();
    if (!cs) throw new Error('POSTGRES_URL não configurada');
    pool = new pg.Pool({ connectionString: cs, ssl: usarSsl(cs), max: 1, idleTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('pg pool error:', e.message));
  }
  return pool;
}

// ---------- migrações ----------
function pastaMigracoes() {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const candidatas = [
    path.join(aqui, '..', '..', 'supabase', 'migrations'),
    path.join(process.cwd(), 'supabase', 'migrations'),
  ];
  return candidatas.find((p) => fs.existsSync(p));
}

export function listarMigracoes() {
  const dir = pastaMigracoes();
  if (!dir) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ nome: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

// Aplica as migrações pendentes. Seguro para chamadas concorrentes
// (advisory lock dentro da transação) e barato quando não há pendências.
export async function migrar(client, { log = () => {} } = {}) {
  const migracoes = listarMigracoes();
  if (!migracoes.length) {
    log('nenhuma migração encontrada (supabase/migrations)');
    return [];
  }
  const existe = await client.query(`select to_regclass('private.schema_migrations') as t`);
  let aplicadas = new Set();
  if (existe.rows[0].t) {
    const r = await client.query('select nome from private.schema_migrations');
    aplicadas = new Set(r.rows.map((x) => x.nome));
    if (migracoes.every((m) => aplicadas.has(m.nome))) return [];
  }

  const feitas = [];
  for (const m of migracoes) {
    if (aplicadas.has(m.nome)) continue;
    await client.query('begin');
    try {
      await client.query(`select pg_advisory_xact_lock(hashtext('amov_migracoes'))`);
      await client.query(`create schema if not exists private;
        create table if not exists private.schema_migrations (
          nome text primary key, aplicado_em timestamptz not null default now());
        alter table private.schema_migrations enable row level security;
        revoke all on schema private from public;`);
      const ja = await client.query('select 1 from private.schema_migrations where nome = $1', [m.nome]);
      if (ja.rowCount) { await client.query('commit'); continue; }
      await client.query(m.sql);
      await client.query('insert into private.schema_migrations (nome) values ($1)', [m.nome]);
      await client.query('commit');
      feitas.push(m.nome);
      log(`migração aplicada: ${m.nome}`);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw new Error(`falha na migração ${m.nome}: ${e.message}`);
    }
  }
  return feitas;
}

// Garante o schema uma vez por instância (cold start) da função.
let pronto;
export function garantirSchema() {
  if (!pronto) {
    pronto = (async () => {
      const client = await getPool().connect();
      try { await migrar(client, { log: console.log }); }
      finally { client.release(); }
    })().catch((e) => { pronto = undefined; throw e; });
  }
  return pronto;
}
