// api/parceiro.js — POST /api/parceiro
// Recebe a "Tabela do Parceiro" do formulário /parceiros e grava em:
//   public.parceiros          (um cadastro por CPF/CNPJ — atualizado a cada envio)
//   public.parceiro_tabelas   (cada envio = uma tabela versionada, com protocolo)
//   public.parceiro_servicos  (os serviços e faixas de valor daquela tabela)
//   public.origens            (de onde a pessoa veio: UTMs, campanha, anúncio...)
import crypto from 'node:crypto';
import { getPool, garantirSchema } from './_lib/db.js';
import { clip, clipOuNull, responder, contexto, dentroDoLimite, barrarRequisicao } from './_lib/seguranca.js';
import { lerAtribuicao, gravarOrigens } from './_lib/atribuicao.js';

const MARGEM_AMOV = 0.20;
const MAX_SERVICOS = 40;

const LIMITES = (ipHash) => [
  { chave: `parceiro:ip:${ipHash}`, limite: 5, janelaSeg: 3600 },  // 5 envios / hora por IP
  { chave: 'parceiro:global', limite: 150, janelaSeg: 3600 },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}($|\.)/.test(s)) s = s.replace(/\./g, '');
  return s === '' ? NaN : Number(s);
}
const inteiro = (v) => { const n = Math.round(numero(v)); return Number.isFinite(n) && n >= 0 && n < 100000 ? n : null; };
const lista = (v, max = 20) => (Array.isArray(v) ? v : v ? [v] : []).slice(0, max).map((x) => clip(x, 120)).filter(Boolean);
const simNao = (v) => (v === 'Sim' ? true : v === 'Não' ? false : null);

// CPF (11 dígitos) ou CNPJ (14 caracteres — numérico ou alfanumérico, vigente desde 07/2026)
function documento(v) {
  const d = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^\d{11}$/.test(d)) return { documento: d, tipo: 'cpf' };
  if (/^[0-9A-Z]{12}\d{2}$/.test(d)) return { documento: d, tipo: 'cnpj' };
  return null;
}

function protocolo() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return 'AMV-' + [...bytes].map((x) => abc[x % abc.length]).join('');
}

function especificacoes(v) {
  const out = {};
  if (Array.isArray(v)) {
    v.slice(0, 30).forEach((linha, i) => {
      const s = clip(linha, 600);
      const j = s.indexOf(':');
      if (j > 0) out[s.slice(0, j).trim()] = s.slice(j + 1).trim(); else if (s) out[`item_${i + 1}`] = s;
    });
  } else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v).slice(0, 30)) {
      out[clip(k, 120)] = Array.isArray(val) ? lista(val) : clip(val, 600);
    }
  }
  return out;
}

function validar(b) {
  const erros = [];
  const p = b.parceiro && typeof b.parceiro === 'object' ? b.parceiro : {};
  const c = b.condicoes && typeof b.condicoes === 'object' ? b.condicoes : {};
  const servicos = Array.isArray(b.servicos) ? b.servicos : [];

  const doc = documento(p.doc);
  if (!doc) erros.push('parceiro.doc');
  for (const k of ['nome', 'empresa', 'tipo', 'cidade', 'remoto', 'whatsapp', 'email', 'portfolio', 'experiencia', 'nf', 'modelo']) {
    if (!clip(p[k])) erros.push(`parceiro.${k}`);
  }
  if (p.email && !EMAIL.test(String(p.email).trim())) erros.push('parceiro.email');
  if (String(p.whatsapp || '').replace(/\D/g, '').length < 10) erros.push('parceiro.whatsapp');
  if (!lista(p.areas).length) erros.push('parceiro.areas');
  if (inteiro(p.capacidade) === null) erros.push('parceiro.capacidade');
  if (!clip(c.validade)) erros.push('condicoes.validade');
  if (!clip(c.reajuste)) erros.push('condicoes.reajuste');
  if (!servicos.length || servicos.length > MAX_SERVICOS) erros.push('servicos');

  const svc = servicos.slice(0, MAX_SERVICOS).map((s, i) => {
    s = s && typeof s === 'object' ? s : {};
    const min = numero(s.min), max = numero(s.max);
    for (const k of ['area', 'servico', 'descricao', 'incluso', 'naoIncluso', 'unidade', 'criterio', 'pagamento']) {
      if (!clip(s[k])) erros.push(`servicos.${i}.${k}`);
    }
    if (!(min > 0) || min >= 1e10) erros.push(`servicos.${i}.min`);
    if (!(max > 0) || max < min || max >= 1e10) erros.push(`servicos.${i}.max`);
    if (inteiro(s.prazo) === null) erros.push(`servicos.${i}.prazo`);
    if (inteiro(s.revisoes) === null) erros.push(`servicos.${i}.revisoes`);
    const extra = s.extra === '' || s.extra == null ? null : numero(s.extra);
    return {
      ordem: i + 1,
      area: clip(s.area, 80),
      servico: clip(s.servico, 200),
      descricao: clipOuNull(s.descricao, 600),
      incluso: clipOuNull(s.incluso, 4000),
      nao_incluso: clipOuNull(s.naoIncluso, 4000),
      unidade: clipOuNull(s.unidade, 40),
      valor_min: Math.round(min * 100) / 100,
      valor_max: Math.round(max * 100) / 100,
      criterio: clipOuNull(s.criterio, 4000),
      prazo_dias: inteiro(s.prazo),
      revisoes: inteiro(s.revisoes),
      valor_extra: Number.isFinite(extra) && extra > 0 && extra < 1e10 ? Math.round(extra * 100) / 100 : null,
      pagamento: clipOuNull(s.pagamento, 60),
      custos: lista(s.custos),
      requisitos: clipOuNull(s.requisitos, 4000),
      exemplo_url: clipOuNull(s.exemplo, 500),
      especificacoes: especificacoes(s.especificacoes),
    };
  });

  return {
    erros,
    doc,
    parceiro: {
      nome: clip(p.nome, 160), empresa: clip(p.empresa, 160), tipo_cadastro: clipOuNull(p.tipo, 40),
      cidade: clipOuNull(p.cidade, 120), remoto: clipOuNull(p.remoto, 40),
      whatsapp: clipOuNull(p.whatsapp, 40), email: clipOuNull(String(p.email || '').toLowerCase(), 200),
      portfolio: clipOuNull(p.portfolio, 500), redes: clipOuNull(p.redes, 300),
      areas: lista(p.areas), experiencia: clipOuNull(p.experiencia, 40), emite_nf: simNao(p.nf),
      modelo_parceria: clipOuNull(p.modelo, 40), capacidade: inteiro(p.capacidade),
    },
    condicoes: {
      validade: clipOuNull(c.validade, 40), reajuste: clipOuNull(c.reajuste, 40),
      cancelamento: clipOuNull(c.cancelamento, 1000), observacoes: clipOuNull(c.observacoes, 4000),
    },
    aceites: lista(b.aceites, 10).map((x) => clip(x, 400)),
    enviadoEm: (() => { const d = new Date(b.enviadoEm); return Number.isNaN(d.getTime()) ? null : d.toISOString(); })(),
    servicos: svc,
  };
}

