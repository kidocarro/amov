// api/_lib/documento.js — validação de CPF e CNPJ (numérico e alfanumérico, IN RFB 2.229/2024).
// Mesma regra de js/documento.js (navegador). Teste: npm test
export function limpar(v) {
  return String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
    if ((s * 10) % 11 % 10 !== Number(d[t])) return false;
  }
  return true;
}

// CNPJ: cada caractere vale (código ASCII - 48); os 2 dígitos verificadores são numéricos
export function cnpjValido(d) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let t = 12; t < 14; t++) {
    const p = pesos.slice(13 - t);
    let s = 0;
    for (let i = 0; i < t; i++) s += (d.charCodeAt(i) - 48) * p[i];
    const r = s % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(d[t])) return false;
  }
  return true;
}

export function analisar(v) {
  const d = limpar(v);
  if (d.length === 11 && cpfValido(d)) return { documento: d, tipo: 'cpf' };
  if (d.length === 14 && cnpjValido(d)) return { documento: d, tipo: 'cnpj' };
  return null;
}
