// api/_lib/atribuicao.js — normaliza a origem enviada pelo js/atribuicao.js
// e grava em public.origens (um registro por toque: primeiro e último).
import { clip, clipOuNull } from './seguranca.js';

// parâmetros de URL que viram coluna própria em public.origens
export const PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'placement', 'site_source_name',
  'gclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid',
  'fbclid', 'ttclid', 'msclkid', 'li_fat_id',
];

// apelidos aceitos na URL -> coluna
const APELIDOS = {
  utm_adset: 'adset_name', utm_adset_name: 'adset_name', adset: 'adset_name',
  utm_ad: 'ad_name', utm_ad_name: 'ad_name', ad: 'ad_name',
  utm_adset_id: 'adset_id', utm_ad_id: 'ad_id', utm_campaign_id: 'campaign_id',
  utm_placement: 'placement',
};

const BUSCA = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|yandex|baidu|search\.brave)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|t\.co|twitter|x|linkedin|lnkd|tiktok|youtube|youtu|pinterest|whatsapp|wa|threads|reddit|telegram|l\.instagram|lm\.facebook)\.(com|me|in|be|net|org|co)$/i;
const PAGO = /^(cpc|ppc|cpm|cpv|paid|paid[_-]?social|paidsocial|paid[_-]?search|ads?|display|banner|retargeting|remarketing)$/i;

function hostDe(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function classificarCanal(t) {
  const s = (t.utm_source || '').toLowerCase();
  const m = (t.utm_medium || '').toLowerCase();
  const meta = /^(facebook|fb|instagram|ig|meta|an|msg|messenger|audience_network)$/.test(s) || !!t.site_source_name;
  const google = /^(google|adwords|gads|youtube)$/.test(s);
  if (t.gclid || t.gbraid || t.wbraid || t.gad_source || (google && PAGO.test(m))) return 'google_ads';
  if ((meta && (PAGO.test(m) || t.adset_id || t.ad_id)) || ((t.adset_id || t.ad_id) && t.fbclid)) return 'meta_ads';
  if (t.ttclid || (/tiktok/.test(s) && PAGO.test(m))) return 'tiktok_ads';
  if (t.msclkid) return 'microsoft_ads';
  if (t.li_fat_id || (/linkedin/.test(s) && PAGO.test(m))) return 'linkedin_ads';
  if (PAGO.test(m)) return 'pago_outros';
  if (m === 'email' || /e-?mail|newsletter/.test(s)) return 'email';
  if (/whatsapp|wpp|zap/.test(s) || /whatsapp/.test(m)) return 'whatsapp';
  if (meta || t.fbclid) return 'social';
  if (s) return /organic|social/.test(m) ? 'social' : 'campanha';
  const ref = hostDe(t.referrer);
  if (ref) {
    if (BUSCA.test(ref)) return 'organico_busca';
    if (SOCIAL.test(ref) || /instagram|facebook|linkedin|tiktok|youtube|whatsapp/.test(ref)) return 'social';
    return 'referencia';
  }
  return 'direto';
}

function limparParams(p) {
  const out = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const [k, v] of Object.entries(p).slice(0, 60)) {
    const key = clip(k, 64).toLowerCase();
    if (!key) continue;
    out[key] = clip(v, 500);
  }
  return out;
}

function dataOuNull(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// toque bruto do navegador -> linha de public.origens
export function normalizarToque(bruto, extras = {}) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const params = limparParams(b.params);
  const t = {};
  for (const k of PARAMS) t[k] = clipOuNull(params[k], 300);
  for (const [apelido, col] of Object.entries(APELIDOS)) {
    if (!t[col] && params[apelido]) t[col] = clipOuNull(params[apelido], 300);
  }
  t.referrer = clipOuNull(b.referrer, 1000);
  t.landing_page = clipOuNull(b.landing_page, 1000);
  t.capturado_em = dataOuNull(b.capturado_em);
  t.fbp = clipOuNull(extras.fbp, 200);
  t.fbc = clipOuNull(extras.fbc, 300) || (t.fbclid ? `fb.1.${Date.parse(t.capturado_em || '') || Date.now()}.${t.fbclid}` : null);
  t.ga_client_id = clipOuNull(extras.ga, 100);
  t.params = params;
  t.canal = classificarCanal(t);
  return t;
}

// lê o objeto `atribuicao` do corpo e devolve { sessao_id, pagina, toques: {primeiro, ultimo} }
export function lerAtribuicao(corpo, req) {
  const a = corpo && typeof corpo.atribuicao === 'object' && corpo.atribuicao ? corpo.atribuicao : {};
  const extras = { fbp: a.fbp, fbc: a.fbc, ga: a.ga };
  const pagina = clipOuNull(a.pagina, 1000) || clipOuNull(req.headers.referer, 1000);
  // sem script (ex.: envio antigo): usa a página atual como único toque
  const reserva = { params: {}, referrer: null, landing_page: pagina, capturado_em: new Date().toISOString() };
  const ultimo = normalizarToque(a.ultimo || a.primeiro || reserva, extras);
  const primeiro = normalizarToque(a.primeiro || a.ultimo || reserva, extras);
  return { sessao_id: clipOuNull(a.sessao_id, 64), pagina, toques: { primeiro, ultimo } };
}

const COLS = ['toque', 'canal', ...PARAMS, 'fbp', 'fbc', 'ga_client_id', 'referrer', 'landing_page', 'capturado_em', 'params'];

export async function gravarOrigens(db, dono, toques) {
  for (const toque of ['primeiro', 'ultimo']) {
    const t = { ...toques[toque], toque };
    const cols = [dono.coluna, ...COLS];
    const vals = [dono.id, ...COLS.map((c) => (c === 'params' ? JSON.stringify(t.params || {}) : t[c] ?? null))];
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    await db.query(`insert into public.origens (${cols.join(',')}) values (${ph})`, vals);
  }
}