export default async function handler(req, res) {
  if (barrarRequisicao(req, res, { maxBytes: 256 * 1024 })) return;

  const b = req.body;
  if (b.website) return responder(res, 200, { ok: true, protocolo: protocolo() }); // honeypot

  const v = validar(b);
  if (v.erros.length) {
    return responder(res, 400, { error: 'dados inválidos', campos: v.erros.slice(0, 20) });
  }

  let client;
  try {
    await garantirSchema();
    client = await getPool().connect();
    const ctx = contexto(req);
    if (!(await dentroDoLimite(client, LIMITES(ctx.ip_hash || 'sem-ip')))) {
      res.setHeader('Retry-After', '3600');
      return responder(res, 429, { error: 'muitos envios, tente de novo mais tarde' });
    }
    const atrib = lerAtribuicao(b, req);
    const p = v.parceiro;
    const prot = protocolo();

    await client.query('begin');
    const rp = await client.query(
      `insert into public.parceiros
         (documento, tipo_documento, nome, empresa, tipo_cadastro, cidade, remoto, whatsapp, email,
          portfolio, redes, areas, experiencia, emite_nf, modelo_parceria, capacidade)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (documento) do update set
         tipo_documento = excluded.tipo_documento, nome = excluded.nome, empresa = excluded.empresa,
         tipo_cadastro = excluded.tipo_cadastro, cidade = excluded.cidade, remoto = excluded.remoto,
         whatsapp = excluded.whatsapp, email = excluded.email, portfolio = excluded.portfolio,
         redes = excluded.redes, areas = excluded.areas, experiencia = excluded.experiencia,
         emite_nf = excluded.emite_nf, modelo_parceria = excluded.modelo_parceria,
         capacidade = excluded.capacidade, total_envios = public.parceiros.total_envios + 1
       returning id`,
      [v.doc.documento, v.doc.tipo, p.nome, p.empresa, p.tipo_cadastro, p.cidade, p.remoto, p.whatsapp, p.email,
        p.portfolio, p.redes, p.areas, p.experiencia, p.emite_nf, p.modelo_parceria, p.capacidade]
    );
    const parceiroId = rp.rows[0].id;

    const rt = await client.query(
      `insert into public.parceiro_tabelas
         (parceiro_id, protocolo, validade, reajuste, cancelamento, observacoes, aceites, dados_parceiro,
          margem_amov, pagina, sessao_id, ip_hash, user_agent, geo_pais, geo_estado, geo_cidade, enviado_em_cliente)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning id`,
      [parceiroId, prot, v.condicoes.validade, v.condicoes.reajuste, v.condicoes.cancelamento, v.condicoes.observacoes,
        JSON.stringify(v.aceites), JSON.stringify({ ...p, documento: v.doc.documento }), MARGEM_AMOV,
        atrib.pagina, atrib.sessao_id, ctx.ip_hash, ctx.user_agent, ctx.geo_pais, ctx.geo_estado, ctx.geo_cidade,
        v.enviadoEm]
    );
    const tabelaId = rt.rows[0].id;

    for (const s of v.servicos) {
      await client.query(
        `insert into public.parceiro_servicos
           (tabela_id, parceiro_id, ordem, area, servico, descricao, incluso, nao_incluso, unidade,
            valor_min, valor_max, margem_amov, criterio, prazo_dias, revisoes, valor_extra, pagamento,
            custos, requisitos, exemplo_url, especificacoes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)`,
        [tabelaId, parceiroId, s.ordem, s.area, s.servico, s.descricao, s.incluso, s.nao_incluso, s.unidade,
          s.valor_min, s.valor_max, MARGEM_AMOV, s.criterio, s.prazo_dias, s.revisoes, s.valor_extra, s.pagamento,
          s.custos, s.requisitos, s.exemplo_url, JSON.stringify(s.especificacoes)]
      );
    }

    await gravarOrigens(client, { coluna: 'parceiro_tabela_id', id: tabelaId }, atrib.toques);
    await client.query('commit');

    return responder(res, 200, { ok: true, protocolo: prot });
  } catch (e) {
    if (client) await client.query('rollback').catch(() => {});
    console.error('parceiro error:', e);
    return responder(res, 500, { error: 'internal' });
  } finally {
    if (client) client.release();
  }
}
