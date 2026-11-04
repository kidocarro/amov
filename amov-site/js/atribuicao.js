/* js/atribuicao.js — Amov Network
   Guarda de onde o visitante veio (UTMs, IDs de campanha/conjunto/anúncio,
   click IDs, referrer, página de entrada) para enviar junto com o lead.

   - primeiro toque: a primeira visita (fica guardado por 90 dias)
   - último toque: a visita mais recente que trouxe campanha ou referrer externo
     (visita direta não apaga uma campanha anterior — "último clique não direto")

   Uso: AmovAtribuicao.get() -> objeto para mandar como `atribuicao` no POST.   */
(function () {
  'use strict';
  var CHAVE = 'amov_atrib_v1';
  var VALIDADE_MS = 90 * 24 * 60 * 60 * 1000;
  var RASTREAVEIS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'utm_adset', 'utm_ad', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
    'ad_id', 'ad_name', 'placement', 'site_source_name',
    'gclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid',
    'fbclid', 'ttclid', 'msclkid', 'li_fat_id'
  ];

  var memoria = null;
  function ler() {
    try { var s = localStorage.getItem(CHAVE); return s ? JSON.parse(s) : null; } catch (e) { return memoria; }
  }
  function salvar(d) {
    memoria = d;
    try { localStorage.setItem(CHAVE, JSON.stringify(d)); } catch (e) {}
  }
  function cookie(nome) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + nome.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function uid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function semHash(u) { return String(u).split('#')[0].slice(0, 1000); }

  function toqueAtual() {
    var params = {};
    try {
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (Object.keys(params).length < 60) params[k.toLowerCase().slice(0, 64)] = String(v).slice(0, 500);
      });
    } catch (e) {}
    var ref = '';
    try {
      if (document.referrer && new URL(document.referrer).host !== location.host) ref = document.referrer;
    } catch (e) {}
    var temCampanha = RASTREAVEIS.some(function (k) { return params[k]; });
    return {
      t: { params: params, referrer: ref || null, landing_page: semHash(location.href), capturado_em: new Date().toISOString() },
      relevante: temCampanha || !!ref
    };
  }

  var d = ler() || {};
  var agora = Date.now();
  if (!d.sessao_id) d.sessao_id = uid();
  if (d.primeiro && (agora - Date.parse(d.primeiro.capturado_em || 0)) > VALIDADE_MS) { d.primeiro = null; }
  var atual = toqueAtual();
  if (!d.primeiro) d.primeiro = atual.t;
  if (!d.ultimo || atual.relevante) d.ultimo = atual.t;
  salvar(d);

  window.AmovAtribuicao = {
    get: function () {
      var x = ler() || d;
      return {
        sessao_id: x.sessao_id,
        primeiro: x.primeiro,
        ultimo: x.ultimo,
        pagina: semHash(location.href),
        fbp: cookie('_fbp'),
        fbc: cookie('_fbc'),
        ga: cookie('_ga')
      };
    }
  };
})();
