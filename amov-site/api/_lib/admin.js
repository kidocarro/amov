// api/_lib/admin.js — sessão do painel /admin (senha única da equipe).
//
// Variáveis na Vercel:
//   ADMIN_PASSWORD        (obrigatória) senha de acesso ao painel, mínimo 10 caracteres
//   ADMIN_SESSION_SECRET  (opcional)    chave que assina o cookie. Sem ela, a chave é
//                                        derivada da senha: trocar a senha derruba todas as sessões.
//
// O cookie é HttpOnly, Secure, SameSite=Strict e assinado com HMAC-SHA256.
// Não há sessão no banco: o cookie carrega só a data de expiração e a assinatura.
import crypto from 'node:crypto';
import { responder, origemPermitida } from './seguranca.js';

export const COOKIE = '__Host-amov_admin';
export const DURACAO_SEG = 12 * 3600; // 12 horas

export function senhaConfigurada() {
  return String(process.env.ADMIN_PASSWORD || '').length >= 10;
}

function chave() {
  const e = process.env;
  const base = e.ADMIN_SESSION_SECRET || `${e.ADMIN_PASSWORD}:${e.SUPABASE_JWT_SECRET || e.POSTGRES_URL || 'amov'}`;
  return crypto.createHash('sha256').update(`amov-admin:${base}`).digest();
}

const assinar = (txt) => crypto.createHmac('sha256', chave()).update(txt).digest('base64url');

function iguais(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// compara pelo hash para não vazar o tamanho da senha pelo tempo de resposta
export function senhaConfere(tentativa) {
  const h = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  return senhaConfigurada() && crypto.timingSafeEqual(h(tentativa), h(process.env.ADMIN_PASSWORD));
}

export function criarToken(agoraSeg = Math.floor(Date.now() / 1000)) {
  const exp = String(agoraSeg + DURACAO_SEG);
  return `${exp}.${assinar(exp)}`;
}

export function tokenValido(token, agoraSeg = Math.floor(Date.now() / 1000)) {
  const [exp, sig] = String(token || '').split('.');
  if (!/^\d{9,11}$/.test(exp || '') || !sig) return false;
  if (Number(exp) <= agoraSeg || Number(exp) > agoraSeg + DURACAO_SEG + 60) return false;
  return iguais(sig, assinar(exp));
}

export function lerCookie(req, nome = COOKIE) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

export function gravarCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; Max-Age=${DURACAO_SEG}; HttpOnly; Secure; SameSite=Strict`);
}

export function apagarCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

export function autenticado(req) {
  return senhaConfigurada() && tokenValido(lerCookie(req));
}

// Barreira das rotas do painel. Retorna true se já respondeu (bloqueou).
//   metodos: métodos aceitos. Métodos que alteram dados exigem Origin do próprio site e JSON.
export function barrarAdmin(req, res, { metodos }) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!metodos.includes(req.method)) {
    res.setHeader('Allow', metodos.join(', '));
    responder(res, 405, { error: 'method not allowed' });
    return true;
  }
  if (!senhaConfigurada()) {
    responder(res, 503, { error: 'painel sem senha configurada (ADMIN_PASSWORD na Vercel)' });
    return true;
  }
  if (req.method !== 'GET') {
    if (!origemPermitida(req)) { responder(res, 403, { error: 'origem não permitida' }); return true; }
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      responder(res, 415, { error: 'envie JSON' });
      return true;
    }
  }
  if (!autenticado(req)) {
    responder(res, 401, { error: 'não autenticado' });
    return true;
  }
  return false;
}
