/* js/documento.js — validação de CPF e CNPJ (numérico e alfanumérico, IN RFB 2.229/2024)
   Navegador: window.AmovDocumento. Mesma regra do servidor em api/_lib/documento.js. */
(function (raiz) {
  'use strict';
  function limpar(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, ''); }

  function cpfValido(d) {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var s = 0;
      for (var i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
      var dv = (s * 10) % 11 % 10;
      if (dv !== Number(d[t])) return false;
    }
    return true;
  }

  // CNPJ: cada caractere vale (código ASCII - 48); os 2 dígitos verificadores são numéricos
  function cnpjValido(d) {
    if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
    var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (var t = 12; t < 14; t++) {
      var s = 0, p = pesos.slice(13 - t);
      for (var i = 0; i < t; i++) s += (d.charCodeAt(i) - 48) * p[i];
      var r = s % 11, dv = r < 2 ? 0 : 11 - r;
      if (dv !== Number(d[t])) return false;
    }
    return true;
  }

  function analisar(v) {
    var d = limpar(v);
    if (d.length === 11 && cpfValido(d)) return { documento: d, tipo: 'cpf' };
    if (d.length === 14 && cnpjValido(d)) return { documento: d, tipo: 'cnpj' };
    return null;
  }

  var api = { limpar: limpar, cpfValido: cpfValido, cnpjValido: cnpjValido, analisar: analisar };
  raiz.AmovDocumento = api;
})(typeof window !== 'undefined' ? window : globalThis);
