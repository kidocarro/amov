// api/lead.js — POST /api/lead
// Grava o lead no Supabase "GRAY Desert" (public.leads) e a origem dele
// (UTMs, campanha, conjunto, anúncio, click IDs...) em public.origens.
import { getPool, garantirSchema } from './_lib/db.js';
import { clip, clipOuNull, responder, contexto, dentroDoLimite, barrarRequisicao } from './_lib/seguranca.js';
import { lerAtribuicao, gravarOrigens } from './_lib/atribuicao.js';

const LIMITES = (ipHash) => [
  { chave: `lead:ip:${ipHash}`, limite: 5, janelaSeg: 600 },   // 5 envios / 10 min por IP
  { chave: 'lead:global', limite: 300, janelaSeg: 3600 },       // trava de enxurrada
];

export default async function handler(req, res) {
  if (barrarRequisicao(req, res, { maxBytes: 32 * 1024 })) return;

  const b = req.body;
  // honeypot: robôs preenchem o campo escondido. Finge sucesso e descarta.
  if (b.website) return responder(res, 200, { ok: true });

  const nome = clip(b.nome, 160);
  const contato = clip(b.contato, 200);
  if (!nome || contato.length < 6) {
    return responder(res, 400, { error: 'nome e contato são obrigatórios' });
  }

  let client;
  try {
    await garantirSchema();
    client = await getPool().connect();
    const ctx = contexto(req);
    if (!(await dentroDoLimite(client, LIMITES(ctx.ip_hash || 'sem-ip')))) {
      res.setHeader('Retry-After', '600');
      return responder(res, 429, { error: 'muitos envios, tente de novo em alguns minutos' });
    }

    const atrib = lerAtribuicao(b, req);
    const { atribuicao, website, ...semAtrib } = b;
    const payload = JSON.stringify(semAtrib).slice(0, 16000);

    await client.query('begin');
    const r = await client.query(
      `insert into public.leads
         (nome, negocio, momento, desafio, investimento, contato, obs, origem,
          pagina, sessao_id, ip_hash, user_agent, geo_pais, geo_estado, geo_cidade, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       returning id`,
      [nome, clipOuNull(b.negocio), clipOuNull(b.momento), clipOuNull(b.desafio),
        clipOuNull(b.investimento), contato, clipOuNull(b.obs, 2000), clip(b.origem, 60) || 'site',
        atrib.pagina, atrib.sessao_id, ctx.ip_hash, ctx.user_agent, ctx.geo_pais, ctx.geo_estado, ctx.geo_cidade,
        payload]
    );
    const leadId = r.rows[0].id;
    await gravarOrigens(client, { coluna: 'lead_id', id: leadId }, atrib.toques);
    await client.query('commit');

    return responder(res, 200, { ok: true });
  } catch (e) {
    if (client) await client.query('rollback').catch(() => {});
    console.error('lead error:', e);
    return responder(res, 500, { error: 'internal' });
  } finally {
    if (client) client.release();
  }
}
