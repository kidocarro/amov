// api/_lib/seguranca.js — checagens comuns das rotas de captura
import crypto from 'node:crypto';

export const clip = (v, max = 500) => {
  const s = String(v ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
};
export const clipOuNull = (v, max = 500) => clip(v, max) || null;

export function responder(res, status, corpo) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(corpo);
}

// IP do visitante (a Vercel preenche x-real-ip / x-forwarded-for)
export function ipDe(req) {
  const h = req.headers;
  const ip = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '';
  return String(ip).trim();
}

// Nunca guardamos o IP puro: só um hash com sal (LGPD).
export function hashIp(ip) {
  const sal = process.env.IP_HASH_SALT || process.env.SUPABASE_JWT_SECRET || 'amov';
  return crypto.createHash('sha256').update(`${sal}:${ip}`).digest('hex').slice(0, 32);
}

export function contexto(req) {
  const h = req.headers;
  const dec = (v) => { try { return v ? decodeURIComponent(String(v)) : null; } catch { return String(v); } };
  const ip = ipDe(req);
  return {
    ip,
    ip_hash: ip ? hashIp(ip) : null,
    user_agent: clipOuNull(h['user-agent'], 400),
    geo_pais: clipOuNull(h['x-vercel-ip-country'], 8),
    geo_estado: clipOuNull(h['x-vercel-ip-country-region'], 16),
    geo_cidade: clipOuNull(dec(h['x-vercel-ip-city']), 80),
  };
}

// Aceita apenas envios do próprio site (mesma origem) ou de domínios liberados.
export function origemPermitida(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  let host;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const proprio = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (host === proprio) return true;
  const extras = String(process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const liberados = ['amov.network', 'www.amov.network', ...extras];
  if (liberados.includes(host)) return true;
  if (process.env.VERCEL_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;
  return false;
}

export function tamanhoOk(req, maxBytes) {
  const n = Number(req.headers['content-length'] || 0);
  return !n || n <= maxBytes;
}

// Rate limit no Postgres (private.rate_limit_ok). Em caso de erro no
// banco, deixa passar (não perder lead) e registra no log.
export async function dentroDoLimite(db, regras) {
  try {
    for (const r of regras) {
      const q = await db.query('select private.rate_limit_ok($1, $2, $3) as ok', [r.chave, r.limite, r.janelaSeg]);
      if (!q.rows[0].ok) return false;
    }
    return true;
  } catch (e) {
    console.error('rate limit indisponível:', e.message);
    return true;
  }
}

// Validação comum de método/origem/tamanho. Retorna true se já respondeu.
export function barrarRequisicao(req, res, { maxBytes }) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    responder(res, 405, { error: 'method not allowed' });
    return true;
  }
  if (!origemPermitida(req)) {
    responder(res, 403, { error: 'origem não permitida' });
    return true;
  }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    responder(res, 415, { error: 'envie JSON' });
    return true;
  }
  let corpo;
  try { corpo = req.body; } catch { corpo = null; } // JSON malformado lança ao ler
  if (!tamanhoOk(req, maxBytes) || typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    responder(res, 413, { error: 'envio inválido ou grande demais' });
    return true;
  }
  return false;
}
