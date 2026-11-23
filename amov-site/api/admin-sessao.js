// api/admin-sessao.js — login do painel /admin
//   GET    → { autenticado, configurado }
//   POST   { senha } → grava o cookie de sessão (12 h)
//   DELETE → sai (apaga o cookie)
import { getPool, garantirSchema } from './_lib/db.js';
import { responder, contexto, origemPermitida } from './_lib/seguranca.js';
import { senhaConfigurada, senhaConfere, criarToken, gravarCookie, apagarCookie, autenticado } from './_lib/admin.js';

// Tentativas de login: 6 a cada 15 min por IP e 40 por hora no total.
// Diferente dos formulários, aqui o limite FALHA FECHADO: sem banco, sem login.
async function podeTentar(ipHash) {
  await garantirSchema();
  const client = await getPool().connect();
  try {
    const regras = [
      [`admin-login:ip:${ipHash}`, 6, 900],
      ['admin-login:global', 40, 3600],
    ];
    for (const [k, lim, jan] of regras) {
      const q = await client.query('select private.rate_limit_ok($1, $2, $3) as ok', [k, lim, jan]);
      if (!q.rows[0].ok) return false;
    }
    return true;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method === 'GET') {
    return responder(res, 200, { autenticado: autenticado(req), configurado: senhaConfigurada() });
  }

  if (req.method === 'DELETE') {
    if (!origemPermitida(req)) return responder(res, 403, { error: 'origem não permitida' });
    apagarCookie(res);
    return responder(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return responder(res, 405, { error: 'method not allowed' });
  }
  if (!origemPermitida(req)) return responder(res, 403, { error: 'origem não permitida' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    return responder(res, 415, { error: 'envie JSON' });
  }
  if (!senhaConfigurada()) {
    return responder(res, 503, { error: 'painel sem senha configurada (ADMIN_PASSWORD na Vercel)' });
  }

  let corpo;
  try { corpo = req.body; } catch { corpo = null; }
  const senha = corpo && typeof corpo === 'object' ? String(corpo.senha ?? '').slice(0, 200) : '';

  try {
    const ctx = contexto(req);
    if (!(await podeTentar(ctx.ip_hash || 'sem-ip'))) {
      res.setHeader('Retry-After', '900');
      return responder(res, 429, { error: 'muitas tentativas, espere 15 minutos' });
    }
  } catch (e) {
    console.error('admin login, rate limit indisponível:', e.message);
    return responder(res, 503, { error: 'banco indisponível, tente de novo' });
  }

  if (!senhaConfere(senha)) {
    await new Promise((r) => setTimeout(r, 400)); // atrasa tentativas erradas
    return responder(res, 401, { error: 'senha incorreta' });
  }

  gravarCookie(res, criarToken());
  return responder(res, 200, { ok: true });
}
