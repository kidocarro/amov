// api/admin-dados.js — GET /api/admin-dados (exige sessão do painel)
// Devolve todos os parceiros com o histórico de tabelas, os serviços de cada
// tabela e a origem (último toque) de cada envio. O painel monta os filtros,
// os totais e as comparações de preço no navegador.
import { getPool, garantirSchema } from './_lib/db.js';
import { responder } from './_lib/seguranca.js';
import { barrarAdmin } from './_lib/admin.js';

const num = (v) => (v == null ? null : Number(v));

export default async function handler(req, res) {
  if (barrarAdmin(req, res, { metodos: ['GET'] })) return;

  let client;
  try {
    await garantirSchema();
    client = await getPool().connect();

    const [rp, rt, rs] = await Promise.all([
      client.query(`
        select id::int as id, documento, tipo_documento, nome, empresa, tipo_cadastro, cidade, remoto, whatsapp, email,
               portfolio, redes, areas, experiencia, emite_nf, modelo_parceria, capacidade, status,
               notas_internas, status_alterado_em, total_envios, criado_em, atualizado_em
          from public.parceiros
         order by atualizado_em desc`),
      client.query(`
        select t.id::int as id, t.parceiro_id::int as parceiro_id, t.protocolo, t.validade, t.reajuste, t.cancelamento, t.observacoes,
               t.aceites, t.margem_amov, t.criado_em, t.geo_cidade, t.geo_estado,
               u.canal, u.utm_source, u.utm_medium, u.utm_campaign, u.adset_name, u.ad_name, u.referrer
          from public.parceiro_tabelas t
          left join public.origens u on u.parceiro_tabela_id = t.id and u.toque = 'ultimo'
         order by t.criado_em desc`),
      client.query(`
        select id::int as id, tabela_id::int as tabela_id, ordem, area, servico, descricao, incluso, nao_incluso, unidade,
               valor_min, valor_max, valor_cliente_min, valor_cliente_max, criterio, prazo_dias, revisoes,
               valor_extra, pagamento, custos, requisitos, exemplo_url, especificacoes
          from public.parceiro_servicos
         order by tabela_id, ordem`),
    ]);

    const servicosPorTabela = new Map();
    for (const s of rs.rows) {
      const item = {
        ...s,
        valor_min: num(s.valor_min), valor_max: num(s.valor_max),
        valor_cliente_min: num(s.valor_cliente_min), valor_cliente_max: num(s.valor_cliente_max),
        valor_extra: num(s.valor_extra),
      };
      delete item.tabela_id;
      if (!servicosPorTabela.has(s.tabela_id)) servicosPorTabela.set(s.tabela_id, []);
      servicosPorTabela.get(s.tabela_id).push(item);
    }

    const tabelasPorParceiro = new Map();
    for (const t of rt.rows) {
      const { canal, utm_source, utm_medium, utm_campaign, adset_name, ad_name, referrer, parceiro_id, ...resto } = t;
      const tabela = {
        ...resto,
        margem_amov: num(t.margem_amov),
        origem: { canal, utm_source, utm_medium, utm_campaign, adset_name, ad_name, referrer },
        servicos: servicosPorTabela.get(t.id) || [],
      };
      if (!tabelasPorParceiro.has(parceiro_id)) tabelasPorParceiro.set(parceiro_id, []);
      tabelasPorParceiro.get(parceiro_id).push(tabela); // já vem da mais nova para a mais antiga
    }

    const parceiros = rp.rows.map((p) => ({ ...p, tabelas: tabelasPorParceiro.get(p.id) || [] }));
    return responder(res, 200, { parceiros, gerado_em: new Date().toISOString() });
  } catch (e) {
    console.error('admin-dados error:', e);
    return responder(res, 500, { error: 'internal' });
  } finally {
    if (client) client.release();
  }
}
