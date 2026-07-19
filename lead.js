// api/lead.js — grava leads no Supabase (Postgres) usando a POSTGRES_URL
// injetada pela integração Vercel × Supabase. A tabela é criada sozinha.
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
});

// cria a tabela uma vez por cold start (idempotente)
const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS leads (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome         TEXT NOT NULL,
    negocio      TEXT,
    momento      TEXT,
    desafio      TEXT,
    investimento TEXT,
    contato      TEXT NOT NULL,
    obs          TEXT,
    origem       TEXT,
    criado_em    TIMESTAMPTZ DEFAULT now()
  )`);

const clip = (s) => String(s ?? '').trim().slice(0, 500);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ready;
    const b = req.body || {};
    const nome = clip(b.nome);
    const contato = clip(b.contato);
    if (!nome || contato.length < 6) {
      return res.status(400).json({ error: 'nome e contato são obrigatórios' });
    }
    await pool.query(
      `INSERT INTO leads (nome, negocio, momento, desafio, investimento, contato, obs, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [nome, clip(b.negocio), clip(b.momento), clip(b.desafio),
       clip(b.investimento), contato, clip(b.obs), clip(b.origem) || 'site']
    );
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead error:', e);
    return res.status(500).json({ error: 'internal' });
  }
}
