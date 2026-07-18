// api/lead.js — função serverless (Vercel) que recebe o formulário e grava no Vercel Postgres
import { sql } from '@vercel/postgres';

// cria a tabela uma vez por cold start (idempotente)
const ready = sql`
  CREATE TABLE IF NOT EXISTS leads (
    id           SERIAL PRIMARY KEY,
    nome         TEXT NOT NULL,
    negocio      TEXT,
    momento      TEXT,
    desafio      TEXT,
    investimento TEXT,
    contato      TEXT NOT NULL,
    obs          TEXT,
    origem       TEXT,
    criado_em    TIMESTAMPTZ DEFAULT now()
  )`;

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
    await sql`
      INSERT INTO leads (nome, negocio, momento, desafio, investimento, contato, obs, origem)
      VALUES (${nome}, ${clip(b.negocio)}, ${clip(b.momento)}, ${clip(b.desafio)},
              ${clip(b.investimento)}, ${contato}, ${clip(b.obs)}, ${clip(b.origem) || 'site'})`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead error:', e);
    return res.status(500).json({ error: 'internal' });
  }
}
