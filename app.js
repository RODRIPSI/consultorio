'use strict';
/* CONSULTÓRIO — versão 7: área clínica (senha mestra) e área administrativa (senha própria).
   Clínica: pacientes, ficha, sessões, busca, retorno, documentos recebidos, backup cifrado.
   Administrativa (admin.js): agenda, atendimentos, pagamentos, comprovantes, nota fiscal, mensagens e declarações. */

const app = document.getElementById('app');
const mostrar = (...nos) => app.replaceChildren(...nos.flat().filter(n => n != null && n !== false));
const VERSAO = 'versão 92';
// Paletas de cores (Configurações → Aparência). Fica neste aparelho, e vale já na tela de senha.
const PALETAS = [['', 'Granada (atual)', '#5B2333', '#ECEEEA'], ['marinho', 'Azul-marinho e dourado', '#1B2A4A', '#EDF0F5'], ['dourado', 'Dourado', '#8E6A22', '#F5F0E6'],
  ['esmeralda', 'Esmeralda e dourado', '#1E4D3F', '#ECF1EE'], ['noite', 'Noite e ouro (escuro)', '#D6B25E', '#0D1527'], ['vinho', 'Vinho e ouro (escuro)', '#D9B46A', '#1A1214']];
function aplicarPaleta(k) {
  const pal = PALETAS.find(x => x[0] === k) || PALETAS[0];
  if (pal[0]) document.documentElement.dataset.paleta = pal[0]; else delete document.documentElement.dataset.paleta;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', pal[0] ? pal[3] : (m.media.includes('dark') ? '#161A1B' : '#E9ECE6')));
  try { localStorage.setItem('consultorio-paleta', pal[0]); } catch { }
}
try { aplicarPaleta(localStorage.getItem('consultorio-paleta') ?? 'noite'); } catch { aplicarPaleta('noite'); }
function linhaAparencia(linha) {
  let atual = 'noite'; try { atual = localStorage.getItem('consultorio-paleta') ?? 'noite'; } catch { }
  const sel = el('select', { 'aria-label': 'Cores do app' }, PALETAS.map(([k, nome]) => el('option', { value: k, text: nome })));
  sel.value = atual;
  sel.addEventListener('change', () => aplicarPaleta(sel.value));
  return linha('imagem', 'Cores do app', 'Muda na hora. Vale só para este aparelho.', sel);
}
let modo = null;              // 'dono' (senha mestra: tudo) ou 'adm' (senha do administrativo: só a parte administrativa)

let pacientes = [];          // decifrados, só na memória enquanto desbloqueado
let sessoes = [];            // todas as sessões, idem
const pendentes = new Map(); // alterações ainda não gravadas (chave → objeto)
let timerSalvar = null;
let filaGravacao = Promise.resolve();
let ultimaAtividade = Date.now();
let config = { bloqueioMin: 5 };
let ignorarOcultacao = false; // durante biometria, compartilhamento e escolha de arquivo
let verArquivados = false;
let filtroPacientes = 'atuais';   // versão 63: 'atuais' (atendendo agora) ou 'todos'
// "Atendendo agora": tem horário fixo na agenda, sessão marcada daqui para frente, ou foi atendido nos últimos 45 dias.
function atendendoAgora(p) {
  if (p.arquivado) return false;
  const limite = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const c = typeof cadastroDe === 'function' ? cadastroDe(p.id) : null;
  if (c?.encerradoEm) {   // versão 70: encerrado só volta se tiver horário ou sessão nova depois do encerramento
    const hoje = hojeISO();
    return horariosDe(c).some(h => h.hora && (!h.fim || h.fim > hoje)) || (c.avulsos || []).some(a => a.data > c.encerradoEm)
      || atendimentosDe(c.id).some(a => a.data > c.encerradoEm && a.presenca && a.presenca !== 'cancelada');
  }
  if (sessoesDe(p.id).some(s => (s.data || '') >= limite)) return true;
  if (!c || c.arquivado) return false;
  if (c.emAtendimento) return true;   // versão 77: incluído à mão em Atendendo agora
  if (typeof horariosDe === 'function' && horariosDe(c).some(h => h.hora && (!h.fim || h.fim > hojeISO()))) return true;
  return typeof atendimentosDe === 'function' && atendimentosDe(c.id).some(a => !a.divida && a.data >= limite && a.presenca !== 'cancelada');
}
let termoBusca = '';
let recentesPrimeiro = true;
let importacao = null;       // prévia da importação (só na memória)
let planilha = null;         // prévia da importação de planilha (só na memória)

// ---------- Utilidades ----------
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    // Estilo pelo CSSOM: a política de segurança do app bloqueia o atributo style escrito direto.
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f);
  return e;
}

const ICONES = {
  sino: [['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' }], ['path', { d: 'M10.3 21a1.94 1.94 0 0 0 3.4 0' }]],
  voltar: [['path', { d: 'M15 18l-6-6 6-6' }]],
  seguinte: [['path', { d: 'M9 18l6-6-6-6' }]],
  cadeado: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  ajustes: [['path', { d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }],
    ['circle', { cx: 15, cy: 6, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 17, cy: 18, r: 2 }]],
  mais: [['path', { d: 'M12 5v14M5 12h14' }]],
  opcoes: [['circle', { cx: 12, cy: 5, r: 1.2 }], ['circle', { cx: 12, cy: 12, r: 1.2 }], ['circle', { cx: 12, cy: 19, r: 1.2 }]],
  busca: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M20 20l-4-4' }]],
  calendario: [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M8 3v4M16 3v4' }]],
  retomar: [['path', { d: 'M3 12a9 9 0 1 0 3-6.7' }], ['path', { d: 'M3 4v5h5' }]],
  sessoes: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['circle', { cx: 4.5, cy: 6, r: 1 }], ['circle', { cx: 4.5, cy: 12, r: 1 }], ['circle', { cx: 4.5, cy: 18, r: 1 }]],
  pessoa: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
  alvo: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 5 }], ['circle', { cx: 12, cy: 12, r: 1 }]],
  repetir: [['path', { d: 'M17 2l4 4-4 4' }], ['path', { d: 'M3 11V9a3 3 0 0 1 3-3h15' }], ['path', { d: 'M7 22l-4-4 4-4' }], ['path', { d: 'M21 13v2a3 3 0 0 1-3 3H3' }]],
  nota: [['path', { d: 'M4 4h16v11l-5 5H4z' }], ['path', { d: 'M15 20v-5h5' }]],
  lixeira: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' }]],
  escudo: [['path', { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }], ['path', { d: 'M9 12l2 2 4-4' }]],
  relogio: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  tag: [['path', { d: 'M3 12V3h9l9 9-9 9z' }], ['circle', { cx: 7.5, cy: 7.5, r: 1.5 }]],
  ordenar: [['path', { d: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4' }]],
  texto: [['path', { d: 'M4 6h16M4 12h16M4 18h10' }]],
  arquivo: [['path', { d: 'M14 3H6v18h12V7z' }], ['path', { d: 'M14 3v4h4M9 13h6M9 17h6' }]],
  tabela: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M3 15h18M9 4v16' }]],
  colar: [['rect', { x: 6, y: 4, width: 12, height: 17, rx: 2 }], ['path', { d: 'M9 4V3h6v1M9 10h6M9 14h6' }]],
  mensagem: [['path', { d: 'M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z' }]],
  telefone: [['path', { d: 'M5 3.5h3.5l2 5-2.4 1.5a11 11 0 0 0 5.4 5.4l1.5-2.4 5 2v3.5a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2z' }]],
  clipe: [['path', { d: 'M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.8-8.8a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9' }]],
  assinar: [['path', { d: 'M4 20h4.5L19.5 9 15 4.5 4 15.5z' }], ['path', { d: 'M13 6.5l4.5 4.5M13 20h7' }]],
  caixa: [['rect', { x: 3, y: 4, width: 18, height: 5, rx: 1.5 }], ['path', { d: 'M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4' }]],
  imagem: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['circle', { cx: 9, cy: 10, r: 2 }], ['path', { d: 'M21 16l-5-5-10 9' }]],
  bolo: [['path', { d: 'M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7' }], ['path', { d: 'M5 16c1.5 1 2.5 1 3.5 0s2-1 3.5 0 2.5 1 3.5 0 2-1 3.5 0' }], ['path', { d: 'M12 12V8M12 5.5c-.8-.8-.8-1.7 0-2.5.8.8.8 1.7 0 2.5z' }]],
  triangulo: [['path', { d: 'M12 4L21 19.5H3z' }]],
  moeda: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M15 9.4c-.5-.9-1.6-1.4-3-1.4-1.8 0-3 .9-3 2.1 0 2.8 6 1.5 6 4.3 0 1.2-1.2 2.1-3 2.1-1.5 0-2.6-.6-3.1-1.6M12 6.3V8M12 16.3V18' }]]
};
function icone(nome) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ic');
  for (const [tag, attrs] of ICONES[nome]) {
    const f = document.createElementNS(ns, tag);
    for (const [a, v] of Object.entries(attrs)) f.setAttribute(a, v);
    svg.append(f);
  }
  return svg;
}
const botaoIcone = (rotulo, nome, acao, extra = '') =>
  el('button', { type: 'button', class: 'icone ' + extra, 'aria-label': rotulo, title: rotulo, onclick: acao }, icone(nome));

const semAcento = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const dataBR = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
function hojeISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function dataCurta(ymd) { if (!ymd) return ''; const [a, m, d] = ymd.split('-'); return `${d}/${m}/${a}`; }
function paraData(ymd) { const [a, m, d] = ymd.split('-').map(Number); return new Date(a, m - 1, d); }
const diaSemana = ymd => paraData(ymd).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const mesAno = ymd => paraData(ymd).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '').replace(' de ', ' ');
function diasDesde(ymd) { const h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((h - paraData(ymd)) / 86400000); }
function relativo(ymd) {
  const n = diasDesde(ymd);
  if (n === 0) return 'hoje';
  if (n === 1) return 'ontem';
  if (n === -1) return 'amanhã';
  if (n < 0) return `em ${-n} dias`;
  if (n < 7) return `há ${n} dias`;
  if (n < 60) { const s = Math.round(n / 7); return `há ${s} semana${s > 1 ? 's' : ''}`; }
  if (n < 365) { const m = Math.round(n / 30); return `há ${m} meses`; }
  const an = Math.floor(n / 365); return `há ${an} ano${an > 1 ? 's' : ''}`;
}
function idade(ymd) {
  if (!ymd) return null;
  const [a, m, d] = ymd.split('-').map(Number); const h = new Date();
  let i = h.getFullYear() - a;
  if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) i--;
  return i >= 0 && i < 130 ? i : null;
}
function iniciais(nome) { const p = nome.trim().split(/\s+/); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function corDe(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'c' + (h % 6 + 1); }
const avatar = (p, grande = false) => el('span', { class: `avatar ${corDe(p.id)}${grande ? ' grande' : ''}`, 'aria-hidden': 'true', text: iniciais(p.nome) });
const listaTemas = txt => (txt || '').split(/[,;\n]/).map(t => t.trim()).filter(Boolean);
function trecho(txt, n = 180) { const t = (txt || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t; }
const STATUS = { realizada: 'Realizada', falta: 'Falta', remarcada: 'Remarcada' };
const chaveSessao = s => `s:${s.pid}:${s.id}`;
function sessoesDe(pid) {
  return sessoes.filter(s => s.pid === pid).sort((a, b) =>
    a.data < b.data ? -1 : a.data > b.data ? 1 : (a.criadoEm < b.criadoEm ? -1 : 1));
}
function crescer(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

function cabecalho(titulo, { voltar = false, acoes = [], sub = null, status = false, grande = false } = {}) {
  return el('header', { class: 'topo' + (grande ? ' topo-grande' : '') },
    voltar && botaoIcone('Voltar', 'voltar', () => history.back()),
    el('div', { class: 'titulo' },
      el('h1', { id: 'titulo-tela', text: titulo }),
      (sub || status) && el('div', { class: 'sub' },
        sub && el('span', { text: sub }),
        status && el('span', { id: 'status', class: 'status', 'aria-live': 'polite' }))),
    el('div', { class: 'acoes' }, ...acoes));
}
const cartao = (titulo, ic, ...conteudo) => el('section', { class: 'cartao' },
  el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone(ic)), el('span', { text: titulo })), ...conteudo);
const selo = status => el('span', { class: 'selo ' + status, text: STATUS[status] });

// Janela de diálogo genérica. Com campos, devolve os valores digitados; sem campos, o valor do botão.
function dialogo({ titulo, texto = '', campos = [], botoes }) {
  return new Promise(resolve => {
    const d = el('dialog', { class: 'dialogo' });
    const entradas = campos.map(c => el('input', {
      type: c.tipo || 'text', placeholder: c.rotulo, 'aria-label': c.rotulo, autocomplete: c.autocomplete || 'off', value: c.valor || ''
    }));
    const fim = v => { d.close(); d.remove(); resolve(v); };
    const valorCampos = () => entradas.length === 1 ? entradas[0].value : entradas.map(i => i.value);
    botoes = botoes || [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Confirmar', valor: true, estilo: 'primario' }];
    const principal = botoes[botoes.length - 1];
    entradas.forEach((inp, i) => inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i < entradas.length - 1) entradas[i + 1].focus();
      else fim(campos.length ? valorCampos() : principal.valor);
    }));
    d.addEventListener('cancel', e => { e.preventDefault(); fim(null); });
    d.append(
      el('h2', { text: titulo }),
      texto && el('p', { text: texto }),
      ...entradas,
      el('div', { class: 'botoes' }, ...botoes.map(b => el('button', {
        type: 'button', class: b.estilo || 'secundario', text: b.rotulo,
        onclick: () => fim(b.valor === true && campos.length ? valorCampos() : b.valor)
      }))));
    document.body.append(d);
    d.showModal();
    entradas[0]?.focus();
  });
}
const aviso = (titulo, texto) => dialogo({ titulo, texto, botoes: [{ rotulo: 'Entendi', valor: true, estilo: 'primario' }] });
function fecharDialogos() { document.querySelectorAll('dialog').forEach(d => { d.close(); d.remove(); }); }

// ---------- Gravação automática ----------
function indicarStatus(texto, erro = false) {
  const s = document.getElementById('status');
  if (!s) return;
  s.textContent = texto;
  s.classList.toggle('erro', erro);
}
function agendarSalvar(chave, obj) {
  pendentes.set(chave, obj);
  indicarStatus('Salvando…');
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(salvarAgora, 700);
}
function salvarAgora() {
  clearTimeout(timerSalvar);
  timerSalvar = null;
  if (pendentes.size) {
    const itens = [...pendentes];
    pendentes.clear();
    filaGravacao = filaGravacao
      .then(async () => {
        const agora = new Date().toISOString();
        for (const [k, o] of itens) { o.atualizadoEm = agora; await Cofre.salvar(k, o); }
      })
      .then(() => indicarStatus('Salvo'))
      .catch(() => indicarStatus('Não foi possível salvar. Tente de novo.', true));
  }
  return filaGravacao;
}

// ---------- Bloqueio ----------
async function trancar() {
  if (!Cofre.aberto()) return;
  app.replaceChildren();   // tira os dados da tela imediatamente
  fecharDialogos();
  await salvarAgora();      // grava o que estava sendo digitado
  Cofre.trancar();
  pacientes = []; sessoes = []; importacao = null; planilha = null;
  perfil = null; assinatura = null; documentos = []; rascunhoMsg = {}; declaracao = null; senhaBackup = null; termoGeral = ''; numeros = null;
  limparAdm(); modo = null;
  telaBloqueio();
}
// Versão 32: ao sair para outro app, o Consultório só pede a senha de novo se ficar fora mais que o tempo escolhido
// (padrão 10 minutos). Enquanto está fora, o conteúdo fica embaçado na lista de apps recentes e o que foi digitado é gravado.
// Versão 62: tempos mais longos e a opção "Só pelo cadeado" — o app fica aberto até a pessoa tocar no 🔒.
const TEMPOS_BLOQ = [1, 2, 5, 10, 15, 30, 60, 240, 480, -1];
const nomeTempo = m => m === -1 ? 'Só pelo cadeado 🔒' : m === 0 ? 'Na hora' : m >= 60 ? (m / 60) + (m === 60 ? ' hora' : ' horas') : m + (m === 1 ? ' minuto' : ' minutos');
function seletorTempo(rotulo, atual, aoMudar, comZero = false) {
  const sel = el('select', { 'aria-label': rotulo }, ...(comZero ? [0, ...TEMPOS_BLOQ.filter(m => m !== 2)] : TEMPOS_BLOQ).map(m => el('option', { value: String(m), text: nomeTempo(m) })));
  sel.value = String(atual);
  const anterior = String(atual);
  sel.addEventListener('change', async () => {
    const v = Number(sel.value);
    if (v === -1) {
      const ok = await dialogo({ titulo: 'Só pelo cadeado?', texto: modo === 'dono'
        ? 'O app não vai se fechar sozinho: fica aberto até você tocar no 🔒. Neste aparelho há dados clínicos; use só se o tablet tiver bloqueio de tela do Android (senha, digital ou padrão) e não ficar com outras pessoas.'
        : 'O app não vai se fechar sozinho: fica aberto até tocar no 🔒. Use só se o celular tiver bloqueio de tela do Android (senha, digital ou padrão).',
        botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Usar assim', valor: true, estilo: 'primario' }] });
      if (!ok) { sel.value = anterior; return; }
    }
    await aoMudar(v);
  });
  return sel;
}
let saiuEm = 0;
const minutosFora = () => config.foraMin ?? 10;
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('app-oculto', document.hidden && Cofre.aberto());
  if (document.hidden && Cofre.aberto() && !ignorarOcultacao) {
    if (minutosFora() === 0) { trancar(); return; }
    saiuEm = Date.now(); salvarAgora();
  } else if (!document.hidden) {
    if (saiuEm && Cofre.aberto()) {
      const fora = Date.now() - saiuEm; saiuEm = 0;
      if (minutosFora() > 0 && fora > minutosFora() * 60000) { trancar(); return; }
      ultimaAtividade = Date.now();
    }
    verificarInatividade();
  }
});
['pointerdown', 'keydown', 'input', 'scroll'].forEach(ev =>
  document.addEventListener(ev, () => { ultimaAtividade = Date.now(); }, { passive: true, capture: true }));
function verificarInatividade() {
  if (Cofre.aberto() && config.bloqueioMin > 0 && Date.now() - ultimaAtividade > config.bloqueioMin * 60000) trancar();
}
setInterval(verificarInatividade, 10000);

// ---------- Navegação ----------
const TELAS_CLINICAS = ['pacientes', 'ficha', 'sessao', 'importar', 'planilha', 'busca', 'perfil', 'letrat', 'numeros', 'compilado', 'modelosAnamnese', 'normas', 'caderno', 'drivePaciente'];
function render(s) {
  if (telaCadernoSair && history.state?.tela !== 'caderno') { telaCadernoSair(); telaCadernoSair = null; }
  if (modo === 'adm' && (!s || s.tela === 'lista' || TELAS_CLINICAS.includes(s.tela))) { telaInicioAdm(); return; }
  if (s && renderAdm(s)) return;
  if (!s || s.tela === 'lista') telaLista();
  else if (s.tela === 'pacientes') telaLista(true);
  else if (s.tela === 'ficha') telaFicha(s.id, s.aba || 'retomar');
  else if (s.tela === 'sessao') telaSessao(s.pid, s.sid);
  else if (s.tela === 'config') (modo === 'adm' ? telaConfigAdm() : telaConfig());
  else if (s.tela === 'importar') telaImportar(s.pid);
  else if (s.tela === 'planilha') telaPlanilha();
  else if (s.tela === 'perfil') telaPerfil();
  else if (s.tela === 'declaracao') telaDeclaracao(s.pid);
  else if (s.tela === 'busca') telaBuscaGeral();
  else if (s.tela === 'letrat') telaLetraT(s.id);
  else if (s.tela === 'numeros') telaNumeros();
  else if (s.tela === 'compilado') telaCompilado(s.pid);
  else if (s.tela === 'modelosAnamnese') telaModelosAnamnese(s.modelo);
  else if (s.tela === 'normas') telaNormas(s.id, s.q);
  else if (s.tela === 'caderno') telaCaderno(s.pid, s.fid);
  else if (s.tela === 'drivePaciente') telaDrivePaciente(s.pid, s.pasta, s.nome);
}
function ir(estado, empilhar = true) {
  if (telaCadernoSair) { telaCadernoSair(); telaCadernoSair = null; }
  salvarAgora();
  const antes = history.state || {};
  const mudou = antes.tela !== estado.tela || antes.id !== estado.id || antes.sid !== estado.sid || antes.aba !== estado.aba;
  if (empilhar) history.pushState(estado, ''); else history.replaceState(estado, '');
  render(estado);
  if (mudou) window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  if (!Cofre.aberto()) return;
  salvarAgora();
  render(e.state);
  window.scrollTo(0, 0);
});

async function entrar() {
  ultimaAtividade = Date.now();
  modo = 'dono';
  await Cofre.garantirChaveAdm();
  await Cofre.garantirChavesEntrada();
  [pacientes, sessoes] = await Promise.all([Cofre.lerTodos('p:'), Cofre.lerTodos('s:')]);
  await carregarExtras();
  await carregarAdm();
  await migrarParaV7();
  await sincronizarCadastros();
  await sincronizarAtendimentos();
  await salvarAgora();
  history.replaceState({ tela: 'lista' }, '');
  if (!(await abrirEntradaSePendente())) telaLista();
}

// ---------- Telas de entrada ----------
function porta(...conteudo) {
  return el('section', { class: 'porta' },
    el('img', { src: 'icone-192.png', alt: '', class: 'marca', width: '76', height: '76' }),
    el('h1', { text: 'Consultório' }),
    ...conteudo);
}

function telaCriacao() {
  const s1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Senha mestra', 'aria-label': 'Senha mestra' });
  const s2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha', 'aria-label': 'Repita a senha' });
  const msg = el('p', { class: 'erro-msg', role: 'alert' });
  const botao = el('button', { type: 'button', class: 'primario', text: 'Criar cofre' });
  botao.addEventListener('click', async () => {
    msg.textContent = '';
    if (s1.value.length < 8) { msg.textContent = 'Use pelo menos 8 caracteres.'; return; }
    if (s1.value !== s2.value) { msg.textContent = 'As duas senhas estão diferentes.'; return; }
    botao.disabled = true;
    botao.textContent = 'Criando…';
    await Cofre.criar(s1.value);
    s1.value = s2.value = '';
    try { await navigator.storage?.persist?.(); } catch { }
    await entrar();
  });
  mostrar(porta(
    el('p', { class: 'suave centro', text: 'Crie a senha mestra que protege todos os registros deste aparelho.' }),
    s1, s2, msg, botao,
    el('p', { class: 'nota-alerta', text: 'Não existe recuperação de senha. Se ela for esquecida, os registros ficam inacessíveis. Anote-a em papel e guarde em local seguro.' }),
    el('p', { class: 'suave pequeno centro', text: 'Vai trazer registros de outro aparelho? Crie a senha e depois use Configurações → Restaurar backup.' }),
    el('button', { type: 'button', class: 'link centro', text: 'Este aparelho é do administrativo', onclick: telaCriacaoAdm })
  ));
  s1.focus();
}

async function telaBloqueio() {
  app.replaceChildren();
  const duas = await Cofre.temSenhaAdm() && await Cofre.temClinica();
  const soAdm = !(await Cofre.temClinica());
  const rotuloSenha = soAdm ? 'Senha do administrativo' : 'Senha';
  const campo = el('input', { type: 'password', autocomplete: 'current-password', placeholder: rotuloSenha, 'aria-label': rotuloSenha });
  const msg = el('p', { class: 'erro-msg', role: 'alert' });
  const botao = el('button', { type: 'button', class: 'primario', text: 'Entrar' });
  const tentarSenha = async () => {
    if (!campo.value) return;
    botao.disabled = true;
    msg.textContent = '';
    let qual;
    try { qual = await Cofre.abrirComSenha(campo.value); }
    catch { msg.textContent = 'Senha incorreta.'; botao.disabled = false; campo.select(); return; }
    campo.value = '';
    if (qual === 'dono') await entrar(); else await entrarAdm();
  };
  botao.addEventListener('click', tentarSenha);
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') tentarSenha(); });

  let botaoBio = null;
  if (await Cofre.biometriaAtiva()) {
    botaoBio = el('button', { type: 'button', class: 'secundario', text: 'Desbloquear com biometria' });
    botaoBio.addEventListener('click', async () => {
      msg.textContent = '';
      ignorarOcultacao = true;
      try { await Cofre.abrirComBiometria(); await entrar(); }
      catch { msg.textContent = 'Biometria não confirmada. Use a senha mestra.'; }
      finally { ignorarOcultacao = false; }
    });
  }
  if (Cofre.aberto()) return;
  mostrar(porta(campo, msg, botao, botaoBio,
    duas && el('p', { class: 'suave pequeno centro', text: 'A senha mestra abre tudo. A senha do administrativo abre agenda, pagamentos, mensagens e declarações, sem acesso às fichas e sessões.' }),
    new URLSearchParams(location.search).has('recebido') && el('p', { class: 'faixa', text: 'Comprovante recebido e guardado cifrado. Entre para escolher o paciente.' })));
  if (!botaoBio) campo.focus();
}

// ---------- Lista de pacientes ----------
function avisoBackup() {
  if (!pacientes.length) return null;
  const ult = config.ultimoBackup;
  const dias = ult ? Math.floor((Date.now() - new Date(ult)) / 86400000) : null;
  if (dias !== null && dias < 7) return null;
  return el('div', { class: 'aviso-backup' },
    el('span', { class: 'ic-bolha' }, icone('escudo')),
    el('div', {},
      el('strong', { text: dias === null ? 'Nenhum backup feito ainda' : `Último backup há ${dias} dias` }),
      el('small', { text: 'Sem backup, perder o aparelho é perder os registros.' })),
    el('button', { type: 'button', class: 'secundario compacto', text: 'Fazer', onclick: fazerBackup }));
}

// Versão 30: a tela inicial mostra o resumo do dia; a lista completa fica em "Todos os pacientes".
function telaLista(todos = false) {
  if (!todos) verArquivados = false;
  const busca = el('input', { type: 'search', placeholder: 'Procurar pelo nome', 'aria-label': 'Procurar paciente pelo nome' });
  const lista = el('div', { class: 'cartoes' });
  const ativos = pacientes.filter(p => !p.arquivado).length;
  const desenhar = () => {
    const q = semAcento(busca.value.trim());
    let itens = pacientes
      .filter(p => !!p.arquivado === verArquivados)
      .filter(p => !todos || verArquivados || filtroPacientes === 'todos' || atendendoAgora(p))
      .filter(p => !q || semAcento(p.nome).includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!todos) {
      // Na tela inicial, os nomes só aparecem quando a pessoa digita.
      if (!q) { lista.replaceChildren(); return; }
      itens = itens.slice(0, 8);
    }
    lista.replaceChildren(...itens.map(p => {
      const ss = sessoesDe(p.id);
      const ult = ss[ss.length - 1];
      return el('button', { type: 'button', class: 'cartao paciente', onclick: () => ir({ tela: 'ficha', id: p.id, aba: 'retomar' }) },
        avatar(p),
        el('span', { class: 'info' },
          el('span', { class: 'nome', text: p.nome }),
          el('span', { class: 'meta' }, icone('relogio'),
            el('span', { text: ult ? `Última sessão ${relativo(ult.data)}` : 'Nenhuma sessão ainda' })),
          p.dados.frequencia && el('span', { class: 'meta' }, icone('calendario'), el('span', { text: p.dados.frequencia })),
          todos && (() => { // versões 64/65/67: valor por sessão (toque para mudar), valor do mês e quanto está devendo
            const c = typeof cadastroDe === 'function' ? cadastroDe(p.id) : null;
            if (!c) return el('span', { class: 'meta valor-editavel', role: 'button', tabindex: '0', onclick: e => { e.stopPropagation(); incluirEmAtendimento(p, () => telaLista(true)); } },
              el('span', { text: '➕ Colocar em "Atendendo agora"' }));
            const proprio = valorNum(valorNaData(c)), padrao = valorNum(perfil?.valorSessao);
            const temProprio = c.valores?.length || valorNum(c.valor);
            const t = temProprio && proprio ? `R$ ${reais(proprio)} por sessão` : padrao ? `R$ ${reais(padrao)} por sessão (valor padrão)` : 'Valor da sessão não definido';
            const tSem = c.semCobrancaDesde ? ` · 🚫 sem cobrança desde ${dataCurta(c.semCobrancaDesde)}` : '';
            const ym = hojeISO().slice(0, 7);
            const doMes = atendimentosDe(c.id).filter(a => a.data.slice(0, 7) === ym && !['cancelada', 'remarcada'].includes(a.presenca) && a.pagamento !== 'naocobrar');
            const porMes = c.modoPagamento === 'mensal' || c.modoPagamento === 'quinzenal';
            const totalMes = valorNum(c.valorMensal) || doMes.reduce((x, a) => x + valorDe(a), 0);
            const pend = atendimentosDe(c.id).filter(a => a.pagamento === 'areceber');
            const deve = pend.reduce((x, a) => x + valorDe(a), 0);
            const irPag = e => { e.stopPropagation(); ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }); };
            return [
              el('span', { class: 'meta valor-editavel', role: 'button', tabindex: '0', onclick: e => { e.stopPropagation(); alterarValorSessao(c, () => telaLista(true)); } },
                icone('moeda'), el('span', { text: t + tSem + ' ✏️' })),
              // versão 72: forma de pagamento e dia combinado, para todos
              el('span', { class: 'meta' }, icone('calendario'), el('span', { text:
                (c.modoPagamento ? `Paga ${{ sessao: 'por sessão', semanal: 'por semana', quinzenal: 'a cada quinze dias', mensal: 'por mês' }[c.modoPagamento] || c.modoPagamento}` : 'Forma de pagamento não definida')
                + (c.diaPagamento ? ` · dia ${c.diaPagamento}` : c.modoPagamento && c.modoPagamento !== 'sessao' ? ' · dia não definido' : '')
                + (porMes ? ` · ${nomeMes(ym).split(' ')[0].toLowerCase()}: R$ ${reais(totalMes)}${valorNum(c.valorMensal) ? ' (valor mensal)' : ` (${doMes.length} ${doMes.length === 1 ? 'sessão' : 'sessões'})`}` : '') })),
              // versão 92: quem pede recibo ou nota fiscal, marcado direto na lista
              typeof escolherTipoRecibo === 'function' && el('span', { class: 'meta valor-editavel' + (pedeRecibo(c) ? '' : ' suave'), role: 'button', tabindex: '0', onclick: e => { e.stopPropagation(); escolherTipoRecibo(c, () => telaLista(true)); } },
                el('span', { text: pedeRecibo(c) ? `🧾 Pede ${c.nf ? 'nota fiscal' : 'recibo'} ✏️` : '🧾 Não pede recibo ✏️' })),
              el('span', { class: 'meta valor-editavel ' + (deve || pend.length ? 'devendo' : 'em-dia'), role: 'button', tabindex: '0', onclick: irPag },
                el('span', { text: pend.length ? `⚠️ Devendo R$ ${reais(deve)}${deve ? '' : ' (valor a definir)'} — ver sessões` : '✅ Em dia' })),
              // versão 70: encerrar (parou de vir) ou retomar, direto da lista
              c.encerradoEm && !atendendoAgora(p)
                ? el('span', { class: 'meta valor-editavel', role: 'button', tabindex: '0', onclick: e => { e.stopPropagation(); retomarAtendimento(c, () => telaLista(true)); } },
                    el('span', { text: `⏹ Encerrado em ${dataCurta(c.encerradoEm)} — retomar` }))
                : atendendoAgora(p) ? el('span', { class: 'meta valor-editavel suave', role: 'button', tabindex: '0', onclick: e => { e.stopPropagation(); encerrarAtendimento(c, () => telaLista(true)); } },
                    el('span', { text: '⏹ Encerrar atendimento' }))
                  : el('span', { class: 'meta valor-editavel', role: 'button', tabindex: '0', onclick: e => { e.stopPropagation(); incluirEmAtendimento(p, () => telaLista(true)); } },
                    el('span', { text: '➕ Colocar em "Atendendo agora"' }))];
          })()),
        el('span', { class: 'contador', title: 'Sessões registradas', text: String(ss.length) }),
        icone('seguinte'));
    }));
    if (!itens.length) {
      const texto = q ? 'Nenhum nome encontrado.'
        : todos && !verArquivados && filtroPacientes === 'atuais' ? 'Ninguém com horário fixo ou sessão nos últimos 45 dias.'
        : verArquivados ? 'Nenhum paciente arquivado.' : 'Nenhum paciente cadastrado ainda.';
      lista.append(el('div', { class: 'vazio' }, el('p', { text: texto }),
        !q && !verArquivados && el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: novoPaciente }, icone('mais'), el('span', { text: 'Cadastrar paciente' }))));
    }
  };
  busca.addEventListener('input', desenhar);

  mostrar(
    todos ? cabecalho(verArquivados ? 'Arquivados' : 'Todos os pacientes', { voltar: true, sub: verArquivados ? null : `${ativos} em acompanhamento` }) : cabecalho('Consultório', {
      grande: true,
      sub: `${ativos} em acompanhamento`,
      acoes: [botaoIcone('Buscar em todos os pacientes', 'busca', () => ir({ tela: 'busca' })), botaoSincronizar(), botaoAgenda(), botaoIcone('Pagamentos do mês', 'moeda', () => ir({ tela: 'mes' })),
        botaoIcone('Bloquear agora', 'cadeado', trancar), botaoIcone('Configurações', 'ajustes', () => ir({ tela: 'config' }))]
    }),
    el('div', { class: 'conteudo' },
      todos && !verArquivados && typeof segmentoEscolha === 'function' && segmentoEscolha(
        { atuais: `Atendendo agora (${pacientes.filter(atendendoAgora).length})`, todos: `Todos (${ativos})` }, filtroPacientes,
        k => { filtroPacientes = k; telaLista(true); }, 'dois'),
      todos && !verArquivados && filtroPacientes === 'atuais' && el('p', { class: 'suave pequeno', text: 'Quem tem horário fixo na agenda, sessão marcada ou foi atendido nos últimos 45 dias.' }),
      !todos && cartaoLembretes(),
      !todos && typeof cartaoLembretesAdm === 'function' && cartaoLembretesAdm(true),
      !todos && cartaoAvisosAgenda(),
      !todos && avisoBackup(),
      !todos && cartaoEntrada(),
      !todos && cartaoAniversarios(),
      !todos && cartaoAgenda(),
      el('label', { class: 'campo-busca' }, icone('busca'), busca),
      lista,
      !todos && el('button', { type: 'button', class: 'cartao paciente todos-pacientes', onclick: () => ir({ tela: 'pacientes' }) },
        el('span', { class: 'ic-bolha' }, icone('pessoa')),
        el('span', { class: 'info' }, el('span', { class: 'nome', text: 'Todos os pacientes' }), el('span', { class: 'meta' }, el('span', { text: `${pacientes.filter(atendendoAgora).length} atendendo agora · ${ativos} cadastrados` }))),
        icone('seguinte')),
      el('div', { class: 'atalhos' },
        el('button', {
          type: 'button', class: 'atalho', onclick: () => { if (!todos) { verArquivados = true; ir({ tela: 'pacientes' }); return; } verArquivados = !verArquivados; telaLista(true); }
        }, el('span', { class: 'ic-bolha' }, icone(verArquivados ? 'pessoa' : 'caixa')),
        el('span', { text: verArquivados ? 'Pacientes ativos' : 'Arquivados' })),
        !todos && el('button', { type: 'button', class: 'atalho', onclick: () => ir({ tela: 'admInicio' }) },
          el('span', { class: 'ic-bolha' }, icone('moeda')), el('span', { text: 'Administrativo' })),
        !todos && el('button', { type: 'button', class: 'atalho', onclick: abrirPlanilha },
          el('span', { class: 'ic-bolha' }, icone('tabela')), el('span', { text: 'Importar planilha' })))),
    !verArquivados && el('button', { type: 'button', class: 'fab', 'aria-label': 'Novo paciente', title: 'Novo paciente', onclick: novoPaciente }, icone('mais'))
  );
  desenhar();
}

async function novoPaciente() {
  const nome = await dialogo({
    titulo: 'Novo paciente',
    campos: [{ rotulo: 'Nome' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Cadastrar', valor: true, estilo: 'primario' }]
  });
  if (!nome || !nome.trim()) return;
  const agora = new Date().toISOString();
  const p = {
    id: crypto.randomUUID(), nome: nome.trim(), criadoEm: agora, atualizadoEm: agora, arquivado: false,
    dados: { nascimento: '', cpf: '', telefone: '', contatoEmergencia: '', inicio: '', frequencia: '' },
    demanda: '', temas: '', observacoes: ''
  };
  await Cofre.salvar('p:' + p.id, p);
  pacientes.push(p);
  await criarCadastro({ id: p.id, nome: p.nome });
  ir({ tela: 'ficha', id: p.id, aba: 'ficha' });
}

// ---------- Ficha do paciente ----------
function telaFicha(id, aba) {
  const p = pacientes.find(x => x.id === id);
  if (!p) { telaLista(); return; }
  const ss = sessoesDe(p.id);

  const chips = [];
  const i = idade(p.dados.nascimento);
  if (i != null) chips.push(`${i} anos`);
  if (p.dados.inicio) chips.push('Desde ' + mesAno(p.dados.inicio));
  if (p.dados.frequencia) chips.push(p.dados.frequencia);
  chips.push(`${ss.length} ${ss.length === 1 ? 'sessão' : 'sessões'}`);

  if (aba === 'mensagem' || aba === 'pagamentos') { ir({ tela: 'adm', id, aba: aba === 'mensagem' ? 'mensagem' : 'pagamentos' }, false); return; }
  if (aba === 'caderno') aba = 'sessoes';   // versão 73: as folhas ficam dentro de cada sessão
  const abas = [['retomar', 'Retomar', 'retomar'], ['sessoes', 'Sessões e anotações', 'sessoes'], ['ficha', 'Ficha', 'pessoa'], ['anamnese', 'Anamnese', 'texto'], ['buscar', 'Buscar', 'busca'],
    ['recebidos', 'Recebidos', 'clipe'], ['emitidos', 'Emitidos', 'assinar']];
  const corpo = aba === 'sessoes' ? abaSessoes(p, ss)
    : aba === 'ficha' ? abaFicha(p)
      : aba === 'anamnese' ? abaAnamnese(p)
      : aba === 'caderno' ? abaCaderno(p)
      : aba === 'buscar' ? abaBuscar(p, ss)
        : aba === 'recebidos' ? abaRecebidos(p)
          : aba === 'emitidos' ? abaEmitidos(p)
            : abaRetomar(p, ss);

  mostrar(
    cabecalho(p.nome, { voltar: true, status: true, acoes: [
      botaoLembretes(p),
      botaoIcone('Letra T', 'triangulo', () => ir({ tela: 'letrat', id: p.id })),
      botaoIcone('Agenda, pagamentos e mensagens', 'moeda', () => ir({ tela: 'adm', id: p.id, aba: 'atendimentos' })),
      botaoIcone('Opções do paciente', 'opcoes', () => opcoesPaciente(p))] }),
    el('div', { class: 'conteudo' },
      p.arquivado && el('p', { class: 'faixa', text: 'Paciente arquivado. Os registros continuam guardados.' }),
      lembretesPendentes(p).map(l => el('p', { class: 'faixa', style: 'border-left:5px solid #b26a00', text: '🔔 ' + l.texto })),
      el('section', { class: 'hero' }, avatar(p, true),
        el('div', { class: 'hero-texto' },
          el('h2', { id: 'nome-hero', text: p.nome }),
          el('div', { class: 'chips' }, chips.map(c => el('span', { class: 'chip', text: c }))))),
      el('nav', { class: 'abas seis', role: 'tablist' }, abas.map(([k, rotulo, ic]) => el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(k === aba), class: 'aba' + (k === aba ? ' ativa' : ''),
        onclick: () => ir({ tela: 'ficha', id, aba: k }, false)
      }, icone(ic), el('span', { text: rotulo })))),
      corpo),
    (aba === 'retomar' || aba === 'sessoes') && el('button', {
      type: 'button', class: 'fab estendido', onclick: () => novaSessao(p)
    }, icone('mais'), el('span', { text: 'Nova sessão' }))
  );
  app.querySelectorAll('textarea').forEach(crescer);
  if (aba === 'buscar') app.querySelector('.campo-busca input')?.focus();
}

function vazioSessoes(p) {
  return el('div', { class: 'cartao vazio-cartao' },
    el('span', { class: 'ic-bolha grande' }, icone('calendario')),
    el('p', { text: 'Nenhuma sessão registrada ainda.' }),
    el('button', { type: 'button', class: 'primario', text: 'Registrar primeira sessão', onclick: () => novaSessao(p) }),
    el('button', { type: 'button', class: 'link', text: 'Importar de arquivos', onclick: () => abrirImportacao(p) }));
}

function abaRetomar(p, ss) {
  if (!ss.length) return el('div', { class: 'pilha' }, vazioSessoes(p),
    p.demanda && cartao('Demanda inicial', 'alvo', el('p', { class: 'texto-corrido', text: trecho(p.demanda, 400) })));
  const ult = ss[ss.length - 1];
  const recentes = ss.slice(-3).reverse();
  const notas = recentes.filter(s => (s.retomar || '').trim());

  const cont = new Map();
  ss.slice(-6).forEach(s => listaTemas(s.temas).forEach(t => {
    const k = semAcento(t); const c = cont.get(k) || { t, n: 0 }; c.n++; cont.set(k, c);
  }));
  const top = [...cont.values()].sort((a, b) => b.n - a.n).slice(0, 12);

  return el('div', { class: 'pilha' },
    el('div', { class: 'cartao destaque' },
      el('div', { class: 'destaque-topo' },
        el('span', { class: 'ic-bolha' }, icone('calendario')),
        el('div', {},
          el('small', { text: 'Última sessão' }),
          el('strong', { text: `${dataCurta(ult.data)}, ${diaSemana(ult.data)}` })),
        el('span', { class: 'relativo', text: relativo(ult.data) })),
      ult.status !== 'realizada' && selo(ult.status)),
    cartao('Para retomar', 'retomar',
      notas.length
        ? el('ul', { class: 'notas' }, notas.map(s => el('li', {},
          el('span', { class: 'data-mini', text: dataCurta(s.data) }),
          el('p', { text: s.retomar }))))
        : el('p', { class: 'suave', text: 'Nenhuma nota "para retomar" nas últimas três sessões.' })),
    top.length > 0 && cartao('Temas em evidência', 'tag',
      el('p', { class: 'suave pequeno', text: 'Das últimas seis sessões. Toque para buscar.' }),
      el('div', { class: 'chips' }, top.map(({ t, n }) => el('button', {
        type: 'button', class: 'chip acao',
        onclick: () => { termoBusca = t; ir({ tela: 'ficha', id: p.id, aba: 'buscar' }, false); }
      }, t, n > 1 && el('b', { text: ` ×${n}` }))))),
    cartao('Últimas sessões', 'sessoes',
      el('div', { class: 'mini-lista' }, recentes.map(s => itemSessao(p, s, ss, true)))));
}

function itemSessao(p, s, ss, compacto = false) {
  const n = ss.indexOf(s) + 1;
  const temas = listaTemas(s.temas);
  return el('button', { type: 'button', class: 'sessao-item' + (compacto ? ' compacto' : ' cartao'), onclick: () => ir({ tela: 'sessao', pid: p.id, sid: s.id }) },
    el('div', { class: 'linha1' },
      el('span', { class: 'num', text: `Sessão ${n}` }),
      el('span', { class: 'suave', text: `${dataCurta(s.data)}, ${diaSemana(s.data)}` }),
      s.status !== 'realizada' && selo(s.status)),
    el('p', { class: 'trecho' + (s.relato ? '' : ' suave'), text: s.relato ? trecho(s.relato, compacto ? 140 : 220) : folhasDaSessao(p, s).length ? 'Anotação à mão.' : 'Sem relato.' }),
    folhasDaSessao(p, s).length > 0 && el('span', { class: 'chip', text: `✍️ ${folhasDaSessao(p, s).length} ${folhasDaSessao(p, s).length === 1 ? 'folha' : 'folhas'}` }),
    !compacto && temas.length > 0 && el('div', { class: 'chips' }, temas.map(t => el('span', { class: 'chip', text: t }))));
}

function abaSessoes(p, ss) {
  const soltas = folhasSoltas(p, ss);
  const cartaoSoltas = soltas.length > 0 && cartao('Anotações à mão sem sessão registrada', 'nota',
    el('p', { class: 'suave pequeno', text: 'Folhas de dias em que não há sessão registrada. Ao registrar a sessão desse dia, a folha passa a aparecer dentro dela.' }),
    ...soltas.map(f => linhaFolha(p, f)));
  if (!ss.length) return el('div', { class: 'pilha' }, vazioSessoes(p), cartaoSoltas);
  const ordem = recentesPrimeiro ? [...ss].reverse() : ss;
  return el('div', { class: 'pilha' },
    el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => importarParaCaderno(p) }, icone('clipe'), el('span', { text: 'Trazer PDF ou imagem (Samsung Notes)' })),
    el('button', { type: 'button', class: 'link com-icone', onclick: () => { compiladoRasc = null; ir({ tela: 'compilado', pid: p.id }); } }, icone('arquivo'), el('span', { text: 'Gerar compilado da evolução (PDF)' })),
    el('div', { class: 'barra-lista' },
      el('span', { class: 'suave', text: `${ss.length} ${ss.length === 1 ? 'sessão' : 'sessões'}` }),
      el('button', {
        type: 'button', class: 'link com-icone',
        onclick: () => { recentesPrimeiro = !recentesPrimeiro; ir({ tela: 'ficha', id: p.id, aba: 'sessoes' }, false); }
      }, icone('ordenar'), el('span', { text: recentesPrimeiro ? 'Mais recentes primeiro' : 'Mais antigas primeiro' }))),
    ordem.map(s => itemSessao(p, s, ss)),
    cartaoSoltas);
}
// Versão 73: cada folha fica na sessão do mesmo dia (ou na sessão em que foi criada).
const folhasDaSessao = (p, s) => (p.folhas || []).filter(f => f.sid ? f.sid === s.id : f.data === s.data)
  .sort((a, b) => (a.criadoEm || '').localeCompare(b.criadoEm || ''));
const folhasSoltas = (p, ss) => (p.folhas || []).filter(f => !ss.some(s => f.sid ? f.sid === s.id : f.data === s.data)).sort((a, b) => b.data.localeCompare(a.data));
const linhaFolha = (p, f) => el('button', { type: 'button', class: 'pag-linha linha-botao', onclick: () => ir({ tela: 'caderno', pid: p.id, fid: f.id }) },
  el('span', { class: 'ic-bolha' }, icone('nota')),
  el('span', { class: 'pag-info' }, el('strong', { text: `${dataCurta(f.data)}${f.titulo ? ' · ' + f.titulo : ''}` }),
    el('span', { class: 'suave pequeno', text: `${f.paginas || 1} ${(f.paginas || 1) === 1 ? 'página' : 'páginas'}${f.importada ? ' · trazida de arquivo' : ''}` })));

function abaFicha(p) {
  const salvar = () => agendarSalvar('p:' + p.id, p);
  const campo = (rotulo, chave, tipo = 'text', largo = false) =>
    el('label', { class: 'campo' + (largo ? ' largo' : '') },
      el('span', { text: rotulo }),
      el('input', { type: tipo, value: p.dados[chave] || '', oninput: e => { p.dados[chave] = e.target.value; salvar(); if (chave === 'cpf' || chave === 'telefone' || chave === 'nascimento') copiarParaCadastro(p) } }));
  const nome = el('label', { class: 'campo largo' },
    el('span', { text: 'Nome' }),
    el('input', {
      type: 'text', value: p.nome,
      oninput: e => {
        if (!e.target.value.trim()) return;
        p.nome = e.target.value.trim();
        document.getElementById('titulo-tela').textContent = p.nome;
        document.getElementById('nome-hero').textContent = p.nome;
        salvar(); copiarParaCadastro(p);
      },
      onblur: e => { if (!e.target.value.trim()) e.target.value = p.nome; }
    }));
  const topico = (titulo, ic, chave, dica) => cartao(titulo, ic,
    el('textarea', {
      rows: '3', placeholder: dica, 'aria-label': titulo, value: p[chave] || '',
      oninput: e => { p[chave] = e.target.value; crescer(e.target); salvar(); }
    }));
  return el('div', { class: 'pilha' },
    cartao('Dados básicos', 'pessoa',
      el('div', { class: 'grade' },
        nome,
        campo('Data de nascimento', 'nascimento', 'date'),
        campo('CPF', 'cpf'),
        campo('Celular (WhatsApp)', 'telefone', 'tel'),
        campo('Início do acompanhamento', 'inicio', 'date'),
        campo('Frequência e horário', 'frequencia'),
        campo('Contato de emergência', 'contatoEmergencia', 'text', true))),
    el('button', { type: 'button', class: 'cartao atalho-largo', onclick: () => ir({ tela: 'adm', id: p.id, aba: 'cadastro' }) },
      el('span', { class: 'ic-bolha' }, icone('moeda')),
      el('span', { class: 'info' }, el('strong', { text: 'Horários, valor e nota fiscal' }), el('small', { class: 'suave', text: 'Ficam no cadastro administrativo deste paciente.' })),
      icone('seguinte')),
    typeof alterarValorSessao === 'function' && cadastroDe(p.id) && (() => { const c = cadastroDe(p.id), v = valorNum(valorNaData(c));
      return el('button', { type: 'button', class: 'cartao atalho-largo', onclick: () => alterarValorSessao(c) },
        el('span', { class: 'ic-bolha' }, icone('moeda')),
        el('span', { class: 'info' }, el('strong', { text: v ? `Valor da sessão: R$ ${reais(v)}` : 'Valor da sessão: não definido' }), el('small', { class: 'suave', text: 'Toque para mudar. O novo valor vale a partir da data escolhida.' })),
        icone('seguinte')); })(),
    topico('Demanda inicial', 'alvo', 'demanda', 'O que motivou a procura, nas palavras do paciente'),
    topico('Temas recorrentes', 'repetir', 'temas', 'Significantes, cenas e questões que retornam'),
    topico('Observações', 'nota', 'observacoes', 'Anotações gerais'));
}

// ---------- Letra T da data de nascimento (organização pessoal de Rodrigo, sem pretensão científica) ----------
// Data como DD/MM/AAAA: D1 D2 / M1 M2 / A1 A2 A3 A4.
// Topo = A3 + A1 + M1 + D1. Base = A4 + A2 + M2 + D2 (acima de 16, soma os algarismos).
// Direita = topo + base (acima de 16, soma os algarismos). Esquerda = direita se 1–9; se 10–16, soma os dois algarismos.
// Meio = topo + base + direita + esquerda (acima de 16, soma os algarismos).
const somaAlgarismos = n => String(n).split('').reduce((t, d) => t + Number(d), 0);
function reduzir16(n, passos, rotulo) {
  let r = n;
  while (r > 16) { const antes = r; r = somaAlgarismos(r); passos.push(`${rotulo}: ${antes} passa de 16, então ${String(antes).split('').join(' + ')} = ${r}`); }
  return r;
}
function letraT(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
  const [a, m, d] = ymd.split('-');
  const [D1, D2] = d.split('').map(Number), [M1, M2] = m.split('').map(Number), [A1, A2, A3, A4] = a.split('').map(Number);
  const passos = [];
  let topo = A3 + A1 + M1 + D1;
  passos.push(`Topo: ${A3} + ${A1} + ${M1} + ${D1} = ${topo}`);
  topo = reduzir16(topo, passos, 'Topo');
  let base = A4 + A2 + M2 + D2;
  passos.push(`Base: ${A4} + ${A2} + ${M2} + ${D2} = ${base}`);
  base = reduzir16(base, passos, 'Base');
  let direita = topo + base;
  passos.push(`Lateral direita: ${topo} + ${base} = ${direita}`);
  direita = reduzir16(direita, passos, 'Lateral direita');
  const esquerda = direita >= 10 ? somaAlgarismos(direita) : direita;
  passos.push(direita >= 10 ? `Lateral esquerda: ${String(direita).split('').join(' + ')} = ${esquerda}` : `Lateral esquerda: repete a direita, ${esquerda}`);
  let meio = topo + base + direita + esquerda;
  passos.push(`Meio: ${topo} + ${base} + ${direita} + ${esquerda} = ${meio}`);
  meio = reduzir16(meio, passos, 'Meio');
  return { topo, base, direita, esquerda, meio, passos };
}

// Dicionário dos números: vale para todos os pacientes, editável, guardado cifrado na área clínica.
const NUMEROS_PADRAO = {
  1: ['O movimento', 'iniciativa; faro para negócios; começa coisas do zero; sedução fácil; energia que movimenta o ambiente', 'inconstância; agitação que vira tumulto; dificuldade com regras e com a palavra dada; desconfiança'],
  2: ['A amizade', 'facilidade de fazer amigos; se liga bem a dois; talento para parcerias; sorte que vem pelos vínculos', 'dependência do par; dificuldade de decidir sozinho; vida que balança quando a relação balança'],
  3: ['A melancolia', 'coragem; uso forte da razão; sustenta projetos grandes', 'melancolia; impaciência diante da dificuldade; propensão a brigas; decepção fácil'],
  4: ['A calúnia', 'audácia; decisão; generosidade; sinceridade; intuição; habilidade manual e para vendas; conquista pelo esforço', 'dificuldade de guardar segredos; cólera; autoritarismo; teimosia; indecisão nas horas sérias; projetos pela metade; alvo de calúnias'],
  5: ['A companhia', 'engenhosidade; intuição forte e confiável; perseverança; ambição; recupera o que perdeu', 'não suporta ficar só; influenciável; pode ser falso; chora quando contrariado e guarda vingança; impulsivo; complicado no amor'],
  6: ['O dinheiro', 'força de vontade; senso de justiça; alegria; gosto pelas tradições; grandes ideais; se recupera com facilidade', 'pensamento sempre no dinheiro; orgulho; mania de grandeza; deslealdade; fala demais dos planos; não sabe por onde começar'],
  7: ['A sorte passageira', 'influência em todos os meios; bom gosto; boa aparência; capacidade de conquista; sorte', 'sorte que não dura; ambição que vira devaneio; sonha com melhora repentina; busca intensa de prazeres; tropeços no amor'],
  8: ['A independência', 'autossuficiência; determinação; vontade de saber; calma que acalma os outros; delicadeza; honestidade; dedicação aos amigos', 'teimosia; ações impensadas; fúria descontrolada; vingança; paixões excessivas; imaginação que se descontrola'],
  9: ['A liderança', 'liderança natural; inteligência; simpatia; responsabilidade; bom caráter; grandes projetos', 'cercado de falsos amigos sem perceber; desespero quando os projetos não se realizam'],
  10: ['A prosperidade', 'caridade; paciência; humanidade; compreende os problemas alheios; liderança de ajuda; realização a partir da meia-idade', 'avareza; obsessão em acumular; teimosia; perda de respeito quando se desvia'],
  11: ['O entusiasmo', 'generosidade; entusiasmo; atração; nobreza de atitudes; nenhum obstáculo parece intransponível', 'excesso em tudo; dominação; conquistas lentas e sacrificadas; vingança oculta; sensação de nunca ter o que deseja'],
  12: ['A criança', 'alegria; gosto pelo belo; riso fácil; bondade; prestatividade; inteligência; senso de justiça; superação pelo esforço', 'agonia; inquietude; rancor; arrogância; mão fechada; desconfia da própria sombra'],
  13: ['A vida e a morte', 'olhar que percebe o estado do outro; astúcia; eloquência; poder de convencer; intuição correta; fidelidade; neutralidade diante de brigas', 'fantasia e ilusão; amores impossíveis; resignação a tudo; indecisão; pensamento voltado à destruição'],
  14: ['A sabedoria', 'desejo de saber; juventude permanente; coragem diante dos problemas; domina situações tumultuadas; novo despertar; conquista amorosa', 'olhar malicioso; pensamentos intensos; revolta; investidas que trazem arrependimento; instabilidade'],
  15: ['A briga', 'dinamismo; influência; respeito; domínio da situação; bom gosto para escolher relações', 'violência; discussões; ciúmes; cólera incontrolável; egoísmo; indisciplina; falta de juízo; tendência a dizer não'],
  16: ['As duas caras', 'sinceridade no amor; vocação artística; calma; de bem com a vida; acolhimento afetuoso; triunfo', 'caráter dúbio; falta de palavra; dificuldade de dizer não; instintos atropelando a razão']
};
let numeros = null; // { tipoRegistro: 'numeros', itens: { 1: { titulo, positivo, negativo } }, atualizadoEm }
function numerosPadrao() {
  const itens = {};
  for (const [n, [titulo, positivo, negativo]] of Object.entries(NUMEROS_PADRAO)) itens[n] = { titulo, positivo, negativo };
  return { tipoRegistro: 'numeros', itens, atualizadoEm: new Date().toISOString() };
}
const dicionario = () => numeros || numerosPadrao();
const tracos = txt => (txt || '').split(/[;\n]+/).map(t => t.trim()).filter(Boolean);
const CASAS_T = [['meio', 'Meio'], ['topo', 'Topo'], ['base', 'Base'], ['direita', 'Lateral direita'], ['esquerda', 'Lateral esquerda']];

// Junta os números das cinco casas. Número que aparece em mais de uma casa vem primeiro, como dominante.
function compiladoT(t) {
  const grupos = new Map();
  for (const [k, rot] of CASAS_T) {
    const n = t[k];
    if (!grupos.has(n)) grupos.set(n, { n, casas: [] });
    grupos.get(n).casas.push(rot.toLowerCase());
  }
  return [...grupos.values()].sort((a, b) => b.casas.length - a.casas.length);
}

function telaLetraT(id) {
  const p = pacientes.find(x => x.id === id);
  if (!p) { telaLista(); return; }
  const t = letraT(p.dados.nascimento);
  if (!t) {
    mostrar(cabecalho('Letra T', { voltar: true }),
      el('div', { class: 'conteudo pilha' },
        el('div', { class: 'cartao vazio-cartao' },
          el('span', { class: 'ic-bolha grande' }, icone('triangulo')),
          el('p', { text: `Falta a data de nascimento de ${primeiroNome(p.nome)}.` }),
          el('button', { type: 'button', class: 'primario', text: 'Preencher na ficha', onclick: () => ir({ tela: 'ficha', id, aba: 'ficha' }, false) }))));
    return;
  }
  const dic = dicionario().itens;
  const casa = (area, n) => el('div', { class: 'letra-t-casa ' + area }, el('strong', { text: String(n) }));
  const grupos = compiladoT(t);
  const retrato = (lado, titulo, ic) => cartao(titulo, ic,
    grupos.map(g => {
      const item = dic[g.n] || {};
      const lista = tracos(item[lado]);
      return el('div', { class: 'retrato-bloco' + (g.casas.length > 1 ? ' dominante' : '') },
        el('p', { class: 'retrato-origem' },
          el('strong', { text: `${g.n} · ${item.titulo || 'sem título'}` }),
          el('small', { class: 'suave', text: ' — ' + listaNatural(g.casas) + (g.casas.length > 1 ? ' (dominante)' : '') })),
        lista.length ? el('ul', { class: 'tracos' }, lista.map(x => el('li', { text: x }))) : el('p', { class: 'suave pequeno', text: 'Nada escrito ainda para este número.' }));
    }));
  mostrar(
    cabecalho('Letra T', { voltar: true, sub: p.nome, acoes: [botaoIcone('Editar os números', 'assinar', () => ir({ tela: 'numeros' }))] }),
    el('div', { class: 'conteudo pilha' },
      el('section', { class: 'cartao' },
        el('div', { class: 'letra-t', 'aria-hidden': 'true' },
          casa('topo', t.topo), casa('esquerda', t.esquerda), casa('meio', t.meio), casa('direita', t.direita), casa('base', t.base)),
        el('p', { class: 'suave pequeno centro', text: dataExtenso(p.dados.nascimento) }),
        el('ul', { class: 'casas-t' }, CASAS_T.map(([k, rot]) => el('li', {},
          el('span', { text: rot + (k === 'direita' ? ' (Desejo do Outro)' : '') }), el('strong', { text: String(t[k]) })))),
        el('details', {}, el('summary', { class: 'link', text: 'Como foi calculado' }),
          el('ul', { class: 'passos-t' }, t.passos.map(x => el('li', { text: x }))))),
      retrato('positivo', 'Retrato positivo', 'escudo'),
      retrato('negativo', 'Retrato negativo', 'alvo'),
      el('p', { class: 'suave pequeno', text: 'Organização pessoal e experimental. Os traços de cada número são os mesmos para todos os pacientes e podem ser editados no botão de lápis, acima.' })));
}

function telaNumeros() {
  const dic = dicionario();
  let pendente = null;
  const salvarNumeros = () => {
    dic.atualizadoEm = new Date().toISOString();
    numeros = dic;
    clearTimeout(pendente);
    pendente = setTimeout(async () => { await Cofre.salvar('c:numeros', numeros); indicarStatus('Salvo'); }, 600);
  };
  const area = (n, lado, dica) => el('textarea', {
    rows: '3', 'aria-label': `Número ${n}, ${lado}`, placeholder: dica, value: dic.itens[n]?.[lado] || '',
    oninput: e => { dic.itens[n] ||= {}; dic.itens[n][lado] = e.target.value; crescer(e.target); salvarNumeros(); }
  });
  const blocos = Array.from({ length: 16 }, (_, i) => i + 1).map(n => el('details', { class: 'cartao numero-editar' },
    el('summary', {}, el('strong', { class: 'numero-grande', text: String(n) }), el('span', { text: dic.itens[n]?.titulo || 'Sem título' })),
    el('label', { class: 'campo largo' }, el('span', { text: 'Título' }),
      el('input', { type: 'text', value: dic.itens[n]?.titulo || '', oninput: e => { dic.itens[n] ||= {}; dic.itens[n].titulo = e.target.value; salvarNumeros(); } })),
    el('label', { class: 'campo largo' }, el('span', { text: 'Positivo' }), area(n, 'positivo', 'Traços separados por ponto e vírgula')),
    el('label', { class: 'campo largo' }, el('span', { text: 'Negativo' }), area(n, 'negativo', 'Traços separados por ponto e vírgula'))));
  mostrar(
    cabecalho('Os dezesseis números', { voltar: true, status: true }),
    el('div', { class: 'conteudo pilha' },
      el('p', { class: 'suave pequeno', text: 'Separe os traços com ponto e vírgula ou em linhas. Vale para todos os pacientes e fica guardado cifrado.' }),
      blocos,
      el('button', { type: 'button', class: 'link perigo-texto centro', text: 'Voltar ao texto original', onclick: async () => {
        const ok = await dialogo({ titulo: 'Voltar ao texto original?', texto: 'Suas edições nos dezesseis números serão substituídas pelo rascunho inicial.', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Voltar ao original', valor: true, estilo: 'perigo' }] });
        if (!ok) return;
        numeros = numerosPadrao(); await Cofre.salvar('c:numeros', numeros); telaNumeros();
      } })));
  app.querySelectorAll('textarea').forEach(crescer);
}

// ---------- Busca dentro do paciente ----------
function ocorrencias(txt, q) {
  if (!txt) return [];
  let norm = ''; const idx = [];
  for (let i = 0; i < txt.length; i++) for (const c of semAcento(txt[i])) { norm += c; idx.push(i); }
  const r = [];
  let i = norm.indexOf(q);
  while (i >= 0) { r.push([idx[i], idx[i + q.length - 1] + 1]); i = norm.indexOf(q, i + q.length); }
  return r;
}
function trechoMarcado(txt, faixas) {
  const ini = Math.max(0, faixas[0][0] - 70);
  const fim = Math.min(txt.length, faixas[0][1] + 130);
  const partes = [];
  if (ini > 0) partes.push('…');
  let pos = ini;
  for (const [a, b] of faixas) {
    if (a < pos || b > fim) continue;
    partes.push(txt.slice(pos, a), el('mark', { text: txt.slice(a, b) }));
    pos = b;
  }
  partes.push(txt.slice(pos, fim));
  if (fim < txt.length) partes.push('…');
  return el('p', { class: 'trecho' }, partes);
}

function abaBuscar(p, ss) {
  const entrada = el('input', { type: 'search', placeholder: 'Tema ou palavra', 'aria-label': 'Buscar nas fichas e sessões', value: termoBusca });
  const resultados = el('div', { class: 'pilha' });
  const desenhar = () => {
    termoBusca = entrada.value;
    const q = semAcento(entrada.value.trim());
    if (q.length < 2) {
      resultados.replaceChildren(el('div', { class: 'cartao vazio-cartao' },
        el('span', { class: 'ic-bolha grande' }, icone('busca')),
        el('p', { text: 'Digite ao menos duas letras. A busca percorre a ficha e todas as sessões deste paciente, sem diferenciar acentos.' })));
      return;
    }
    const achados = [];
    const camposFicha = [['Demanda inicial', p.demanda], ['Temas recorrentes', p.temas], ['Observações', p.observacoes],
      ['Frequência e horário', p.dados.frequencia], ['Contato de emergência', p.dados.contatoEmergencia]];
    for (const [rotulo, txt] of camposFicha) {
      const f = ocorrencias(txt, q);
      if (f.length) achados.push(el('button', { type: 'button', class: 'cartao resultado', onclick: () => ir({ tela: 'ficha', id: p.id, aba: 'ficha' }, false) },
        el('div', { class: 'linha1' }, el('span', { class: 'rotulo-res' }, icone('pessoa'), el('span', { text: 'Ficha: ' + rotulo })),
          el('span', { class: 'suave', text: f.length > 1 ? `${f.length} ocorrências` : '' })),
        trechoMarcado(txt, f)));
    }
    for (const s of [...ss].reverse()) {
      const partes = [['Relato', s.relato], ['Para retomar', s.retomar], ['Temas', s.temas]];
      let total = 0, primeiro = null;
      for (const [rotulo, txt] of partes) {
        const f = ocorrencias(txt, q);
        total += f.length;
        if (f.length && !primeiro) primeiro = { rotulo, txt, f };
      }
      if (!primeiro) continue;
      achados.push(el('button', { type: 'button', class: 'cartao resultado', onclick: () => ir({ tela: 'sessao', pid: p.id, sid: s.id }) },
        el('div', { class: 'linha1' },
          el('span', { class: 'rotulo-res' }, icone('calendario'), el('span', { text: `Sessão ${ss.indexOf(s) + 1}, ${dataCurta(s.data)}` })),
          el('span', { class: 'suave', text: total > 1 ? `${total} ocorrências` : '' })),
        primeiro.rotulo !== 'Relato' && el('small', { class: 'suave', text: primeiro.rotulo }),
        trechoMarcado(primeiro.txt, primeiro.f)));
    }
    resultados.replaceChildren(
      el('p', { class: 'suave pequeno', text: achados.length ? `${achados.length} ${achados.length === 1 ? 'lugar encontrado' : 'lugares encontrados'}` : 'Nada encontrado.' }),
      ...achados);
  };
  let t = null;
  entrada.addEventListener('input', () => { clearTimeout(t); t = setTimeout(desenhar, 150); });
  desenhar();
  return el('div', { class: 'pilha' }, el('label', { class: 'campo-busca' }, icone('busca'), entrada), resultados);
}

// ---------- Sessão ----------
async function novaSessao(p) {
  const agora = new Date().toISOString();
  const s = { id: crypto.randomUUID(), pid: p.id, data: hojeISO(), status: 'realizada', relato: '', retomar: '', temas: '', criadoEm: agora, atualizadoEm: agora };
  await Cofre.salvar(chaveSessao(s), s);
  sessoes.push(s);
  vincularSessao(s, true);
  ir({ tela: 'sessao', pid: p.id, sid: s.id });
  app.querySelector('textarea')?.focus();
}

function telaSessao(pid, sid) {
  const p = pacientes.find(x => x.id === pid);
  const ss = sessoesDe(pid);
  const i = ss.findIndex(s => s.id === sid);
  if (!p || i < 0) { telaLista(); return; }
  const s = ss[i];
  const salvar = () => agendarSalvar(chaveSessao(s), s);
  const irPara = alvo => ir({ tela: 'sessao', pid, sid: alvo.id }, false);

  const data = el('input', { type: 'date', value: s.data, 'aria-label': 'Data da sessão' });
  data.addEventListener('change', () => { if (!data.value) return; s.data = data.value; salvar(); vincularSessao(s); telaSessao(pid, sid); });

  const segmento = el('div', { class: 'segmento', role: 'radiogroup', 'aria-label': 'Situação' },
    Object.entries(STATUS).map(([k, rotulo]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(s.status === k), class: s.status === k ? 'ativo ' + k : '',
      text: rotulo,
      onclick: () => { s.status = k; salvar(); vincularSessao(s); telaSessao(pid, sid); }
    })));

  const previa = el('div', { class: 'chips' });
  const desenharPrevia = () => previa.replaceChildren(...listaTemas(s.temas).map(t => el('span', { class: 'chip', text: t })));
  desenharPrevia();

  const area = (rotulo, chave, dica, grande) => el('textarea', {
    class: grande ? 'grande' : '', rows: grande ? '8' : '3', placeholder: dica, 'aria-label': rotulo, value: s[chave] || '',
    oninput: e => { s[chave] = e.target.value; crescer(e.target); salvar(); }
  });

  mostrar(
    cabecalho(`Sessão ${i + 1}`, {
      voltar: true, sub: p.nome, status: true,
      acoes: [botaoIcone('Excluir sessão', 'lixeira', () => excluirSessao(s))]
    }),
    el('div', { class: 'conteudo' },
      el('div', { class: 'navega' },
        el('button', { type: 'button', class: 'secundario compacto com-icone', disabled: i === 0, onclick: () => irPara(ss[i - 1]) }, icone('voltar'), el('span', { text: 'Anterior' })),
        el('span', { class: 'suave', text: `${i + 1} de ${ss.length}` }),
        el('button', { type: 'button', class: 'secundario compacto com-icone', disabled: i === ss.length - 1, onclick: () => irPara(ss[i + 1]) }, el('span', { text: 'Próxima' }), icone('seguinte'))),
      el('div', { class: 'pilha' },
        cartao('Data e situação', 'calendario',
          el('div', { class: 'linha-data' }, data, el('span', { class: 'suave', text: `${diaSemana(s.data)}, ${relativo(s.data)}` })),
          segmento),
        cartao('Anotações à mão', 'nota',
          ...folhasDaSessao(p, s).map(f => linhaFolha(p, f)),
          el('div', { class: 'botoes-linha' },
            el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => novaFolha(p, { data: s.data, sid: s.id }) }, icone('nota'), el('span', { text: folhasDaSessao(p, s).length ? 'Mais uma folha' : 'Escrever com a caneta' })),
            el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => importarParaCaderno(p, { data: s.data, sid: s.id }) }, icone('clipe'), el('span', { text: 'Trazer PDF ou imagem' })))),
        cartao('O que foi trazido', 'texto', area('O que foi trazido', 'relato', 'Relato da sessão', true),
          s.origem && el('small', { class: 'suave origem', text: 'Importado de ' + s.origem })),
        cartao('Para retomar', 'retomar', area('Para retomar', 'retomar', 'O que retomar no próximo atendimento', false)),
        cartao('Temas da sessão', 'tag',
          el('input', {
            type: 'text', value: s.temas, placeholder: 'Separe por vírgulas: pai, trabalho, sonho da escada', 'aria-label': 'Temas da sessão',
            oninput: e => { s.temas = e.target.value; desenharPrevia(); salvar(); }
          }),
          previa),
        cartaoAtendimentoSessao(p, s)))
  );
  app.querySelectorAll('textarea').forEach(crescer);
}

async function excluirSessao(s) {
  const ok = await dialogo({
    titulo: 'Excluir esta sessão?',
    texto: 'O registro desta sessão será apagado deste aparelho. Não há como desfazer.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }]
  });
  if (!ok) return;
  pendentes.delete(chaveSessao(s));
  await Cofre.apagar(chaveSessao(s));
  sessoes = sessoes.filter(x => x !== s);
  await desvincularSessao(s);
  history.back();
}

// ---------- Opções do paciente ----------
async function opcoesPaciente(p) {
  await salvarAgora();
  const salvarJa = async () => { agendarSalvar('p:' + p.id, p); await salvarAgora(); };
  if (!p.arquivado) {
    const acao = await dialogo({
      titulo: p.nome,
      botoes: [
        { rotulo: 'Cancelar', valor: null },
        { rotulo: 'Arquivar', valor: 'arquivar' },
        { rotulo: 'Importar arquivos', valor: 'importar', estilo: 'primario' }
      ]
    });
    if (acao === 'importar') { abrirImportacao(p); return; }
    if (acao !== 'arquivar') return;
    const ok = await dialogo({
      titulo: 'Arquivar paciente?',
      texto: 'Ele sai da lista principal, mas a ficha e as sessões ficam guardadas. É possível desarquivar a qualquer momento.',
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Arquivar', valor: true, estilo: 'primario' }]
    });
    if (!ok) return;
    p.arquivado = true;
    await salvarJa();
    await arquivarCadastro(p.id, true);
    history.back();
    return;
  }
  const escolha = await dialogo({
    titulo: 'Paciente arquivado',
    botoes: [
      { rotulo: 'Cancelar', valor: null },
      { rotulo: 'Excluir definitivamente', valor: 'excluir', estilo: 'secundario perigo-texto' },
      { rotulo: 'Desarquivar', valor: 'desarquivar', estilo: 'primario' }
    ]
  });
  if (escolha === 'desarquivar') {
    p.arquivado = false;
    await salvarJa();
    await arquivarCadastro(p.id, false);
    history.back();
  } else if (escolha === 'excluir') {
    const confirma = await dialogo({
      titulo: 'Excluir definitivamente?',
      texto: 'A ficha e todas as sessões serão apagadas. Não há como desfazer. A Resolução CFP 001/2009 pede a guarda do registro documental por no mínimo 5 anos. Para confirmar, digite EXCLUIR.',
      campos: [{ rotulo: 'Digite EXCLUIR' }],
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }]
    });
    if (typeof confirma !== 'string' || confirma.trim().toUpperCase() !== 'EXCLUIR') return;
    for (const s of sessoesDe(p.id)) await Cofre.apagar(chaveSessao(s));
    for (const d of documentos.filter(x => x.pid === p.id)) { await Cofre.apagar(chaveDoc(d)); await Cofre.apagar(chaveConteudo(d)); }
    documentos = documentos.filter(x => x.pid !== p.id);
    await Cofre.apagar('p:' + p.id);
    await excluirAdmDe(p.id);
    sessoes = sessoes.filter(s => s.pid !== p.id);
    pacientes = pacientes.filter(x => x.id !== p.id);
    history.back();
  }
}

// ---------- Backup cifrado ----------
async function fazerBackup() {
  let senha = senhaBackup, novaSenha = false;
  if (!senha) {
    const r = await dialogo({
      titulo: 'Fazer backup cifrado',
      texto: 'Escolha uma senha para este arquivo. Ela será pedida para restaurar, inclusive no outro aparelho. Pode ser a própria senha mestra.',
      campos: [{ rotulo: 'Senha do backup', tipo: 'password', autocomplete: 'new-password' }, { rotulo: 'Repita a senha', tipo: 'password', autocomplete: 'new-password' }],
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Gerar backup', valor: true, estilo: 'primario' }]
    });
    if (!r) return;
    const [s1, s2] = r;
    if (s1.length < 8) return aviso('Backup não gerado', 'A senha precisa ter pelo menos 8 caracteres.');
    if (s1 !== s2) return aviso('Backup não gerado', 'As duas senhas estão diferentes.');
    senha = s1; novaSenha = true;
  }
  await salvarAgora();
  const registros = {};
  pacientes.forEach(p => { registros['p:' + p.id] = p; });
  sessoes.forEach(s => { registros[chaveSessao(s)] = s; });
  documentos.forEach(d => { registros[chaveDoc(d)] = d; });
  for (const d of documentos) { const c = await Cofre.ler(chaveConteudo(d)); if (c) registros[chaveConteudo(d)] = c; }
  if (assinatura) registros['c:assinatura'] = assinatura;
  if (numeros) registros['c:numeros'] = numeros;
  for (const k of ['c:modelos-anamnese', 'c:normas']) { const v = await Cofre.ler(k); if (v) registros[k] = v; }
  for (const f of await Cofre.lerTodos('c:folha:')) if (f?.id) {
    registros[chaveFolha(f.id)] = f;
    for (let i = 0; i < (f.fundos || []).length; i++) if (f.fundos[i]) { const fu = await Cofre.ler(chaveFundo(f.id, i)); if (fu) registros[chaveFundo(f.id, i)] = fu; }
  }
  Object.assign(registros, await registrosAdm(true));
  const texto = await Cofre.cifrarPacote(senha, { formato: 'consultorio', versao: 1, criadoEm: new Date().toISOString(), registros });
  const nome = `consultorio-backup-${hojeISO()}.cifrado.txt`;
  const arquivo = new File([texto], nome, { type: 'text/plain' });

  const destino = await dialogo({
    titulo: 'Backup pronto e cifrado',
    texto: `${pacientes.length} pacientes, ${sessoes.length} sessões, ${atendimentos.length} atendimentos da agenda, ${pagamentos.length} pagamentos e ${documentos.length} documentos. Fora deste app, o arquivo é ilegível sem a senha. Onde guardar?`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Baixar arquivo', valor: 'baixar' }, { rotulo: 'Enviar ao Drive', valor: 'compartilhar', estilo: 'primario' }]
  });
  let feito = false;
  if (destino === 'compartilhar') {
    if (navigator.canShare?.({ files: [arquivo] })) {
      ignorarOcultacao = true;
      try { await navigator.share({ files: [arquivo], title: 'Backup do Consultório' }); feito = true; }
      catch (e) { if (e.name !== 'AbortError') await aviso('Não foi possível compartilhar', 'Use "Baixar arquivo" e envie ao Drive pelo próprio app do Drive.'); }
      finally { ignorarOcultacao = false; }
    } else {
      await aviso('Compartilhamento indisponível', 'Use "Baixar arquivo" e envie ao Drive pelo próprio app do Drive.');
    }
  } else if (destino === 'baixar') {
    const url = URL.createObjectURL(arquivo);
    const a = el('a', { href: url, download: nome });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    feito = true;
  }
  if (feito) {
    config.ultimoBackup = new Date().toISOString();
    await Cofre.salvarConfig(config);
    if (novaSenha) {
      const guardar = await dialogo({
        titulo: 'Backup feito',
        texto: 'Guarde a senha do backup junto com a senha mestra. Quer que este aparelho lembre a senha? Ela fica dentro do cofre, cifrada, e os próximos backups ficam a um toque.',
        botoes: [{ rotulo: 'Não', valor: null }, { rotulo: 'Lembrar a senha', valor: true, estilo: 'primario' }]
      });
      if (guardar) await lembrarSenhaBackup(senha);
    } else await aviso('Backup feito', 'Cifrado com a senha do backup guardada neste aparelho.');
    if (history.state?.tela === 'config') telaConfig(); else render(history.state);
  }
}

// Tipos aceitos para o arquivo de troca e o backup: texto, Word, PDF e qualquer outro (*/*), para o arquivo nunca aparecer cinza.
const ACEITA_PACOTE = '.txt,.docx,.doc,.pdf,.odt,.cifrado,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/octet-stream'; // só documentos: com imagem ou */*, o Android abre o seletor de fotos
function escolherArquivos({ multiplo = false, accept = '' } = {}) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, multiple: multiplo });
    ignorarOcultacao = true;
    const liberar = () => setTimeout(() => { ignorarOcultacao = false; }, 1500);
    window.addEventListener('focus', liberar, { once: true });
    input.addEventListener('change', () => { liberar(); resolve([...input.files]); });
    input.addEventListener('cancel', () => { liberar(); resolve([]); });
    input.click();
  });
}

async function restaurarBackup() {
  const [arquivo] = await escolherArquivos({ accept: ACEITA_PACOTE }); // aceita qualquer arquivo, mas abre o seletor de documentos (sem filtro, o Android abria só fotos e vídeos)
  if (!arquivo) return;
  const senha = await dialogo({
    titulo: 'Restaurar backup',
    texto: arquivo.name,
    campos: [{ rotulo: 'Senha do backup', tipo: 'password', autocomplete: 'off' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Restaurar', valor: true, estilo: 'primario' }]
  });
  if (!senha) return;
  let pacote;
  try { pacote = await Cofre.decifrarPacote(senha, await textoDoPacote(arquivo)); }
  catch (e) {
    return aviso('Não foi possível restaurar', e.message === 'senha-incorreta' ? 'Senha do backup incorreta.' : 'Este arquivo não é um backup do Consultório.');
  }
  await salvarAgora();
  const r = await mesclarRegistros(pacote.registros || {}, modo === 'adm' ? k => k.startsWith('x:') : () => true);
  await recarregarTudo();
  await aviso('Backup restaurado', `${r.novos} registros novos, ${r.atualizados} atualizados e ${r.mantidos} mantidos porque a versão deste aparelho era igual ou mais recente.`);
  telaConfig();
}

// ---------- Importação de arquivos (tudo lido neste aparelho, sem internet) ----------
async function lerDoZip(buffer, interno) {
  const dv = new DataView(buffer), u8 = new Uint8Array(buffer), td = new TextDecoder();
  let fimDir = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fimDir = i; break; }
  }
  if (fimDir < 0) throw new Error('formato');
  const total = dv.getUint16(fimDir + 10, true);
  let p = dv.getUint32(fimDir + 16, true);
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('formato');
    const metodo = dv.getUint16(p + 10, true), tamanho = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    const desloc = dv.getUint32(p + 42, true);
    const nome = td.decode(u8.subarray(p + 46, p + 46 + ln));
    if (nome === interno) {
      const ini = desloc + 30 + dv.getUint16(desloc + 26, true) + dv.getUint16(desloc + 28, true);
      const dados = u8.subarray(ini, ini + tamanho);
      if (metodo === 0) return td.decode(dados);
      if (metodo === 8) return new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      throw new Error('formato');
    }
    p += 46 + ln + le + lc;
  }
  throw new Error('formato');
}

function textoDoXml(xml, ns, paragrafos, trocas) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const linhas = [];
  for (const tag of paragrafos) for (const par of doc.getElementsByTagNameNS(ns, tag)) {
    if (par.parentElement && paragrafos.includes(par.parentElement.localName) && par.parentElement.namespaceURI === ns) continue;
    let t = '';
    const percorrer = no => {
      for (const f of no.childNodes) {
        if (f.nodeType === 3) { if (trocas.textoDireto) t += f.nodeValue; continue; }
        if (f.nodeType !== 1) continue;
        const n = f.localName;
        if (n === trocas.texto) t += f.textContent;
        else if (n === 'tab') t += '\t';
        else if (n === 'br' || n === 'cr' || n === 'line-break') t += '\n';
        else if (n === 's') t += ' '.repeat(Number(f.getAttributeNS(ns, 'c')) || 1);
        else percorrer(f);
      }
    };
    percorrer(par);
    linhas.push({ ordem: par, t });
  }
  // devolve na ordem do documento
  linhas.sort((x, y) => x.ordem.compareDocumentPosition(y.ordem) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  return linhas.map(l => l.t).join('\n');
}

// Versão 39: o arquivo cifrado às vezes chega convertido em PDF ou Word (pelo WhatsApp, Drive ou um visualizador).
// O conteúdo é só texto sem espaços; aqui ele é recuperado de PDF, Word ou texto e os espaços/quebras são retirados.
async function textoDoPacote(arquivo) {
  const nome = (arquivo.name || '').toLowerCase();
  let t;
  if (arquivo.type === 'application/pdf' || nome.endsWith('.pdf')) {
    const pdfjs = await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', location.href).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()), isEvalSupported: false }).promise;
    const partes = [];
    for (let i = 1; i <= doc.numPages; i++) partes.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join(''));
    await doc.destroy();
    t = partes.join('');
  } else if (nome.endsWith('.docx') || nome.endsWith('.odt') || /wordprocessingml|opendocument\.text/.test(arquivo.type)) {
    t = await extrairTexto(nome.endsWith('.docx') || nome.endsWith('.odt') ? arquivo : new File([arquivo], (arquivo.name || 'arquivo') + (/opendocument/.test(arquivo.type) ? '.odt' : '.docx'), { type: arquivo.type }));
  } else t = await arquivo.text();
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  return (ini >= 0 && fim > ini ? t.slice(ini, fim + 1) : t).replace(/\s+/g, '').replace(/[“”]/g, '"');
}
async function extrairTexto(arquivo) {
  const nome = arquivo.name.toLowerCase();
  if (/\.(txt|md|text)$/.test(nome) || arquivo.type === 'text/plain') return arquivo.text();
  if (nome.endsWith('.docx')) {
    const xml = await lerDoZip(await arquivo.arrayBuffer(), 'word/document.xml');
    return textoDoXml(xml, 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', ['p'], { texto: 't' });
  }
  if (nome.endsWith('.odt')) {
    const xml = await lerDoZip(await arquivo.arrayBuffer(), 'content.xml');
    return textoDoXml(xml, 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', ['p', 'h'], { texto: null, textoDireto: true });
  }
  if (nome.endsWith('.pdf') || arquivo.type === 'application/pdf') throw new Error('pdf');
  if (nome.endsWith('.doc')) throw new Error('doc');
  throw new Error('desconhecido');
}

const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const PREFIXO_DATA = String.raw`^\s*(?:[-–—•*>#]+\s*)?(?:(?:segunda|ter[çc]a|quarta|quinta|sexta)(?:-feira)?\s*,?\s*|s[áa]bado\s*,?\s*|domingo\s*,?\s*)?(?:(?:sess[ãa]o|atendimento|consulta|encontro|data|dia)\s*(?:n?\s*[º°o.]?\s*\d{1,3}(?:\s*[:\-–—,]\s*|\s+))?[:\-–—,.]?\s*(?:(?:de|em|do dia)\s+)?)?(?:(?:segunda|ter[çc]a|quarta|quinta|sexta)(?:-feira)?\s*,?\s*)?`;
const RE_DATA_NUM = new RegExp(PREFIXO_DATA + String.raw`(\d{1,2})([/.\-])(\d{1,2})(?:\2(\d{2,4}))?(?!\d)`, 'i');
const RE_DATA_EXT = new RegExp(PREFIXO_DATA + String.raw`(\d{1,2})\s*[º°]?\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?(\d{4}))?`, 'i');

function acharData(linha, anoPadrao) {
  let m = linha.match(RE_DATA_NUM), dia, mes, ano;
  if (m) {
    if (!m[4] && m[2] !== '/') m = null;
    else { dia = +m[1]; mes = +m[3]; ano = m[4]; }
  }
  if (!m) {
    m = linha.match(RE_DATA_EXT);
    if (!m) return null;
    dia = +m[1]; mes = MESES[semAcento(m[2])]; ano = m[3];
  }
  let anoInferido = false;
  if (!ano) { ano = anoPadrao; anoInferido = true; }
  else if (String(ano).length === 2) ano = 2000 + Number(ano);
  ano = Number(ano);
  const dt = new Date(ano, mes - 1, dia);
  if (mes < 1 || mes > 12 || dt.getDate() !== dia || ano < 1950 || ano > 2100) return null;
  const resto = linha.slice(m[0].length).replace(/^[\s:\-–—,.)]+/, '');
  return { data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, anoInferido, resto };
}

function segmentar(texto, anoPadrao) {
  const blocos = [];
  let atual = { data: null, anoInferido: false, linhas: [] };
  const fechar = () => {
    const t = atual.linhas.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (t || atual.data) blocos.push({ data: atual.data, anoInferido: atual.anoInferido, texto: t });
  };
  for (const linha of texto.split(/\r?\n/)) {
    const achado = linha.trim() ? acharData(linha, anoPadrao) : null;
    if (achado) { fechar(); atual = { data: achado.data, anoInferido: achado.anoInferido, linhas: achado.resto ? [achado.resto] : [] }; }
    else atual.linhas.push(linha);
  }
  fechar();
  return blocos.filter(b => b.texto);
}

function adicionarFonte(nome, texto, dataArquivo) {
  const ano = Number((dataArquivo || hojeISO()).slice(0, 4));
  const blocos = segmentar(texto, ano).map(b => ({
    id: crypto.randomUUID(),
    tipo: b.data ? 'sessao' : 'observacoes',
    data: b.data || dataArquivo || hojeISO(),
    anoInferido: b.anoInferido,
    texto: b.texto,
    aberto: false
  }));
  importacao.fontes.push({ nome, blocos });
  return blocos.length;
}

function abrirImportacao(p) {
  importacao = { pid: p.id, fontes: [], avisos: [], colando: false };
  ir({ tela: 'importar', pid: p.id });
}

async function escolherParaImportar() {
  const arquivos = await escolherArquivos({ multiplo: true, accept: '.docx,.odt,.txt,.md,.doc,.pdf,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text' });
  if (!arquivos.length || !importacao) return;
  for (const f of arquivos) {
    try {
      const texto = await extrairTexto(f);
      const dataArq = f.lastModified ? new Date(f.lastModified - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null;
      if (!adicionarFonte(f.name, texto, dataArq)) importacao.avisos.push(`${f.name}: nenhum texto encontrado.`);
    } catch (e) {
      const motivo = e.message === 'pdf' ? 'PDF não é lido diretamente. Abra no Drive, copie o texto e use "Colar texto".'
        : e.message === 'doc' ? 'formato .doc antigo. Salve como .docx ou copie o texto e use "Colar texto".'
          : 'formato não reconhecido. Copie o texto e use "Colar texto".';
      importacao.avisos.push(`${f.name}: ${motivo}`);
    }
  }
  telaImportar(importacao.pid);
}

const TIPOS_IMPORT = { sessao: 'Sessão', demanda: 'Ficha: demanda inicial', temas: 'Ficha: temas recorrentes', observacoes: 'Ficha: observações', ignorar: 'Não importar' };

function telaImportar(pid) {
  const p = pacientes.find(x => x.id === pid);
  if (!p || !importacao || importacao.pid !== pid) { history.back(); return; }
  const datasExistentes = new Set(sessoesDe(pid).map(s => s.data));
  const todos = importacao.fontes.flatMap(f => f.blocos);
  const contar = () => {
    const ses = todos.filter(b => b.tipo === 'sessao').length;
    const fic = todos.filter(b => b.tipo !== 'sessao' && b.tipo !== 'ignorar').length;
    return { ses, fic };
  };
  const botaoImportar = el('button', { type: 'button', class: 'fab estendido', onclick: () => concluirImportacao(p) }, icone('arquivo'), el('span', {}));
  const atualizarBotao = () => {
    const { ses, fic } = contar();
    botaoImportar.hidden = !(ses + fic);
    botaoImportar.lastChild.textContent = `Importar ${ses} ${ses === 1 ? 'sessão' : 'sessões'}` + (fic ? ` e ${fic} ${fic === 1 ? 'trecho' : 'trechos'}` : '');
  };

  const cartaoBloco = b => {
    const avisoDup = el('small', { class: 'alerta-mini' });
    const data = el('input', { type: 'date', value: b.data, 'aria-label': 'Data da sessão' });
    const tipo = el('select', { 'aria-label': 'Onde importar este trecho' },
      Object.entries(TIPOS_IMPORT).map(([k, r]) => el('option', { value: k, text: r })));
    tipo.value = b.tipo;
    const card = el('div', { class: 'cartao bloco-import' + (b.tipo === 'ignorar' ? ' ignorado' : '') });
    const atualizar = () => {
      card.classList.toggle('ignorado', b.tipo === 'ignorar');
      data.hidden = b.tipo !== 'sessao';
      const avisos = [];
      if (b.tipo === 'sessao' && datasExistentes.has(b.data)) avisos.push('Já existe sessão nesta data.');
      if (b.tipo === 'sessao' && b.anoInferido) avisos.push('O arquivo não traz o ano: confira.');
      avisoDup.textContent = avisos.join(' ');
      avisoDup.hidden = !avisos.length;
      atualizarBotao();
    };
    tipo.addEventListener('change', () => { b.tipo = tipo.value; atualizar(); });
    data.addEventListener('change', () => { if (data.value) { b.data = data.value; b.anoInferido = false; atualizar(); } });
    const corpo = el('p', { class: 'trecho texto-corrido', text: b.aberto ? b.texto : trecho(b.texto, 220) });
    const alternar = b.texto.length > 220 && el('button', {
      type: 'button', class: 'link pequeno', text: b.aberto ? 'Mostrar menos' : 'Ver texto completo',
      onclick: e => { b.aberto = !b.aberto; corpo.textContent = b.aberto ? b.texto : trecho(b.texto, 220); e.target.textContent = b.aberto ? 'Mostrar menos' : 'Ver texto completo'; }
    });
    card.append(el('div', { class: 'linha-import' }, tipo, data), avisoDup, corpo, alternar || '');
    atualizar();
    return card;
  };

  const areaColar = el('textarea', { rows: '6', placeholder: 'Cole aqui o texto copiado de um PDF, Google Docs ou outro documento', 'aria-label': 'Texto colado' });
  const blocoColar = importacao.colando && cartao('Colar texto', 'colar', areaColar,
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'secundario compacto', text: 'Cancelar', onclick: () => { importacao.colando = false; telaImportar(pid); } }),
      el('button', {
        type: 'button', class: 'primario compacto', text: 'Analisar texto',
        onclick: () => {
          if (!areaColar.value.trim()) return;
          const n = importacao.fontes.filter(f => f.nome.startsWith('Texto colado')).length + 1;
          adicionarFonte(`Texto colado ${n}`, areaColar.value, null);
          importacao.colando = false;
          telaImportar(pid);
        }
      })));

  mostrar(
    cabecalho('Importar', { voltar: true, sub: p.nome }),
    el('div', { class: 'conteudo pilha' },
      cartao('Adicionar documentos', 'arquivo',
        el('p', { class: 'suave pequeno', text: 'Lê Word (.docx), LibreOffice (.odt) e texto (.txt). Para PDF e Google Docs, copie o texto e use "Colar texto". Tudo é lido neste aparelho, sem internet, e nada é gravado antes de você confirmar.' }),
        el('div', { class: 'botoes-linha' },
          el('button', { type: 'button', class: 'primario compacto com-icone', onclick: escolherParaImportar }, icone('arquivo'), el('span', { text: 'Escolher arquivos' })),
          el('button', { type: 'button', class: 'secundario compacto com-icone', onclick: () => { importacao.colando = true; telaImportar(pid); } }, icone('colar'), el('span', { text: 'Colar texto' })))),
      blocoColar,
      importacao.avisos.length > 0 && el('div', { class: 'aviso-backup' },
        el('span', { class: 'ic-bolha' }, icone('nota')),
        el('div', {}, importacao.avisos.map(t => el('small', { text: t })))),
      importacao.fontes.map(f => el('section', { class: 'fonte' },
        el('h3', { class: 'secao-titulo com-icone' }, icone('arquivo'), el('span', { text: `${f.nome}: ${f.blocos.length} ${f.blocos.length === 1 ? 'trecho' : 'trechos'}` })),
        el('div', { class: 'pilha' }, f.blocos.map(cartaoBloco)))),
      !importacao.fontes.length && el('p', { class: 'suave centro pequeno', text: 'O app separa as sessões pelas datas que encontra no início das linhas (12/03/2024, 12 de março, Sessão 5 – 12/03). Você confere cada trecho antes de importar.' })),
    botaoImportar
  );
  atualizarBotao();
  if (importacao.colando) areaColar.focus();
}

async function concluirImportacao(p) {
  const todos = importacao.fontes.flatMap(f => f.blocos.map(b => ({ ...b, fonte: f.nome })));
  const novasSessoes = todos.filter(b => b.tipo === 'sessao');
  const trechos = todos.filter(b => b.tipo !== 'sessao' && b.tipo !== 'ignorar');
  const ok = await dialogo({
    titulo: 'Confirmar importação',
    texto: `${novasSessoes.length} ${novasSessoes.length === 1 ? 'sessão será criada' : 'sessões serão criadas'}` + (trechos.length ? ` e ${trechos.length} ${trechos.length === 1 ? 'trecho será acrescentado' : 'trechos serão acrescentados'} à ficha` : '') + '. Os arquivos originais não são alterados.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Importar', valor: true, estilo: 'primario' }]
  });
  if (!ok) return;
  const agora = new Date().toISOString();
  for (const b of novasSessoes) {
    const s = { id: crypto.randomUUID(), pid: p.id, data: b.data, status: 'realizada', relato: b.texto, retomar: '', temas: '', origem: b.fonte, criadoEm: agora, atualizadoEm: agora };
    await Cofre.salvar(chaveSessao(s), s);
    sessoes.push(s);
  }
  if (trechos.length) {
    for (const b of trechos) {
      const atual = (p[b.tipo] || '').trim();
      p[b.tipo] = (atual ? atual + '\n\n' : '') + `[Importado de ${b.fonte}]\n` + b.texto;
    }
    p.atualizadoEm = agora;
    await Cofre.salvar('p:' + p.id, p);
  }
  importacao = null;
  await sincronizarAtendimentos();
  await aviso('Importação concluída', `${novasSessoes.length} ${novasSessoes.length === 1 ? 'sessão importada' : 'sessões importadas'}` + (trechos.length ? ` e ${trechos.length} ${trechos.length === 1 ? 'trecho' : 'trechos'} na ficha` : '') + '. Dá para editar tudo normalmente.');
  history.replaceState({ tela: 'ficha', id: p.id, aba: 'sessoes' }, '');
  render(history.state);
  window.scrollTo(0, 0);
}

// ---------- Importação de planilha (vários pacientes; tudo lido neste aparelho) ----------
const CAMPOS_PLANILHA = {
  ignorar: 'Não importar',
  nome: 'Nome do paciente',
  sessaoData: 'Sessão: data',
  sessaoRelato: 'Sessão: o que foi trazido',
  sessaoRetomar: 'Sessão: para retomar',
  sessaoTemas: 'Sessão: temas',
  sessaoStatus: 'Sessão: situação (falta, remarcada)',
  nascimento: 'Ficha: data de nascimento',
  cpf: 'Ficha: CPF',
  telefone: 'Ficha: telefone',
  contatoEmergencia: 'Ficha: contato de emergência',
  inicio: 'Ficha: início do acompanhamento',
  frequencia: 'Ficha: frequência e horário',
  demanda: 'Ficha: demanda inicial',
  temas: 'Ficha: temas recorrentes',
  observacoes: 'Ficha: observações'
};
const PISTAS_COLUNA = [
  ['nome', /^nome|nome do paciente|^paciente$|^cliente$|^nome completo/],
  ['nascimento', /nasc|aniversario/],
  ['contatoEmergencia', /emergencia|responsavel/],
  ['cpf', /cpf/],
  ['telefone', /telefone|celular|whats|fone|contato/],
  ['inicio', /inicio|entrada|admissao|desde/],
  ['frequencia', /frequencia|horario|dia da semana/],
  ['demanda', /demanda|queixa|motivo|encaminhamento/],
  ['temas', /recorrente/],
  ['sessaoRetomar', /retomar|proxim/],
  ['sessaoStatus', /situacao|status|presenca|falta/],
  ['sessaoData', /data|^dia$/],
  ['sessaoTemas', /tema|tag|significante/],
  ['sessaoRelato', /relato|sessao|evolucao|anotac|registro|atendimento|conteudo|resumo/],
  ['observacoes', /observ|^obs|nota/]
];
const CAMPOS_DADOS = ['nascimento', 'cpf', 'telefone', 'contatoEmergencia', 'inicio', 'frequencia'];
const CAMPOS_TEXTO = ['demanda', 'temas', 'observacoes'];

function normalizarTabela(linhas) {
  const l = linhas.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(c => c));
  const n = l.reduce((m, r) => Math.max(m, r.length), 0);
  return l.map(r => { while (r.length < n) r.push(''); return r; });
}

function lerTabelaTexto(texto) {
  texto = texto.replace(/^\uFEFF/, '');
  const primeira = texto.split(/\r?\n/, 1)[0] || '';
  const conta = c => primeira.split(c).length - 1;
  const sep = ['\t', ';', ','].sort((x, y) => conta(y) - conta(x))[0];
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"' && campo === '') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return normalizarTabela(linhas);
}

async function lerXlsx(buffer) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const xmlDoc = t => new DOMParser().parseFromString(t, 'application/xml');
  let comuns = [];
  try {
    const doc = xmlDoc(await lerDoZip(buffer, 'xl/sharedStrings.xml'));
    comuns = [...doc.getElementsByTagNameNS(NS, 'si')].map(si => [...si.getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join(''));
  } catch { }
  const doc = xmlDoc(await lerDoZip(buffer, 'xl/worksheets/sheet1.xml'));
  const coluna = ref => { let n = 0; for (const ch of (ref.match(/^[A-Z]+/) || ['A'])[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const linhas = [];
  for (const row of doc.getElementsByTagNameNS(NS, 'row')) {
    const r = [];
    for (const c of row.getElementsByTagNameNS(NS, 'c')) {
      const tipo = c.getAttribute('t');
      const v = c.getElementsByTagNameNS(NS, 'v')[0]?.textContent ?? '';
      const valor = tipo === 's' ? (comuns[Number(v)] ?? '')
        : tipo === 'inlineStr' ? [...c.getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join('')
          : v;
      r[c.getAttribute('r') ? coluna(c.getAttribute('r')) : r.length] = valor;
    }
    linhas.push(Array.from(r, x => x ?? ''));
  }
  return normalizarTabela(linhas);
}

function dataDeCelula(v) {
  v = (v || '').trim();
  if (!v) return null;
  if (/^\d{5}(\.\d+)?$/.test(v)) { // data guardada como número de série (Excel/Planilhas)
    const n = Math.floor(Number(v));
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [a, m, d] = [+iso[1], +iso[2], +iso[3]];
    const dt = new Date(a, m - 1, d);
    return dt.getDate() === d && m >= 1 && m <= 12 ? `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  }
  const achado = acharData(v, new Date().getFullYear());
  return achado ? achado.data : null;
}
function statusDe(v) {
  const t = semAcento(v);
  if (/falt|ausen/.test(t)) return 'falta';
  if (/remarc|desmarc|cancel|reagend/.test(t)) return 'remarcada';
  return 'realizada';
}
const nomeChave = n => semAcento(n.replace(/\s+/g, ' ').trim());

function adivinharColunas(cabecalho) {
  const usados = new Set();
  return cabecalho.map(h => {
    const t = semAcento(h).trim();
    for (const [campo, re] of PISTAS_COLUNA) if (!usados.has(campo) && re.test(t)) { usados.add(campo); return campo; }
    return 'ignorar';
  });
}

function carregarTabela(linhas, fonte) {
  if (!linhas.length) { planilha.aviso = 'Nenhuma célula com conteúdo foi encontrada.'; return; }
  Object.assign(planilha, { linhas, fonte, aviso: '', colando: false, excluidos: new Set() });
  planilha.mapa = adivinharColunas(linhas[0]);
  planilha.temCabecalho = planilha.mapa.some(c => c !== 'ignorar');
}

function abrirPlanilha() {
  planilha = { linhas: null, mapa: [], temCabecalho: true, excluidos: new Set(), colando: false, fonte: '', aviso: '' };
  ir({ tela: 'planilha' });
}

async function escolherPlanilha() {
  const [f] = await escolherArquivos({ accept: '.xlsx,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (!f || !planilha) return;
  const nome = f.name.toLowerCase();
  try {
    if (nome.endsWith('.xlsx')) carregarTabela(await lerXlsx(await f.arrayBuffer()), f.name);
    else if (/\.(csv|tsv|txt)$/.test(nome) || f.type.startsWith('text/')) carregarTabela(lerTabelaTexto(await f.text()), f.name);
    else planilha.aviso = `${f.name}: formato não reconhecido. Use .xlsx, .csv ou "Colar células".`;
  } catch {
    planilha.aviso = `${f.name}: não foi possível ler. Tente "Colar células".`;
  }
  telaPlanilha();
}

function analisarPlanilha() {
  const { linhas, temCabecalho, mapa } = planilha;
  const iNome = mapa.indexOf('nome');
  if (iNome < 0) return { erro: 'Indique qual coluna traz o nome do paciente.' };
  const grupos = new Map();
  let semNome = 0, semData = 0, repetidas = 0;
  for (const r of temCabecalho ? linhas.slice(1) : linhas) {
    const nome = r[iNome].replace(/\s+/g, ' ').trim();
    if (!nome) { semNome++; continue; }
    const k = nomeChave(nome);
    let g = grupos.get(k);
    if (!g) {
      g = { chave: k, nome, existente: pacientes.find(p => nomeChave(p.nome) === k) || null, ficha: {}, sessoes: [] };
      grupos.set(k, g);
    }
    const val = campo => { const i = mapa.indexOf(campo); return i >= 0 ? (r[i] || '').trim() : ''; };
    for (const c of CAMPOS_DADOS) {
      const v = val(c);
      if (v && !g.ficha[c]) g.ficha[c] = (c === 'nascimento' || c === 'inicio') ? (dataDeCelula(v) || '') : v;
    }
    for (const c of CAMPOS_TEXTO) {
      const v = val(c);
      if (v && !(g.ficha[c] || '').includes(v)) g.ficha[c] = g.ficha[c] ? g.ficha[c] + '\n\n' + v : v;
    }
    const relato = val('sessaoRelato'), retomar = val('sessaoRetomar'), temas = val('sessaoTemas'), dataTxt = val('sessaoData');
    if (!(relato || retomar || temas || dataTxt)) continue;
    const data = dataDeCelula(dataTxt);
    if (!data) {
      if (relato || retomar) {
        semData++;
        const extra = [relato, retomar].filter(Boolean).join('\n');
        g.ficha.observacoes = (g.ficha.observacoes ? g.ficha.observacoes + '\n\n' : '') + extra;
      }
      continue;
    }
    const ja = (g.existente ? sessoesDe(g.existente.id) : []).concat(g.sessoes)
      .some(s => s.data === data && (s.relato || '').trim() === relato);
    if (ja) { repetidas++; continue; }
    g.sessoes.push({ data, relato, retomar, temas, status: statusDe(val('sessaoStatus')) });
  }
  const lista = [...grupos.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  lista.forEach(g => { g.incluir = !planilha.excluidos.has(g.chave); });
  return { grupos: lista, semNome, semData, repetidas };
}

function telaPlanilha() {
  if (!planilha) { history.back(); return; }
  const blocos = [];

  const areaColar = el('textarea', { rows: '6', placeholder: 'Cole aqui as células copiadas da planilha', 'aria-label': 'Células coladas' });
  blocos.push(cartao('Trazer a planilha', 'tabela',
    el('p', { class: 'suave pequeno', text: 'No app Planilhas: toque no quadrado do canto superior esquerdo para selecionar tudo, depois em Copiar, e volte aqui em "Colar células". Também dá para baixar a planilha como Excel (.xlsx) ou CSV e usar "Escolher arquivo". Tudo é lido neste aparelho, sem internet.' }),
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'primario compacto com-icone', onclick: () => { planilha.colando = true; telaPlanilha(); } }, icone('colar'), el('span', { text: 'Colar células' })),
      el('button', { type: 'button', class: 'secundario compacto com-icone', onclick: escolherPlanilha }, icone('arquivo'), el('span', { text: 'Escolher arquivo' }))),
    planilha.fonte && el('p', { class: 'suave pequeno origem', text: `Lido: ${planilha.fonte}, ${planilha.linhas.length} linhas.` })));

  if (planilha.colando) blocos.push(cartao('Colar células', 'colar', areaColar,
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'secundario compacto', text: 'Cancelar', onclick: () => { planilha.colando = false; telaPlanilha(); } }),
      el('button', {
        type: 'button', class: 'primario compacto', text: 'Ler células',
        onclick: () => { if (!areaColar.value.trim()) return; carregarTabela(lerTabelaTexto(areaColar.value), 'células coladas'); telaPlanilha(); }
      }))));

  if (planilha.aviso) blocos.push(el('div', { class: 'aviso-backup' }, el('span', { class: 'ic-bolha' }, icone('nota')), el('div', {}, el('small', { text: planilha.aviso }))));

  let resumo = null;
  if (planilha.linhas) {
    const { linhas, mapa } = planilha;
    const cab = el('input', { type: 'checkbox', checked: planilha.temCabecalho });
    cab.addEventListener('change', () => { planilha.temCabecalho = cab.checked; telaPlanilha(); });
    const letra = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
    blocos.push(cartao('Colunas', 'tabela',
      el('p', { class: 'suave pequeno', text: 'Confira o que cada coluna contém. O app já fez uma sugestão pelos títulos.' }),
      el('label', { class: 'marcar' }, cab, el('span', { text: 'A primeira linha tem os títulos das colunas' })),
      linhas[0].map((_, i) => {
        const exemplo = (planilha.temCabecalho ? linhas.slice(1) : linhas).map(r => r[i]).find(Boolean) || '';
        const ehData = ['sessaoData', 'nascimento', 'inicio'].includes(mapa[i]);
        const exemploVisto = ehData && dataDeCelula(exemplo) ? dataCurta(dataDeCelula(exemplo)) : exemplo;
        const sel = el('select', { 'aria-label': 'Conteúdo da coluna' }, Object.entries(CAMPOS_PLANILHA).map(([k, r]) => el('option', { value: k, text: r })));
        sel.value = mapa[i] || 'ignorar';
        sel.addEventListener('change', () => {
          if (sel.value !== 'ignorar') planilha.mapa = planilha.mapa.map((c, j) => j !== i && c === sel.value ? 'ignorar' : c);
          planilha.mapa[i] = sel.value;
          telaPlanilha();
        });
        return el('div', { class: 'coluna-map' + (sel.value === 'ignorar' ? ' ignorado' : '') },
          el('div', { class: 'coluna-info' },
            el('strong', { text: planilha.temCabecalho ? (linhas[0][i] || `Coluna ${letra(i)}`) : `Coluna ${letra(i)}` }),
            el('small', { class: 'suave', text: exemplo ? 'Ex.: ' + trecho(exemploVisto, 60) : 'Coluna vazia' })),
          sel);
      })));

    resumo = analisarPlanilha();
    if (resumo.erro) blocos.push(el('div', { class: 'aviso-backup' }, el('span', { class: 'ic-bolha' }, icone('pessoa')), el('div', {}, el('strong', { text: resumo.erro }))));
    else {
      const alertas = [];
      if (resumo.semNome) alertas.push(`${resumo.semNome} ${resumo.semNome === 1 ? 'linha sem nome será ignorada' : 'linhas sem nome serão ignoradas'}.`);
      if (resumo.semData) alertas.push(`${resumo.semData} ${resumo.semData === 1 ? 'registro sem data vai' : 'registros sem data vão'} para Observações da ficha.`);
      if (resumo.repetidas) alertas.push(`${resumo.repetidas} ${resumo.repetidas === 1 ? 'sessão já existe e não será duplicada' : 'sessões já existem e não serão duplicadas'}.`);
      blocos.push(cartao(`Pacientes encontrados (${resumo.grupos.length})`, 'pessoa',
        alertas.map(t => el('small', { class: 'alerta-mini', text: t })),
        el('div', { class: 'lista-previa' }, resumo.grupos.map(g => {
          const caixa = el('input', { type: 'checkbox', checked: g.incluir, 'aria-label': 'Importar ' + g.nome });
          caixa.addEventListener('change', () => { if (caixa.checked) planilha.excluidos.delete(g.chave); else planilha.excluidos.add(g.chave); telaPlanilha(); });
          const camposFicha = Object.keys(g.ficha).filter(c => g.ficha[c]).length;
          const detalhe = [`${g.sessoes.length} ${g.sessoes.length === 1 ? 'sessão' : 'sessões'}`];
          if (camposFicha) detalhe.push(`${camposFicha} ${camposFicha === 1 ? 'campo' : 'campos'} da ficha`);
          return el('label', { class: 'previa-paciente' + (g.incluir ? '' : ' ignorado') }, caixa,
            el('span', { class: 'info' },
              el('span', { class: 'nome', text: g.nome }),
              el('small', { class: 'suave', text: detalhe.join(', ') })),
            el('span', { class: 'selo ' + (g.existente ? 'remarcada' : 'realizada'), text: g.existente ? 'Já cadastrado' : 'Novo' }));
        }))));
    }
  }

  const incluidos = resumo && !resumo.erro ? resumo.grupos.filter(g => g.incluir) : [];
  const totalSes = incluidos.reduce((n, g) => n + g.sessoes.length, 0);
  mostrar(
    cabecalho('Importar planilha', { voltar: true }),
    el('div', { class: 'conteudo pilha' }, blocos),
    incluidos.length > 0 && el('button', { type: 'button', class: 'fab estendido', onclick: () => concluirPlanilha(resumo) },
      icone('tabela'), el('span', { text: `Importar ${incluidos.length} ${incluidos.length === 1 ? 'paciente' : 'pacientes'}, ${totalSes} ${totalSes === 1 ? 'sessão' : 'sessões'}` }))
  );
  if (planilha.colando) areaColar.focus();
}

async function concluirPlanilha(resumo) {
  const grupos = resumo.grupos.filter(g => g.incluir);
  const novos = grupos.filter(g => !g.existente).length;
  const totalSes = grupos.reduce((n, g) => n + g.sessoes.length, 0);
  const ok = await dialogo({
    titulo: 'Confirmar importação',
    texto: `${novos} ${novos === 1 ? 'paciente novo' : 'pacientes novos'}, ${grupos.length - novos} já ${grupos.length - novos === 1 ? 'cadastrado' : 'cadastrados'} e ${totalSes} ${totalSes === 1 ? 'sessão' : 'sessões'}. Em quem já está cadastrado, os dados existentes não são apagados: o app só preenche o que está vazio e acrescenta textos novos. A planilha original não é alterada.`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Importar', valor: true, estilo: 'primario' }]
  });
  if (!ok) return;
  const agora = new Date().toISOString();
  const fonte = planilha.fonte || 'planilha';
  for (const g of grupos) {
    let p = g.existente;
    if (!p) {
      p = { id: crypto.randomUUID(), nome: g.nome, criadoEm: agora, atualizadoEm: agora, arquivado: false,
        dados: { nascimento: '', cpf: '', telefone: '', contatoEmergencia: '', inicio: '', frequencia: '' }, demanda: '', temas: '', observacoes: '' };
      pacientes.push(p);
    }
    for (const c of CAMPOS_DADOS) if (g.ficha[c] && !p.dados[c]) p.dados[c] = g.ficha[c];
    for (const c of CAMPOS_TEXTO) {
      if (!g.ficha[c]) continue;
      const atual = (p[c] || '').trim();
      if (!atual) p[c] = g.ficha[c];
      else if (!atual.includes(g.ficha[c])) p[c] = atual + '\n\n[Importado da planilha]\n' + g.ficha[c];
    }
    p.atualizadoEm = agora;
    await Cofre.salvar('p:' + p.id, p);
    for (const x of g.sessoes) {
      const s = { id: crypto.randomUUID(), pid: p.id, data: x.data, status: x.status, relato: x.relato, retomar: x.retomar, temas: x.temas, origem: fonte, criadoEm: agora, atualizadoEm: agora };
      await Cofre.salvar(chaveSessao(s), s);
      sessoes.push(s);
    }
  }
  planilha = null;
  await sincronizarCadastros();
  await sincronizarAtendimentos();
  await aviso('Importação concluída', `${grupos.length} ${grupos.length === 1 ? 'paciente' : 'pacientes'} e ${totalSes} ${totalSes === 1 ? 'sessão' : 'sessões'} no cofre. Se quiser, apague agora a planilha do Drive: a decisão é sua.`);
  history.replaceState({ tela: 'lista' }, '');
  verArquivados = false;
  telaLista();
  window.scrollTo(0, 0);
}

// ---------- Configurações ----------
async function telaConfig() {
  const temBio = await Cofre.biometriaAtiva();
  const persistente = await navigator.storage?.persisted?.().catch(() => false);
  if (!Cofre.aberto()) return;

  const tempo = seletorTempo('Tempo até o bloqueio automático', config.bloqueioMin, async v => { config.bloqueioMin = v; await Cofre.salvarConfig(config); });
  const tempoFora = seletorTempo('Tempo fora do app até pedir a senha', minutosFora(), async v => { config.foraMin = v; await Cofre.salvarConfig(config); }, true);

  const linha = (ic, titulo, detalhe, controle) => el('div', { class: 'linha-config' },
    el('span', { class: 'ic-bolha' }, icone(ic)),
    el('div', { class: 'linha-texto' }, el('p', { text: titulo }), detalhe && el('small', { text: detalhe })), controle);
  const secao = (titulo, ...linhas) => el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: titulo }), ...linhas);

  mostrar(
    cabecalho('Configurações', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      secao('Acesso',
        linha('relogio', 'Bloqueio automático', 'Com o app aberto e sem uso por este tempo, ele se fecha e pede a senha.', tempo),
        linha('cadeado', 'Ao sair para outro app', 'Se voltar dentro deste tempo, não precisa da senha. Passou do tempo, ele pede de novo.', tempoFora),
        linha('pessoa', 'Biometria', temBio ? 'Ativada neste aparelho.' : 'Desbloqueio pela digital, com a senha mestra como reserva.',
          el('button', { type: 'button', class: 'secundario compacto', text: temBio ? 'Desativar' : 'Ativar', onclick: temBio ? desativarBio : ativarBio })),
        linha('cadeado', 'Senha mestra', null, el('button', { type: 'button', class: 'secundario compacto', text: 'Trocar', onclick: trocarSenha }))),
      secaoAdministrativo(linha, secao),
      secao('Aparência', linhaAparencia(linha)),
      secao('Documentos',
        linha('assinar', 'Dados profissionais e assinatura',
          perfil.nome ? `${perfil.nome}${perfil.crp ? ', CRP ' + perfil.crp : ''}${assinatura ? '. Assinatura cadastrada.' : '. Falta a assinatura.'}` : 'Nome, CRP, endereço e a imagem do carimbo com assinatura, usados nas declarações.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Editar', onclick: () => ir({ tela: 'perfil' }) })),
        linha('triangulo', 'Os dezesseis números da letra T', 'Traços positivos e negativos de cada número, iguais para todos os pacientes.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Editar', onclick: () => ir({ tela: 'numeros' }) })),
        linha('nota', 'Modelos de anamnese', 'Adulto, adolescente, casal e os que você criar.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Editar', onclick: () => ir({ tela: 'modelosAnamnese', modelo: 'adulto' }) })),
        linha('texto', 'Normas do CFP e LGPD', 'Código de Ética, Resoluções 06/2019 e 01/2009 e outras, com busca.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Abrir', onclick: () => ir({ tela: 'normas' }) }))),
      secao('Backup e transferência',
        linha('escudo', 'Fazer backup cifrado',
          config.ultimoBackup ? `Último: ${dataBR(config.ultimoBackup)}.` : 'Nenhum backup feito ainda.',
          el('button', { type: 'button', class: 'primario compacto', text: 'Fazer', onclick: fazerBackup })),
        senhaBackup && linha('cadeado', 'Senha do backup lembrada', 'Backups em um toque neste aparelho.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Esquecer', onclick: esquecerSenhaBackup })),
        linha('tabela', 'Importar planilha', 'Traz vários pacientes e sessões de uma planilha (Google Planilhas, Excel ou CSV).',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Importar', onclick: abrirPlanilha })),
        linha('retomar', 'Restaurar backup', 'Também serve para passar os registros do celular para o tablet e vice-versa.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Restaurar', onclick: restaurarBackup }))),
      secao('Armazenamento',
        linha('nota', 'Proteção contra limpeza automática',
          persistente ? 'Ativa: o Android não apaga estes dados para liberar espaço.' : 'Inativa: o Android pode apagar os dados se faltar espaço.',
          !persistente && el('button', { type: 'button', class: 'secundario compacto', text: 'Ativar', onclick: async () => { await navigator.storage?.persist?.(); telaConfig(); } }))),
      el('p', { class: 'suave pequeno centro', text: `Consultório, ${VERSAO}. O app só se conecta ao Google Drive, e só quando você toca em "Atualizar do Drive"; fora isso, a única atividade de rede é baixar as próprias atualizações.` }))
  );
}

async function ativarBio() {
  const senha = await dialogo({
    titulo: 'Ativar biometria',
    texto: 'Confirme a senha mestra. Em seguida o Android vai pedir a digital (em alguns aparelhos, duas vezes).',
    campos: [{ rotulo: 'Senha mestra', tipo: 'password', autocomplete: 'current-password' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Continuar', valor: true, estilo: 'primario' }]
  });
  if (!senha) return;
  ignorarOcultacao = true;
  try {
    await Cofre.ativarBiometria(senha);
    await aviso('Biometria ativada', 'Na próxima abertura, use o botão de biometria. A senha mestra continua valendo.');
  } catch (e) {
    const msg = e.message === 'senha-incorreta' ? 'Senha incorreta.'
      : e.message === 'prf-indisponivel' ? 'Este aparelho não oferece o recurso de biometria de que o app precisa. Continue usando a senha mestra. Se o Android criou uma chave de acesso "Consultório", ela pode ser apagada no Gerenciador de Senhas do Google.'
        : 'A biometria não foi concluída.';
    await aviso('Não foi possível ativar', msg);
  } finally { ignorarOcultacao = false; }
  if (Cofre.aberto()) telaConfig();
}

async function desativarBio() {
  const ok = await dialogo({
    titulo: 'Desativar biometria?', texto: 'O desbloqueio passa a ser só pela senha mestra.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Desativar', valor: true, estilo: 'primario' }]
  });
  if (!ok) return;
  await Cofre.desativarBiometria();
  telaConfig();
}

async function trocarSenha() {
  const r = await dialogo({
    titulo: 'Trocar senha mestra',
    campos: [
      { rotulo: 'Senha atual', tipo: 'password', autocomplete: 'current-password' },
      { rotulo: 'Nova senha', tipo: 'password', autocomplete: 'new-password' },
      { rotulo: 'Repita a nova senha', tipo: 'password', autocomplete: 'new-password' }
    ],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Trocar senha', valor: true, estilo: 'primario' }]
  });
  if (!r) return;
  const [atual, nova, repete] = r;
  if (nova.length < 8) return aviso('Senha não trocada', 'A nova senha precisa ter pelo menos 8 caracteres.');
  if (nova !== repete) return aviso('Senha não trocada', 'As duas novas senhas estão diferentes.');
  try {
    await Cofre.trocarSenha(atual, nova);
    await aviso('Senha trocada', 'Use a nova senha a partir de agora. Atualize também a anotação em papel.');
  } catch { await aviso('Senha não trocada', 'A senha atual está incorreta.'); }
}

// =====================================================================
// Mensagens, documentos recebidos, documentos emitidos e perfil profissional
// Tudo guardado cifrado no cofre, como fichas e sessões.
// =====================================================================
let perfil = null;       // dados profissionais usados nos documentos
let assinatura = null;   // carimbo e assinatura: { jpeg (base64), w, h }
let documentos = [];     // só a descrição dos documentos; o arquivo é lido do cofre quando aberto
let rascunhoMsg = {};    // rascunho da mensagem por paciente (só na memória)
let declaracao = null;   // declaração em preparação (só na memória)

const PERFIL_PADRAO = () => ({ tipoRegistro: 'perfil', nome: '', titulo: 'Psicólogo', crp: '', cpf: '', clinica: '', cnpj: '', logo: null, endereco: '', cidade: '', telefone: '', email: '', valorSessao: '', modelos: [],
  nfUrl: 'https://www.nfse.gov.br/EmissorNacional', nfDescricao: 'Serviços de psicologia: sessões de psicoterapia realizadas em {datas}.', assinaturaNoAdm: false });
// Documentos da área administrativa (declarações de comparecimento, recibos, comprovantes) usam chaves "x:".
const chaveDoc = d => d.adm ? `x:d:${d.pid}:${d.id}` : `d:${d.pid}:${d.id}`;
const chaveConteudo = d => d.adm ? `x:f:${d.pid}:${d.id}` : `a:${d.pid}:${d.id}`;
function docsDe(pid, tipo) {
  return documentos.filter(d => d.pid === pid && d.tipo === tipo)
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}
async function carregarExtras() {
  const [extras, docs] = await Promise.all([Cofre.lerTodos('c:'), Cofre.lerTodos('d:')]);
  perfilAntigo = extras.find(x => x.tipoRegistro === 'perfil') || null; // até a versão 6, o perfil ficava na área clínica
  assinatura = extras.find(x => x.tipoRegistro === 'assinatura') || null;
  senhaBackup = extras.find(x => x.tipoRegistro === 'senhabackup')?.senha || null;
  numeros = extras.find(x => x.tipoRegistro === 'numeros') || null;
  documentos = docs;
}
let perfilAntigo = null;
const salvarPerfil = () => agendarSalvar('x:perfil', perfil);
const perfilIncompleto = () => !perfil.nome.trim() || !perfil.crp.trim();

function paraBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
const tamanhoLegivel = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const primeiroNome = nome => (nome || '').trim().split(/\s+/)[0] || '';
const dataExtenso = ymd => paraData(ymd).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
function listaNatural(itens) { return itens.length < 2 ? itens.join('') : itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1]; }
function valorNum(txt) { const n = Number(String(txt || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; }
const reais = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function porExtenso(n) {
  const u = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = x => {
    if (x === 100) return 'cem';
    const p = [];
    if (x >= 100) { p.push(c[Math.floor(x / 100)]); x %= 100; }
    if (x >= 20) { p.push(d[Math.floor(x / 10)]); x %= 10; if (x) p.push(u[x]); } else if (x > 0) p.push(u[x]);
    return p.join(' e ');
  };
  if (n === 0) return 'zero';
  const mil = Math.floor(n / 1000), r = n % 1000;
  const partes = [];
  if (mil) partes.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
  if (r) partes.push(ate999(r));
  return partes.join(mil && r && (r < 100 || r % 100 === 0) ? ' e ' : ' ');
}
function reaisPorExtenso(v) {
  const cent = Math.round(v * 100), R = Math.floor(cent / 100), C = cent % 100;
  let s = R ? porExtenso(R) + (R === 1 ? ' real' : ' reais') : '';
  if (C) s += (R ? ' e ' : '') + porExtenso(C) + (C === 1 ? ' centavo' : ' centavos');
  return s || 'zero real';
}

// Sai do app para outro (WhatsApp, compartilhar) sem trancar, e volta a proteger ao retornar.
function liberarSaidaTemporaria() {
  ignorarOcultacao = true;
  let saiu = false;
  const aoMudar = () => {
    if (document.hidden) { saiu = true; return; }
    document.removeEventListener('visibilitychange', aoMudar);
    ignorarOcultacao = false;
    verificarInatividade();
  };
  document.addEventListener('visibilitychange', aoMudar);
  setTimeout(() => { if (!saiu) { document.removeEventListener('visibilitychange', aoMudar); ignorarOcultacao = false; } }, 6000);
}
function abrirExterno(url) {
  liberarSaidaTemporaria();
  const a = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' });
  document.body.append(a); a.click(); a.remove();
}

// ---------- Aba Mensagem (WhatsApp) ----------
function numeroWhats(tel) {
  let d = (tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 15 ? d : null;
}
const MODELOS_MSG = [
  { nome: 'Confirmar sessão', texto: 'Olá, {nome}! Confirmo nossa sessão de {data}, às {hora}.' },
  { nome: 'Lembrete', texto: 'Olá, {nome}. Passando para lembrar da nossa sessão de {data}, às {hora}.' },
  { nome: 'Remarcar', texto: 'Olá, {nome}. Precisarei remarcar nossa sessão de {data}, às {hora}. Você teria disponibilidade em outro horário?' },
  { nome: 'Não haverá sessão', texto: 'Olá, {nome}. Não poderei atender na {data}. Retomamos no horário habitual da semana seguinte.' },
  { nome: 'Documento', texto: 'Olá, {nome}. Segue o documento solicitado.' },
  { nome: 'Lembrete de pagamento', texto: 'Olá, {nome}! Passando para lembrar do pagamento da sessão de {data}, no valor de R$ {valor}. Para pagar por Pix, a chave é: {pix}' },
  { nome: 'Pagamento', texto: 'Olá, {nome}! Passando para lembrar do pagamento deste mês. Para pagar por Pix, a chave é: {pix}. Qualquer dúvida, estou à disposição.' },
  { nome: 'Aniversário', texto: 'Olá, {nome}! Feliz aniversário! Desejo a você um novo ano muito bom.' },
  { nome: 'Livre', texto: 'Olá, {nome}. ' }
];
const dataMsg = ymd => ymd ? `${paraData(ymd).toLocaleDateString('pt-BR', { weekday: 'long' })}, ${dataCurta(ymd).slice(0, 5)}` : '[data]';
const horaMsg = h => { if (!h) return '[hora]'; const [hh, mm] = h.split(':'); return `${Number(hh)}h${mm === '00' ? '' : mm}`; };
function montarMensagem(modelo, p, r) {
  // versão 73: {valor} = valor da sessão naquela data; {pix} = chave Pix da clínica (Dados profissionais)
  const v = typeof valorNaData === 'function' ? valorNum(valorNaData(p, r.data)) : valorNum(p.valor);
  return modelo.replaceAll('{nome}', primeiroNome(p.nome)).replaceAll('{data}', dataMsg(r.data)).replaceAll('{hora}', horaMsg(r.hora))
    .replaceAll('{valor}', v ? reais(v) : '[valor]').replaceAll('{pix}', perfil.pixChave || '[chave Pix: coloque em Configurações → Dados profissionais]');
}

function abaMensagem(p) { // p aqui é o cadastro administrativo do paciente
  const r = rascunhoMsg[p.id] ||= (() => { const px = proximoHorario(p); return { modelo: 0, data: px?.data || '', hora: px?.hora || '', texto: null }; })();
  const modelos = [...MODELOS_MSG, ...(perfil.modelos || []).map(m => ({ ...m, meu: true }))];
  if (r.modelo >= modelos.length) r.modelo = 0;

  const botao = el('button', { type: 'button', class: 'primario largo com-icone centralizado' }, icone('mensagem'), el('span', { text: 'Abrir no WhatsApp' }));
  const avisoNum = el('small', { class: 'suave dica-campo' });
  const tel = el('input', { type: 'tel', inputmode: 'tel', value: p.telefone || '', placeholder: '(21) 99999-9999', 'aria-label': 'Telefone do paciente' });
  const atualizarNumero = () => {
    const n = numeroWhats(tel.value);
    avisoNum.textContent = n ? `Será aberto o WhatsApp de +${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4)}.` : 'Informe o celular com DDD. Ele fica salvo no cadastro.';
    botao.disabled = !n;
  };
  tel.addEventListener('input', () => { p.telefone = tel.value; salvarCadastro(p); atualizarNumero(); });

  const texto = el('textarea', { rows: '4', 'aria-label': 'Texto da mensagem' });
  const preencher = () => { texto.value = montarMensagem(modelos[r.modelo].texto, p, r); r.texto = texto.value; r.editado = false; crescer(texto); };
  texto.addEventListener('input', () => { r.texto = texto.value; r.editado = true; crescer(texto); });
  const data = el('input', { type: 'date', value: r.data, 'aria-label': 'Data da sessão' });
  const hora = el('input', { type: 'time', value: r.hora, 'aria-label': 'Horário da sessão' });
  data.addEventListener('change', () => { r.data = data.value; if (!r.editado) preencher(); });
  hora.addEventListener('change', () => { r.hora = hora.value; if (!r.editado) preencher(); });

  const chips = el('div', { class: 'chips' });
  const desenharChips = () => chips.replaceChildren(...modelos.map((m, i) => el('button', {
    type: 'button', class: 'chip acao' + (i === r.modelo ? ' marcado' : ''), 'aria-pressed': String(i === r.modelo),
    onclick: () => { r.modelo = i; preencher(); desenharChips(); desenharAcoesModelo(); }
  }, m.nome)));
  const acoesModelo = el('div', { class: 'linha-links' });
  const desenharAcoesModelo = () => acoesModelo.replaceChildren(...[
    el('button', { type: 'button', class: 'link', text: 'Guardar como meu modelo', onclick: () => guardarModelo(p, r, texto.value) }),
    modelos[r.modelo].meu && el('button', { type: 'button', class: 'link perigo-texto', text: 'Excluir este modelo', onclick: () => excluirModelo(p, modelos[r.modelo]) })
  ].filter(Boolean));

  botao.addEventListener('click', () => {
    const n = numeroWhats(tel.value);
    if (!n) return;
    if (/\[(data|hora)\]/.test(texto.value)) {
      dialogo({
        titulo: 'Faltam a data ou o horário', texto: 'A mensagem ainda tem [data] ou [hora]. Enviar assim mesmo?',
        botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Abrir assim', valor: true, estilo: 'primario' }]
      }).then(ok => { if (ok) abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(texto.value)}`); });
      return;
    }
    abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(texto.value)}`);
  });

  if (r.texto == null) preencher(); else texto.value = r.texto;
  desenharChips(); desenharAcoesModelo(); atualizarNumero();
  requestAnimationFrame(() => crescer(texto));

  return el('div', { class: 'pilha' },
    cartao('Celular do paciente', 'telefone', tel, avisoNum),
    cartao('Mensagem', 'mensagem',
      chips,
      el('div', { class: 'grade duas' },
        el('label', { class: 'campo' }, el('span', { text: 'Data da sessão' }), data),
        el('label', { class: 'campo' }, el('span', { text: 'Horário' }), hora)),
      texto,
      botao,
      acoesModelo),
    el('p', { class: 'suave pequeno', text: 'O WhatsApp abre com o texto pronto e você confere antes de enviar; nada sai sozinho. A conversa no WhatsApp fica fora do cofre, por isso evite escrever conteúdo clínico nela.' }));
}

async function guardarModelo(p, r, textoAtual) {
  const nome = await dialogo({
    titulo: 'Guardar como meu modelo',
    texto: 'O nome do paciente, a data e o horário viram campos que o app preenche sozinho da próxima vez.',
    campos: [{ rotulo: 'Nome do modelo (ex.: Férias)' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Guardar', valor: true, estilo: 'primario' }]
  });
  if (!nome || !nome.trim()) return;
  let t = textoAtual;
  const pn = primeiroNome(p.nome);
  if (pn) t = t.split(pn).join('{nome}');
  if (r.data) t = t.split(dataMsg(r.data)).join('{data}');
  if (r.hora) t = t.split(horaMsg(r.hora)).join('{hora}');
  perfil.modelos = [...(perfil.modelos || []), { nome: nome.trim(), texto: t }];
  salvarPerfil();
  r.modelo = MODELOS_MSG.length + perfil.modelos.length - 1;
  r.texto = null;
  render(history.state);
}
async function excluirModelo(p, m) {
  const ok = await dialogo({ titulo: `Excluir o modelo "${m.nome}"?`, botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }] });
  if (!ok) return;
  perfil.modelos = perfil.modelos.filter(x => !(x.nome === m.nome && x.texto === m.texto));
  salvarPerfil();
  const r = rascunhoMsg[p.id]; r.modelo = 0; r.texto = null;
  render(history.state);
}

// ---------- Documentos (recebidos e emitidos) ----------
async function reduzirImagem(arquivo, lado = 2200, qualidade = 0.85) {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const c = el('canvas', { width: String(Math.round(bmp.width * k)), height: String(Math.round(bmp.height * k)) });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', qualidade));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch { return null; }
}

async function guardarDocumento(p, tipo, { nome, mime, bytes, descricao, data = hojeISO(), texto = null, modelo = null, adm = false }) {
  const agora = new Date().toISOString();
  const d = { id: crypto.randomUUID(), pid: p.id, tipo, nome, descricao, mime, tamanho: bytes.length, data, texto, modelo, adm, criadoEm: agora, atualizadoEm: agora };
  await Cofre.salvar(chaveConteudo(d), { id: d.id, b64: paraBase64(bytes), atualizadoEm: agora }); // primeiro o arquivo
  await Cofre.salvar(chaveDoc(d), d);                                                                  // depois a descrição
  documentos.push(d);
  return d;
}

async function adicionarDocumentos(p, tipo) {
  const arquivos = await escolherArquivos({ multiplo: true, accept: 'image/*,application/pdf,.pdf,.doc,.docx,.odt,.txt' });
  if (!arquivos.length) return;
  indicarStatus('Guardando…');
  let n = 0;
  for (const f of arquivos) {
    if (f.size > 25 * 1048576) { await aviso('Arquivo grande demais', `${f.name} tem ${tamanhoLegivel(f.size)}. O limite é 25 MB.`); continue; }
    let bytes = new Uint8Array(await f.arrayBuffer());
    let mime = f.type || 'application/octet-stream';
    let nome = f.name || 'documento';
    if (/^image\/(jpeg|png|webp|heic|heif)/.test(mime) && f.size > 1.5 * 1048576) {
      const menor = await reduzirImagem(f);
      if (menor && menor.length < bytes.length) { bytes = menor; mime = 'image/jpeg'; nome = nome.replace(/\.\w+$/, '') + '.jpg'; }
    }
    await guardarDocumento(p, tipo, { nome, mime, bytes, descricao: nome.replace(/\.\w+$/, '') });
    n++;
  }
  indicarStatus(n ? 'Salvo' : '');
  if (Cofre.aberto()) render(history.state);
}

const iconeDoc = d => d.modelo ? 'assinar' : d.mime?.startsWith('image/') ? 'imagem' : 'arquivo';
function itemDocumento(p, d) {
  return el('button', { type: 'button', class: 'cartao doc-item', onclick: () => abrirDocumento(p, d) },
    el('span', { class: 'ic-bolha' }, icone(iconeDoc(d))),
    el('span', { class: 'info' },
      el('span', { class: 'nome', text: d.descricao || d.nome }),
      el('span', { class: 'meta', text: `${dataCurta(d.data)}, ${d.mime === 'application/pdf' ? 'PDF' : d.mime?.startsWith('image/') ? 'imagem' : 'arquivo'}, ${tamanhoLegivel(d.tamanho)}` })),
    icone('seguinte'));
}

function abaRecebidos(p) {
  const lista = docsDe(p.id, 'recebido');
  return el('div', { class: 'pilha' },
    el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => adicionarDocumentos(p, 'recebido') }, icone('clipe'), el('span', { text: 'Adicionar foto ou arquivo' })),
    cartaoPastaDrive(p),
    lista.length ? lista.map(d => itemDocumento(p, d))
      : el('div', { class: 'cartao vazio-cartao' },
        el('span', { class: 'ic-bolha grande' }, icone('clipe')),
        el('p', { text: 'Exames, laudos e encaminhamentos que o paciente enviar. Fotos e PDFs ficam guardados aqui, cifrados, junto da ficha.' })));
}

function abaEmitidos(p) {
  const lista = docsDe(p.id, 'emitido');
  return el('div', { class: 'pilha' },
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => novaDeclaracao(p) }, icone('assinar'), el('span', { text: 'Nova declaração' })),
      el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => novaDeclaracao(p, { modelo: 'reembolso' }) }, icone('assinar'), el('span', { text: 'Declaração de reembolso' })),
      el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => adicionarDocumentos(p, 'emitido') }, icone('clipe'), el('span', { text: 'Guardar arquivo' })),
      el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: emitirNfse }, icone('moeda'), el('span', { text: 'Emitir NFS-e' })),
      el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => { compiladoRasc = null; ir({ tela: 'compilado', pid: p.id }); } }, icone('sessoes'), el('span', { text: 'Compilado da evolução' }))),
    cartaoPastaDrive(p),
    perfilIncompleto() && el('div', { class: 'faixa' },
      el('p', { text: 'Antes da primeira declaração, preencha seus dados profissionais e a imagem do carimbo com assinatura.' }),
      el('button', { type: 'button', class: 'link', text: 'Preencher agora', onclick: () => ir({ tela: 'perfil' }) })),
    lista.length ? lista.map(d => itemDocumento(p, d))
      : el('div', { class: 'cartao vazio-cartao' },
        el('span', { class: 'ic-bolha grande' }, icone('assinar')),
        el('p', { text: 'Declarações e recibos emitidos para este paciente ficam guardados aqui.' })));
}
// Abre o site de emissão da nota fiscal (Emissor Nacional). Nenhum dado do paciente é enviado.
function emitirNfse() {
  const url = /^https:\/\//.test(perfil.nfUrl || '') ? perfil.nfUrl : 'https://www.nfse.gov.br/EmissorNacional/Login';
  abrirExterno(url);
}

async function lerConteudo(d) {
  const c = await Cofre.ler(chaveConteudo(d));
  if (!c) throw new Error('sem-conteudo');
  return deBase64(c.b64);
}
async function desenharImagem(canvas, bytes, mime, larguraMax = 1400) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const k = Math.min(1, larguraMax / bmp.width);
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
}

async function compartilharDocumento(d, bytes) {
  bytes ||= await lerConteudo(d);
  const arquivo = new File([bytes], d.nome, { type: d.mime });
  if (navigator.canShare?.({ files: [arquivo] })) {
    liberarSaidaTemporaria();
    try { await navigator.share({ files: [arquivo], title: d.descricao || d.nome }); return true; }
    catch (e) { if (e.name !== 'AbortError') await aviso('Não foi possível compartilhar', 'Tente de novo. Se persistir, use "Salvar no aparelho".'); return false; }
  }
  return salvarNoAparelho(d, bytes);
}
async function salvarNoAparelho(d, bytes) {
  bytes ||= await lerConteudo(d);
  const url = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
  const a = el('a', { href: url, download: d.nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function abrirDocumento(p, d) {
  const dlg = el('dialog', { class: 'dialogo largo-dialogo' });
  const fechar = () => { dlg.close(); dlg.remove(); if (Cofre.aberto()) render(history.state); };
  dlg.addEventListener('cancel', e => { e.preventDefault(); fechar(); });
  const salvarMeta = () => agendarSalvar(chaveDoc(d), d);
  const area = el('div', { class: 'visualizador' }, el('p', { class: 'suave', text: 'Abrindo…' }));
  dlg.append(
    el('label', { class: 'campo' }, el('span', { text: 'Descrição' }),
      el('input', { type: 'text', value: d.descricao || '', oninput: e => { d.descricao = e.target.value; salvarMeta(); } })),
    el('label', { class: 'campo' }, el('span', { text: 'Data' }),
      el('input', { type: 'date', value: d.data, onchange: e => { if (e.target.value) { d.data = e.target.value; salvarMeta(); } } })),
    area,
    el('p', { class: 'suave pequeno', text: 'Ao compartilhar ou salvar no aparelho, a cópia sai do cofre sem cifra.' }),
    el('div', { class: 'botoes' },
      el('button', { type: 'button', class: 'secundario perigo-texto', text: 'Excluir', onclick: () => excluirDocumento(d, dlg) }),
      el('button', { type: 'button', class: 'secundario', text: 'Salvar no aparelho', onclick: () => salvarNoAparelho(d) }),
      el('button', { type: 'button', class: 'secundario', text: d.tipo === 'emitido' ? 'Enviar' : 'Compartilhar', onclick: () => compartilharDocumento(d) }),
      el('button', { type: 'button', class: 'primario', text: 'Fechar', onclick: fechar })));
  document.body.append(dlg);
  dlg.showModal();
  try {
    if (d.texto) {
      area.replaceChildren(folhaPrevia(p, d.texto));
    } else if (d.mime?.startsWith('image/')) {
      const bytes = await lerConteudo(d);
      const c = el('canvas', { class: 'imagem-doc', 'aria-label': d.descricao || 'Imagem' });
      await desenharImagem(c, bytes, d.mime);
      area.replaceChildren(c);
    } else {
      area.replaceChildren(el('p', { class: 'suave', text: `${d.nome}, ${tamanhoLegivel(d.tamanho)}. Para ler, toque em "Compartilhar" e escolha um leitor de PDF ou o Drive.` }));
    }
  } catch { area.replaceChildren(el('p', { class: 'erro-msg', text: 'Não foi possível abrir este arquivo.' })); }
}

async function excluirDocumento(d, dlg) {
  const ok = await dialogo({
    titulo: 'Excluir este documento?', texto: 'O arquivo será apagado deste aparelho. Não há como desfazer.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }]
  });
  if (!ok) return;
  pendentes.delete(chaveDoc(d));
  await Cofre.apagar(chaveDoc(d));
  await Cofre.apagar(chaveConteudo(d));
  documentos = documentos.filter(x => x.id !== d.id);
  if (d.tipo === 'comprovante') desligarComprovante(d);
  dlg.close(); dlg.remove();
  render(history.state);
}

// ---------- Perfil profissional e assinatura ----------
function telaPerfil() {
  const campo = (rotulo, chave, { tipo = 'text', dica = '', largo = false, modo = null } = {}) =>
    el('label', { class: 'campo' + (largo ? ' largo' : '') },
      el('span', { text: rotulo }),
      el('input', { type: tipo, value: perfil[chave] || '', placeholder: dica, inputmode: modo, oninput: e => { perfil[chave] = e.target.value; salvarPerfil(); } }));
  const previa = el('div', { class: 'assinatura-caixa' });
  const desenharPrevia = async () => {
    if (!assinatura) { previa.replaceChildren(el('p', { class: 'suave', text: 'Nenhuma imagem ainda.' })); return; }
    const c = el('canvas', { class: 'assinatura-previa', 'aria-label': 'Carimbo e assinatura' });
    previa.replaceChildren(c);
    await desenharImagem(c, deBase64(assinatura.jpeg), 'image/jpeg', 900);
  };
  const previaLogo = el('div', { class: 'assinatura-caixa' });
  const desenharLogo = async () => {
    if (!perfil.logo) { previaLogo.replaceChildren(el('p', { class: 'suave', text: 'Sem logotipo: o topo dos documentos mostra seu nome e profissão.' })); return; }
    const c = el('canvas', { class: 'assinatura-previa', 'aria-label': 'Logotipo' });
    previaLogo.replaceChildren(c);
    await desenharImagem(c, deBase64(perfil.logo.jpeg), 'image/jpeg', 900);
  };
  mostrar(
    cabecalho('Dados profissionais', { voltar: true, status: true }),
    el('div', { class: 'conteudo pilha' },
      cartao('Como aparecem nos documentos', 'pessoa',
        el('div', { class: 'grade' },
          campo('Nome completo', 'nome', { largo: true }),
          campo('Profissão (sai abaixo da assinatura)', 'titulo', { dica: 'Psicólogo Clínico' }),
          campo('CRP', 'crp', { dica: '05/12345' }),
          campo('Nome da clínica', 'clinica', { dica: 'Clínica Psicológica …' }),
          campo('CNPJ', 'cnpj', { modo: 'numeric' }),
          campo('Cidade', 'cidade', { dica: 'Rio de Janeiro' }),
          campo('Endereço do consultório', 'endereco', { largo: true }),
          campo('Telefone', 'telefone', { tipo: 'tel' }),
          campo('E-mail', 'email', { tipo: 'email' }),
          campo('WhatsApp do assistente (para os lembretes)', 'whatsAdm', { tipo: 'tel', dica: '(21) 99999-9999' }),
          campo('Chave Pix da clínica (vai na mensagem de lembrete)', 'pixChave', { dica: 'CNPJ, e-mail, celular ou chave aleatória' }),
          campo('Valor da sessão (R$)', 'valorSessao', { modo: 'decimal', dica: '200,00' }),
          campo('Seu CPF (não sai nos documentos; só ajuda a conferir notas fiscais)', 'cpf', { modo: 'numeric', largo: true }))),
      cartao('Logotipo', 'imagem',
        el('p', { class: 'suave pequeno', text: 'Aparece no alto de todas as declarações, relatórios e recibos. Use uma imagem com fundo branco.' }),
        previaLogo,
        el('div', { class: 'botoes-linha' },
          el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: escolherLogo }, icone('imagem'), el('span', { text: perfil.logo ? 'Trocar logotipo' : 'Escolher logotipo' })),
          perfil.logo && el('button', { type: 'button', class: 'secundario perigo-texto', text: 'Remover', onclick: removerLogo }))),
      cartao('Carimbo e assinatura', 'assinar',
        el('p', { class: 'suave pequeno', text: 'Carimbe e assine uma folha branca, fotografe de perto, com boa luz e sem sombra. O app limpa o fundo, recorta e insere a imagem em toda declaração.' }),
        previa,
        el('div', { class: 'botoes-linha' },
          el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: escolherAssinatura }, icone('imagem'), el('span', { text: assinatura ? 'Trocar imagem' : 'Escolher foto' })),
          assinatura && el('button', { type: 'button', class: 'secundario perigo-texto', text: 'Remover', onclick: removerAssinatura })))));
  desenharPrevia();
  desenharLogo();
}

// Logotipo: preserva as cores (ex.: dourado), coloca sobre fundo branco e recorta as margens.
async function prepararLogo(arquivo) {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = el('canvas', { width: String(w), height: String(h) });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (px[j] > 242 && px[j + 1] > 242 && px[j + 2] > 242) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const m = 6;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const r = el('canvas', { width: String(cw), height: String(ch) });
    const rc = r.getContext('2d');
    rc.fillStyle = '#fff'; rc.fillRect(0, 0, cw, ch);
    rc.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
    const blob = await new Promise(ok => r.toBlob(ok, 'image/jpeg', 0.92));
    return { jpeg: paraBase64(new Uint8Array(await blob.arrayBuffer())), w: cw, h: ch };
  } catch { return null; }
}
async function escolherLogo() {
  const [f] = await escolherArquivos({ accept: 'image/*' });
  if (!f) return;
  const img = await prepararLogo(f);
  if (!img) return aviso('Não foi possível usar a imagem', 'Tente outra imagem, em formato JPG ou PNG.');
  perfil.logo = img;
  salvarPerfil(); await salvarAgora();
  telaPerfil();
}
async function removerLogo() {
  const ok = await dialogo({ titulo: 'Remover o logotipo?', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Remover', valor: true, estilo: 'perigo' }] });
  if (!ok) return;
  perfil.logo = null;
  salvarPerfil(); await salvarAgora();
  telaPerfil();
}
async function escolherAssinatura() {
  const [f] = await escolherArquivos({ accept: 'image/*' });
  if (!f) return;
  const img = await limparAssinatura(f);
  if (!img) return aviso('Não foi possível usar a imagem', 'Tente outra foto, em formato JPG ou PNG.');
  assinatura = { tipoRegistro: 'assinatura', ...img, atualizadoEm: new Date().toISOString() };
  await Cofre.salvar('c:assinatura', assinatura);
  await atualizarCopiaAssinatura();
  telaPerfil();
}
async function removerAssinatura() {
  const ok = await dialogo({ titulo: 'Remover carimbo e assinatura?', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Remover', valor: true, estilo: 'perigo' }] });
  if (!ok) return;
  await Cofre.apagar('c:assinatura');
  assinatura = null;
  await atualizarCopiaAssinatura();
  telaPerfil();
}

// Clareia o papel, mantém a tinta (inclusive o azul do carimbo) e recorta as margens.
async function limparAssinatura(arquivo) {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = el('canvas', { width: String(w), height: String(h) });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const im = ctx.getImageData(0, 0, w, h), px = im.data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const amostra = Array.from(lum.filter((_, i) => i % 7 === 0)).sort((a, b) => a - b);
    const papel = Math.max(90, amostra[Math.floor(amostra.length * 0.9)]); // brilho típico do papel
    const corte = papel * 0.8;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, j = i * 4;
      if (lum[i] >= corte) { px[j] = px[j + 1] = px[j + 2] = 255; continue; }
      const f = 255 / papel; // normaliza o papel para branco e realça a tinta
      for (let q = 0; q < 3; q++) px[j + q] = Math.max(0, Math.min(255, px[j + q] * f * 0.92));
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    ctx.putImageData(im, 0, 0);
    const m = 10;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const r = el('canvas', { width: String(cw), height: String(ch) });
    const rc = r.getContext('2d');
    rc.fillStyle = '#fff'; rc.fillRect(0, 0, cw, ch);
    rc.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
    const blob = await new Promise(ok => r.toBlob(ok, 'image/jpeg', 0.92));
    return { jpeg: paraBase64(new Uint8Array(await blob.arrayBuffer())), w: cw, h: ch };
  } catch { return null; }
}

// ---------- Declarações, relatório e recibos ----------
// Versão 10: seis modelos próprios (redação de Rodrigo, alinhada à Resolução CFP 06/2019),
// logotipo no topo, rodapé com clínica e CNPJ e assinatura sem CPF.
const MODELOS_DOC = {
  inicio: 'Declaração de início de tratamento',
  acompanhamento: 'Declaração de acompanhamento',
  horarios: 'Declaração de acompanhamento com dias e horários',
  comparecimento: 'Declaração de comparecimento',
  pessoal: 'Declaração de análise ou psicoterapia pessoal',
  relatorio: 'Relatório psicológico para reembolso',
  reembolso: 'Declaração de reembolso (quadros: paciente, diagnóstico, justificativa)',
  recibo: 'Recibo para reembolso'
};
const DOC_ADM = ['comparecimento', 'recibo'];                       // os únicos que o administrativo emite e vê
const DOC_SESSOES = ['comparecimento', 'recibo', 'pessoal', 'relatorio']; // usam os atendimentos do período
const tituloPdf = k => ({ horarios: 'Declaração de acompanhamento', pessoal: 'Declaração', relatorio: 'Relatório psicológico', reembolso: 'Relatório psicológico para fins de reembolso', recibo: 'Recibo' }[k] || MODELOS_DOC[k] || '');
const CONFIDENCIAL = ['relatorio', 'reembolso'];
const DIAS_FRASE = ['aos domingos', 'às segundas-feiras', 'às terças-feiras', 'às quartas-feiras', 'às quintas-feiras', 'às sextas-feiras', 'aos sábados'];

function diasHorariosDe(c) {
  const hs = horariosDe(c).filter(h => h.hora !== '' && h.dia !== undefined && h.dia !== '');
  if (!hs.length) return '';
  return listaNatural(hs.map(h => `${DIAS_FRASE[Number(h.dia)] || ''}, às ${horaCurta(h.hora)}`.trim()));
}
function primeiraPresenca(pid) {
  return atendimentosDe(pid).filter(a => a.presenca === 'realizada').map(a => a.data).sort()[0] || '';
}

function novaDeclaracao(p, opcoes = {}) {
  const h = hojeISO();
  const c = cadastroDe(p.id) || p;
  const pc = pacientes.find(x => x.id === p.id) || { dados: {} };
  const de = opcoes.de || h.slice(0, 8) + '01', ate = opcoes.ate || h;
  declaracao = {
    pid: p.id, modelo: opcoes.modelo || (modo === 'dono' ? 'acompanhamento' : 'comparecimento'), soPagas: !!opcoes.soPagas, de, ate, excluidas: new Set(),
    valor: valorPadrao(c), pagador: c.pagador || '', cpfPagador: c.cpfPagador || '', emissao: h, texto: '', editado: false,
    // comuns às declarações
    incluirCpf: true, finalidade: '',
    inicio: pc.dados?.inicio || sessoesDe(p.id)[0]?.data || primeiraPresenca(p.id) || '',
    // dias e horários
    diasHorarios: diasHorariosDe(c) || pc.dados?.frequencia || '', termino: '',
    // comparecimento de responsável
    doResponsavel: false, responsavel: c.pagador || '', cpfResponsavel: c.cpfPagador || '', nomeDependente: false,
    // análise ou psicoterapia pessoal
    instituicao: '', processo: 'análise pessoal', emAndamento: true,
    // relatório
    finalidadeRel: '', frequenciaRel: 'semanais', duracao: '50', demanda: '', analise: '', conclusao: '', cid: '',
    // relatório em quadros (versão 50)
    estadoCivil: '', diagnostico: 'De acordo com o CID 10: ', justificativa: '', historico: '', planejamento: ''
  };
  if (modo !== 'dono' && !DOC_ADM.includes(declaracao.modelo)) declaracao.modelo = 'comparecimento';
  ir({ tela: 'declaracao', pid: p.id });
}
function sessoesDeclaracao(c, dc) { // atendimentos da agenda
  return atendimentosDe(c.id).filter(a => (dc.modelo === 'recibo' && dc.soPagas ? a.pagamento === 'pago' : a.presenca === 'realizada') && a.data >= dc.de && a.data <= dc.ate);
}
function textoDeclaracao(c, dc) {
  const ss = sessoesDeclaracao(c, dc).filter(s => !dc.excluidas.has(s.id));
  const datas = ss.map(s => dataCurta(s.data));
  const cpf = (c.cpf || '').trim();
  const quem = cpf ? `${c.nome} (CPF ${cpf})` : c.nome; // usado no recibo
  const id = dc.incluirCpf && cpf ? `${c.nome}, CPF ${cpf},` : c.nome;
  const ini = dc.inicio ? dataExtenso(dc.inicio) : '[data de início]';
  const fin = dc.finalidade.trim() ? `\n\nDeclaração emitida a pedido do(a) interessado(a), para fins de ${dc.finalidade.trim().replace(/\.$/, '')}.` : '';
  const fecho = '\n\nColoco-me à disposição para eventuais esclarecimentos.';
  const n = ss.length;

  if (dc.modelo === 'inicio')
    return `Declaro, para os devidos fins, que ${id} iniciou acompanhamento psicológico sob meus cuidados profissionais em ${ini}.${fin}${fecho}`;
  if (dc.modelo === 'acompanhamento')
    return `Declaro, para os devidos fins, que ${id} encontra-se em acompanhamento psicológico sob meus cuidados profissionais desde ${ini}.${fin}${fecho}`;
  if (dc.modelo === 'horarios') {
    const end = (perfil.endereco || '').trim();
    const term = dc.termino ? `A previsão de término do acompanhamento é ${dataExtenso(dc.termino)}.` : 'Não há, até o momento, previsão de término do acompanhamento.';
    return `Declaro, para os devidos fins, que ${id} encontra-se em acompanhamento psicológico sob meus cuidados profissionais desde ${ini}, com sessões realizadas ${dc.diasHorarios.trim() || '[dias e horários]'}${end ? `, no consultório situado à ${end}` : ''}.\n\n${term}${fin}${fecho}`;
  }
  if (dc.modelo === 'pessoal') {
    const inst = dc.instituicao.trim();
    const qtd = n ? `${n} (${porExtenso(n)}) ${n === 1 ? 'sessão' : 'sessões'}` : '[número de sessões]';
    const andamento = dc.emAndamento ? '\n\nO processo encontra-se em andamento até a presente data.' : '';
    return `Declaro, para fins de comprovação${inst ? ` junto a ${inst}` : ''}, que ${id} realizou ${dc.processo} sob meus cuidados profissionais no período de ${dataCurta(dc.de)} a ${dataCurta(dc.ate)}, totalizando ${qtd}.${andamento}${fecho}`;
  }
  if (dc.modelo === 'reembolso') {
    // Cada quadro é um parágrafo que começa com "### TÍTULO"; as linhas seguintes são o conteúdo do quadro.
    const pc = pacientes.find(x => x.id === c.id) || { dados: {} };
    const nasc = pc.dados?.nascimento || c.nascimento || '';
    let idade = '';
    if (nasc) { const h = new Date(), d = paraData(nasc); let a = h.getFullYear() - d.getFullYear(); if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) a--; idade = `${a} anos`; }
    const dadosLinha = [nasc && `Nascimento: ${dataCurta(nasc)}`, idade && `Idade: ${idade}`, dc.estadoCivil.trim() && `Estado civil: ${dc.estadoCivil.trim()}`, dc.incluirCpf && cpf && `CPF: ${typeof formatarCpf === 'function' ? formatarCpf(cpf) : cpf}`].filter(Boolean).join('  ·  ');
    return [
      `### PACIENTE\nNome: ${c.nome}${dadosLinha ? '\n' + dadosLinha : ''}`,
      `### DIAGNÓSTICO\n${dc.diagnostico.trim() || '[diagnóstico]'}`,
      `### DESCRIÇÃO E JUSTIFICATIVA\n${dc.justificativa.trim() || '[descrição e justificativa]'}`,
      `### HISTÓRICO\n${dc.historico.trim() || '[histórico]'}`,
      `### PLANEJAMENTO TERAPÊUTICO\n${dc.planejamento.trim() || '[planejamento terapêutico]'}`].join('\n\n');
  }
  if (dc.modelo === 'relatorio') {
    const pc = pacientes.find(x => x.id === c.id) || { dados: {} };
    const nasc = pc.dados?.nascimento || c.nascimento || '';
    const qtd = n ? `${n} (${porExtenso(n)}) ${n === 1 ? 'sessão' : 'sessões'}` : '[número de sessões]';
    const partes = [
      '## 1. Identificação',
      `Autor: ${perfil.nome || '[seu nome]'} – CRP ${perfil.crp || '[CRP]'}\nInteressado: ${c.nome}${nasc ? ` – nascimento ${dataCurta(nasc)}` : ''}${dc.incluirCpf && cpf ? ` – CPF ${cpf}` : ''}\nFinalidade: instruir solicitação de reembolso junto a ${dc.finalidadeRel.trim() || '[operadora ou plano]'}`,
      '## 2. Descrição da demanda', dc.demanda.trim() || '[descreva a demanda]',
      '## 3. Procedimento',
      `Atendimento psicológico individual, em sessões ${dc.frequenciaRel.trim() || 'semanais'} de ${dc.duracao.trim() || '50'} minutos, iniciado em ${ini}. No período de ${dataCurta(dc.de)} a ${dataCurta(dc.ate)}, foram realizadas ${qtd}.`,
      '## 4. Análise', dc.analise.trim() || '[escreva a análise]',
      '## 5. Conclusão', dc.conclusao.trim() || '[escreva a conclusão]'];
    if (dc.cid.trim()) partes.push(`CID: ${dc.cid.trim()}`);
    partes.push('Este relatório tem caráter sigiloso e destina-se exclusivamente à finalidade acima indicada.');
    return partes.join('\n\n');
  }
  if (dc.modelo === 'recibo') {
    const vals = ss.map(s => valorNum(s.valor) || valorNum(dc.valor));
    const total = vals.reduce((t, v) => t + v, 0);
    const iguais = vals.every(v => v === vals[0]);
    const pag = dc.pagador.trim();
    const pagador = pag ? (dc.cpfPagador.trim() ? `${pag} (CPF ${dc.cpfPagador.trim()})` : pag) : quem;
    const detalhe = !n ? 'realizadas em [datas]'
      : iguais ? (n === 1 ? `no valor de R$ ${reais(vals[0])}, realizada em ${datas[0]}` : `no valor de R$ ${reais(vals[0])} cada, realizadas nas datas ${listaNatural(datas)}`)
        : `realizadas em ${listaNatural(ss.map((s, i) => `${dataCurta(s.data)} (R$ ${reais(vals[i])})`))}`;
    return `Recebi de ${pagador} a importância de R$ ${reais(total)} (${reaisPorExtenso(total)}), referente a ${n} ${n === 1 ? 'sessão' : 'sessões'} de psicoterapia${pag ? ` de ${quem}` : ''}, ${detalhe}.\n\nPara clareza, firmo o presente recibo.`;
  }
  // comparecimento
  const hora = n === 1 && ss[0].hora ? `, às ${horaCurta(ss[0].hora)}` : '';
  const quando = n === 1 ? `em ${datas[0]}${hora}` : n ? 'nas seguintes datas: ' + listaNatural(datas) : 'em [datas]';
  if (dc.doResponsavel) {
    const resp = dc.responsavel.trim() || '[nome do responsável]';
    const cpfR = dc.cpfResponsavel.trim();
    const papel = dc.nomeDependente ? `na condição de responsável por ${c.nome}, em atendimento psicológico sob meus cuidados profissionais` : 'na condição de responsável, acompanhando dependente em atendimento psicológico sob meus cuidados profissionais';
    return `Declaro, para os devidos fins, que ${resp}${cpfR ? `, CPF ${cpfR},` : ''} compareceu a este consultório ${quando}, ${papel}.${fin}${fecho}`;
  }
  return `Declaro, para os devidos fins, que ${id} compareceu a atendimento psicológico sob meus cuidados profissionais ${quando}.${fin}${fecho}`;
}

function telaDeclaracao(pid) {
  const p = cadastroDe(pid);
  const dc = declaracao;
  if (!p || !dc || dc.pid !== pid) { history.back(); return; }
  if (modo !== 'dono' && !DOC_ADM.includes(dc.modelo)) dc.modelo = 'comparecimento';
  const usaSessoes = DOC_SESSOES.includes(dc.modelo);
  const texto = el('textarea', { rows: '6', 'aria-label': 'Texto do documento' });
  const folha = el('div', { class: 'folha-caixa' });
  const listaSessoes = el('div', { class: 'lista-marcar' });
  const refazer = el('button', { type: 'button', class: 'link', text: 'Refazer o texto automático', onclick: () => { dc.editado = false; atualizar(); } });
  const alertas = el('div', { class: 'pilha-pequena' });

  const atualizar = () => {
    if (!dc.editado) dc.texto = textoDeclaracao(p, dc);
    texto.value = dc.texto; crescer(texto);
    refazer.hidden = !dc.editado;
    folha.replaceChildren(folhaPrevia(p, dc.texto, dc));
    const avisos = [];
    if (!p.cpf && dc.modelo !== 'relatorio') avisos.push('O CPF do paciente não está no cadastro. Planos de saúde costumam exigi-lo.');
    if (modo === 'adm' && !assinatura) avisos.push('O documento sai sem a imagem da assinatura. Rodrigo assina depois, à mão ou pelo gov.br.');
    if (usaSessoes && !sessoesDeclaracao(p, dc).filter(s => !dc.excluidas.has(s.id)).length) avisos.push('Nenhum atendimento marcado neste período.');
    if (dc.modelo === 'recibo' && /R\$ 0,00 \(/.test(dc.texto)) avisos.push('Informe o valor da sessão.');
    if (/\[[^\]]+\]/.test(dc.texto)) avisos.push('Há informações entre colchetes para completar.');
    if (perfilIncompleto()) avisos.push('Faltam seu nome e CRP em Dados profissionais.');
    alertas.replaceChildren(...avisos.map(a => el('p', { class: 'faixa', text: a })));
  };
  const desenharSessoes = () => {
    const ss = sessoesDeclaracao(p, dc);
    listaSessoes.replaceChildren(...(ss.length ? ss.map(s => el('label', { class: 'marcar' },
      el('input', { type: 'checkbox', checked: !dc.excluidas.has(s.id), onchange: e => { if (e.target.checked) dc.excluidas.delete(s.id); else dc.excluidas.add(s.id); atualizar(); } }),
      el('span', { text: `${dataCurta(s.data)}, ${diaSemana(s.data)}` })))
      : [el('p', { class: 'suave pequeno', text: dc.modelo === 'recibo' && dc.soPagas ? 'Nenhum atendimento pago neste período.' : 'Nenhum atendimento com presença registrada neste período.' })]));
  };
  texto.addEventListener('input', () => { dc.texto = texto.value; dc.editado = true; crescer(texto); refazer.hidden = false; folha.replaceChildren(folhaPrevia(p, dc.texto, dc)); });

  // Mudar um campo refaz o texto automático, a menos que o texto final já tenha sido editado à mão
  // (nesse caso aparece "Refazer o texto automático").
  const mudou = () => atualizar();
  const campoData = (rotulo, chave, redesenhar) => el('label', { class: 'campo' }, el('span', { text: rotulo }),
    el('input', { type: 'date', value: dc[chave], onchange: e => { dc[chave] = e.target.value; if (redesenhar) desenharSessoes(); mudou(); } }));
  const campoTexto = (rotulo, chave, extra = {}) => el('label', { class: 'campo' + (extra.largo ? ' largo' : '') }, el('span', { text: rotulo }),
    el('input', { type: 'text', value: dc[chave], placeholder: extra.placeholder, inputmode: extra.inputmode, oninput: e => { dc[chave] = e.target.value; mudou(); } }));
  const caixa = (rotulo, chave, dica) => el('label', { class: 'campo largo' }, el('span', { text: rotulo }),
    (() => { const t = el('textarea', { rows: '3', placeholder: dica || '' }); t.value = dc[chave]; t.addEventListener('input', () => { dc[chave] = t.value; crescer(t); mudou(); }); setTimeout(() => crescer(t)); return t; })());
  const marcar = (rotulo, chave, redesenhar = false) => el('label', { class: 'marcar largo' },
    el('input', { type: 'checkbox', checked: !!dc[chave], onchange: e => { dc[chave] = e.target.checked; if (redesenhar) telaDeclaracao(pid); else mudou(); } }),
    el('span', { text: rotulo }));

  const disponiveis = Object.keys(MODELOS_DOC).filter(k => modo === 'dono' || DOC_ADM.includes(k));
  let tipos;
  if (disponiveis.length > 2) {
    const sel = el('select', { 'aria-label': 'Tipo de documento' }, disponiveis.map(k => el('option', { value: k, text: MODELOS_DOC[k] })));
    sel.value = dc.modelo;
    sel.addEventListener('change', () => {
      dc.modelo = sel.value; dc.editado = false;
      if ((dc.modelo === 'pessoal' || dc.modelo === 'relatorio') && dc.de === hojeISO().slice(0, 8) + '01') {
        const pr = primeiraPresenca(pid); if (pr) dc.de = pr;
      }
      telaDeclaracao(pid);
    });
    tipos = el('label', { class: 'campo' }, el('span', { text: 'Tipo de documento' }), sel);
  } else {
    tipos = el('div', { class: 'segmento dois', role: 'radiogroup', 'aria-label': 'Tipo de documento' },
      disponiveis.map(k => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(dc.modelo === k), class: dc.modelo === k ? 'ativo' : '', text: { comparecimento: 'Comparecimento', recibo: 'Recibo' }[k] || MODELOS_DOC[k],
        onclick: () => { dc.modelo = k; dc.editado = false; telaDeclaracao(pid); }
      })));
  }

  const ehDeclaracao = !['recibo', 'relatorio', 'reembolso'].includes(dc.modelo);
  const blocosModelo = [];
  if (['inicio', 'acompanhamento', 'horarios', 'relatorio'].includes(dc.modelo))
    blocosModelo.push(cartao('Início do acompanhamento', 'calendario', el('div', { class: 'grade duas' }, campoData('Data de início', 'inicio', false))));
  if (dc.modelo === 'horarios')
    blocosModelo.push(cartao('Dias e horários', 'calendario', el('div', { class: 'grade' },
      campoTexto('Dias e horários das sessões', 'diasHorarios', { largo: true, placeholder: 'às terças-feiras, às 18h' }),
      el('div', { class: 'grade duas' }, campoData('Previsão de término (deixe vazio se não houver)', 'termino', false)))));
  if (dc.modelo === 'comparecimento')
    blocosModelo.push(cartao('Quem compareceu', 'pessoa', el('div', { class: 'grade' },
      marcar('Foi um responsável (pai, mãe, familiar) que acompanhou o paciente', 'doResponsavel', true),
      dc.doResponsavel && campoTexto('Nome do responsável', 'responsavel', { largo: true }),
      dc.doResponsavel && campoTexto('CPF do responsável (opcional)', 'cpfResponsavel', { inputmode: 'numeric' }),
      dc.doResponsavel && marcar('Incluir o nome do paciente (por sigilo, pode ficar de fora)', 'nomeDependente'))));
  if (dc.modelo === 'pessoal') {
    const proc = el('select', { 'aria-label': 'Tipo de processo' }, ['análise pessoal', 'psicoterapia individual'].map(v => el('option', { value: v, text: v[0].toUpperCase() + v.slice(1) })));
    proc.value = dc.processo;
    proc.addEventListener('change', () => { dc.processo = proc.value; mudou(); });
    blocosModelo.push(cartao('Análise ou psicoterapia pessoal', 'pessoa', el('div', { class: 'grade' },
      el('label', { class: 'campo' }, el('span', { text: 'Processo' }), proc),
      campoTexto('Instituição (opcional)', 'instituicao', { placeholder: 'Ex.: instituição de formação' }),
      marcar('O processo continua em andamento', 'emAndamento'))));
  }
  if (dc.modelo === 'reembolso')
    blocosModelo.push(cartao('Quadros do relatório', 'texto', el('div', { class: 'grade' },
      campoTexto('Estado civil do paciente', 'estadoCivil', { placeholder: 'Ex.: Solteiro' }),
      caixa('Diagnóstico', 'diagnostico', 'Ex.: De acordo com o CID 10: F41.2 – …'),
      caixa('Descrição e justificativa', 'justificativa'),
      caixa('Histórico', 'historico'),
      caixa('Planejamento terapêutico', 'planejamento', 'Ex.: 40 (quarenta) sessões.'))));
  if (dc.modelo === 'relatorio')
    blocosModelo.push(cartao('Partes do relatório', 'texto', el('div', { class: 'grade' },
      campoTexto('Operadora ou plano de saúde', 'finalidadeRel', { largo: true }),
      campoTexto('Frequência das sessões', 'frequenciaRel', { placeholder: 'semanais' }),
      campoTexto('Duração (minutos)', 'duracao', { inputmode: 'numeric' }),
      caixa('Descrição da demanda', 'demanda'),
      caixa('Análise', 'analise'),
      caixa('Conclusão', 'conclusao', 'Ex.: indicação de continuidade e número de sessões previstas'),
      campoTexto('CID (opcional)', 'cid', { largo: true, placeholder: 'Deixe vazio para não incluir' }))));
  if (dc.modelo !== 'recibo') {
    const extras = [];
    if (p.cpf) extras.push(marcar(CONFIDENCIAL.includes(dc.modelo) ? 'Incluir o CPF do paciente' : 'Incluir o CPF do paciente no texto', 'incluirCpf'));
    if (ehDeclaracao) extras.push(campoTexto('Finalidade (opcional)', 'finalidade', { largo: true, placeholder: 'Ex.: apresentação ao empregador' }));
    if (extras.length) blocosModelo.push(cartao('Opções', 'tag', el('div', { class: 'grade' }, extras)));
  }

  mostrar(
    cabecalho(MODELOS_DOC[dc.modelo], { voltar: true, sub: p.nome }),
    el('div', { class: 'conteudo pilha' },
      tipos,
      ...blocosModelo,
      usaSessoes && cartao(dc.modelo === 'pessoal' || dc.modelo === 'relatorio' ? 'Período e sessões' : 'Sessões incluídas', 'calendario',
        el('div', { class: 'grade duas' }, campoData('De', 'de', true), campoData('Até', 'ate', true)),
        listaSessoes),
      dc.modelo === 'recibo' && cartao('Valores', 'tag',
        el('div', { class: 'grade' },
          el('label', { class: 'marcar largo' },
            el('input', { type: 'checkbox', checked: dc.soPagas, onchange: e => { dc.soPagas = e.target.checked; dc.excluidas.clear(); desenharSessoes(); mudou(); } }),
            el('span', { text: 'Só atendimentos marcados como pagos' })),
          campoTexto('Valor por sessão (R$), para sessões sem valor próprio', 'valor', { inputmode: 'decimal', placeholder: '200,00' }),
          campoTexto('Pago por (se não for o paciente)', 'pagador', { placeholder: 'Nome do responsável' }),
          campoTexto('CPF de quem pagou', 'cpfPagador', { inputmode: 'numeric' }))),
      cartao('Texto final (pode editar à vontade)', 'texto', texto, refazer,
        el('div', { class: 'grade duas' }, campoData('Data do documento', 'emissao', false))),
      alertas,
      cartao('Como vai ficar', 'arquivo', folha),
      el('p', { class: 'suave pequeno', text: dc.modelo === 'relatorio'
        ? 'O relatório segue as partes previstas na Resolução CFP 06/2019 (identificação, demanda, procedimento, análise e conclusão). Ele fica só na área clínica.'
        : 'As declarações seguem a Resolução CFP 06/2019: registram comparecimento, acompanhamento e valores, sem diagnóstico nem conteúdo das sessões.' }),
      modo === 'dono' && el('button', { type: 'button', class: 'link', text: 'Ver a Resolução CFP 06/2019', onclick: () => ir({ tela: 'normas', id: 'res-06-2019' }) })),
    el('button', { type: 'button', class: 'fab estendido', onclick: () => emitirDeclaracao(p) }, icone('assinar'), el('span', { text: 'Gerar PDF' })));
  if (usaSessoes) desenharSessoes();
  atualizar();
}

function linhasRodape() {
  const junta = (...xs) => xs.filter(x => (x || '').trim()).join(' · ');
  return [
    junta(perfil.clinica, perfil.cnpj && 'CNPJ ' + perfil.cnpj),
    junta(perfil.crp && 'CRP ' + perfil.crp, perfil.telefone, perfil.email),
    (perfil.endereco || '').trim()
  ].filter(Boolean);
}
function tituloProfissional() { return [perfil.titulo, perfil.crp && 'CRP ' + perfil.crp].filter(x => (x || '').trim()).join(', '); }
function localEData(ymd) { return `${perfil.cidade ? perfil.cidade.trim() + ', ' : ''}${dataExtenso(ymd)}.`; }

// Prévia em HTML da folha, no mesmo desenho do PDF.
function folhaPrevia(p, texto, dc = null) {
  const titulo = dc ? tituloPdf(dc.modelo) : '';
  const assin = el('div', { class: 'folha-assinatura' });
  if (assinatura) {
    const c = el('canvas', { 'aria-label': 'Carimbo e assinatura' });
    assin.append(c);
    desenharImagem(c, deBase64(assinatura.jpeg), 'image/jpeg', 700).catch(() => { });
  }
  let topo;
  if (perfil.logo) {
    const c = el('canvas', { 'aria-label': 'Logotipo', style: 'max-height:56px;width:auto;max-width:60%;display:block' });
    desenharImagem(c, deBase64(perfil.logo.jpeg), 'image/jpeg', 600).catch(() => { });
    topo = el('div', { class: 'folha-topo', style: 'align-items:flex-start;text-align:left' }, c);
  } else topo = el('div', { class: 'folha-topo' }, el('strong', { text: perfil.nome || 'Seu nome' }), el('span', { text: tituloProfissional() }));
  const pars = (texto || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  return el('div', { class: 'folha' },
    topo,
    titulo && el('h4', { text: titulo.toUpperCase() }),
    CONFIDENCIAL.includes(dc?.modelo) && el('p', { class: 'centro', style: 'font-style:italic;margin-top:-6px', text: 'Confidencial' }),
    pars.map(par => par.startsWith('### ') ? el('div', { class: 'folha-quadro' }, el('p', { class: 'folha-quadro-titulo', text: par.slice(4).split('\n')[0] }), el('p', { style: 'white-space:pre-line', text: par.split('\n').slice(1).join('\n') }))
      : par.startsWith('## ') ? el('p', { style: 'font-weight:700;margin-bottom:2px', text: par.slice(3) }) : el('p', { style: 'white-space:pre-line', text: par })),
    dc && el('p', { class: 'folha-data', text: localEData(dc.emissao) }),
    assin,
    el('div', { class: 'folha-nome' }, el('span', { text: perfil.nome }), perfil.titulo && el('span', { text: perfil.titulo }), perfil.crp && el('span', { text: 'CRP ' + perfil.crp })),
    el('div', { class: 'folha-rodape' }, linhasRodape().map(l => el('span', { text: l }))));
}

async function emitirDeclaracao(p) {
  const dc = declaracao;
  if (perfilIncompleto()) {
    const ir2 = await dialogo({ titulo: 'Faltam seus dados', texto: 'Preencha ao menos seu nome e CRP para gerar o documento.', botoes: [{ rotulo: 'Agora não', valor: null }, { rotulo: 'Preencher', valor: true, estilo: 'primario' }] });
    if (ir2) ir({ tela: 'perfil' });
    return;
  }
  if (/\[datas\]/.test(dc.texto)) return aviso('Faltam as datas', 'Marque ao menos uma sessão ou escreva as datas no texto.');
  if (/\[[^\]]+\]/.test(dc.texto)) {
    const seguir = await dialogo({ titulo: 'Há campos por completar', texto: 'O texto ainda tem informações entre colchetes, como [data de início]. Gerar assim mesmo?', botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Gerar assim', valor: true, estilo: 'primario' }] });
    if (!seguir) return;
  }
  if (!assinatura && modo === 'dono') {
    const seguir = await dialogo({ titulo: 'Sem carimbo e assinatura', texto: 'O documento sairá sem a imagem do carimbo e da assinatura. Gerar assim mesmo?', botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Gerar assim', valor: true, estilo: 'primario' }] });
    if (!seguir) return;
  }
  const bytes = gerarPdfDocumento({ titulo: tituloPdf(dc.modelo), subtitulo: CONFIDENCIAL.includes(dc.modelo) ? 'Confidencial' : '', texto: dc.texto, emissao: dc.emissao });
  const titulo = MODELOS_DOC[dc.modelo];
  const periodo = !DOC_SESSOES.includes(dc.modelo) ? '' : (dc.de.slice(0, 7) === dc.ate.slice(0, 7) ? ` (${mesAno(dc.de)})` : ` (${dataCurta(dc.de)} a ${dataCurta(dc.ate)})`);
  const nomeArq = `${titulo} - ${p.nome} - ${dc.emissao}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  const d = await guardarDocumento(p, 'emitido', { nome: nomeArq, mime: 'application/pdf', bytes, descricao: titulo + periodo, data: dc.emissao, texto: dc.texto, modelo: dc.modelo, adm: DOC_ADM.includes(dc.modelo) });
  declaracao = null;
  const acao = await dialogo({
    titulo: 'Documento pronto',
    texto: 'Ficou guardado em Documentos. Para mandar ao paciente, toque em Enviar e escolha o WhatsApp.',
    botoes: [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Enviar', valor: true, estilo: 'primario' }]
  });
  history.back();
  if (acao) await compartilharDocumento(d, bytes);
}
// ---------- Gerador de PDF (feito aqui mesmo, sem biblioteca e sem internet) ----------
const LARG_HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,556,222,556,333,1000,556,556,333,1000,667,333,1000,556,611,556,556,222,222,333,333,350,556,1000,333,1000,500,333,944,556,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const LARG_HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,611,278,556,500,1000,556,556,333,1000,667,333,1000,611,611,611,611,278,278,500,500,350,556,1000,333,1000,556,333,944,611,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
const ESPECIAIS_1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'ª': 0xAA, 'º': 0xBA };
function codigos1252(s) {
  const out = [];
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (ESPECIAIS_1252[ch]) out.push(ESPECIAIS_1252[ch]);
    else if (ch === '\t') out.push(32);
    else out.push(63);
  }
  return out;
}
const largura = (cods, tam, negrito) => cods.reduce((t, c) => t + ((negrito ? LARG_HELV_B : LARG_HELV)[c - 32] || 500), 0) * tam / 1000;
function literalPdf(cods) {
  let s = '(';
  for (const c of cods) s += c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : String.fromCharCode(c);
  return s + ')';
}
function quebrarLinhas(texto, tam, max, negrito = false) {
  const linhas = [];
  for (const bruto of texto.split('\n')) {
    const palavras = bruto.trim().split(/\s+/).filter(Boolean);
    let atual = [];
    for (const pal of palavras) {
      const teste = [...atual, pal].join(' ');
      if (atual.length && largura(codigos1252(teste), tam, negrito) > max) { linhas.push({ palavras: atual, fim: false }); atual = [pal]; }
      else atual.push(pal);
    }
    linhas.push({ palavras: atual, fim: true });
  }
  return linhas;
}

function gerarPdfDocumento({ titulo, subtitulo = '', texto, emissao, anexos = [] }) {
  const W = 595.28, H = 841.89, ME = 72, MD = 72, MI = 70, LARG = W - ME - MD;
  const paginas = [];
  const imagens = []; // { nome, bytes, w, h }
  let ops = [], y = H - 64;
  const novaPagina = () => { paginas.push(ops); ops = []; y = H - 64; };
  let nomeLogo = null;
  if (perfil.logo?.jpeg) { nomeLogo = 'Im' + (imagens.length + 1); imagens.push({ nome: nomeLogo, bytes: deBase64(perfil.logo.jpeg), w: perfil.logo.w, h: perfil.logo.h }); }
  const cabeca = () => {
    if (nomeLogo) {
      const k = Math.min(200 / perfil.logo.w, 58 / perfil.logo.h);
      const iw = perfil.logo.w * k, ih = perfil.logo.h * k;
      const topo = H - 40;
      ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ME} ${(topo - ih).toFixed(2)} cm /${nomeLogo} Do Q`);
      y = topo - ih - 40;
      return;
    }
    const nome = codigos1252(perfil.nome), sub = codigos1252(tituloProfissional());
    ops.push(`BT /F2 13 Tf ${(W - largura(nome, 13, true)) / 2} ${y} Td ${literalPdf(nome)} Tj ET`);
    y -= 16;
    if (sub.length) { ops.push(`0.35 g BT /F1 10 Tf ${(W - largura(sub, 10)) / 2} ${y} Td ${literalPdf(sub)} Tj ET 0 g`); y -= 12; }
    ops.push(`0.6 G 0.6 w ${ME} ${y} m ${W - MD} ${y} l S 0 G`);
    y -= 52;
  };
  const rodape = () => {
    let yy = 40;
    for (const l of [...linhasRodape()].reverse()) {
      const c = codigos1252(l);
      ops.push(`0.4 g BT /F1 8.5 Tf ${(W - largura(c, 8.5)) / 2} ${yy} Td ${literalPdf(c)} Tj ET 0 g`);
      yy += 11;
    }
  };
  cabeca();
  if (titulo) {
    const t = codigos1252(titulo.toUpperCase());
    ops.push(`BT /F2 14 Tf ${(W - largura(t, 14, true)) / 2} ${y} Td ${literalPdf(t)} Tj ET`);
    y -= subtitulo ? 18 : 44;
    if (subtitulo) {
      const s = codigos1252(subtitulo);
      ops.push(`0.35 g BT /F1 10.5 Tf ${(W - largura(s, 10.5)) / 2} ${y} Td ${literalPdf(s)} Tj ET 0 g`);
      y -= 34;
    }
  }
  const TAM = 11.5, ENTRE = 18;
  const pars = texto.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  for (const par of pars) {
    if (par.startsWith('### ')) { // quadro com borda: título centralizado em negrito e o conteúdo dentro (relatório para reembolso)
      const [tit, ...resto] = par.slice(4).split('\n');
      const PAD = 10, larguraInterna = LARG - 2 * PAD;
      const linhas = quebrarLinhas(resto.join('\n'), TAM - 0.5, larguraInterna);
      const altura = PAD + 16 + linhas.length * (ENTRE - 2) + PAD;
      if (y - altura < MI + 40) { rodape(); novaPagina(); cabeca(); }
      const topo = y + 4;
      ops.push(`0.8 w ${ME} ${(topo - altura).toFixed(2)} ${LARG} ${altura.toFixed(2)} re S`);
      const ct = codigos1252(tit.trim());
      let yy = topo - PAD - 9;
      ops.push(`BT /F2 ${TAM - 1} Tf 0 Tw ${((W - largura(ct, TAM - 1, true)) / 2).toFixed(2)} ${yy.toFixed(2)} Td ${literalPdf(ct)} Tj ET`);
      yy -= 18;
      const centralizar = linhas.length === 1;
      for (const ln of linhas) {
        const cods = codigos1252(ln.palavras.join(' '));
        const espacos = ln.palavras.length - 1;
        const tw = !ln.fim && espacos > 0 ? (larguraInterna - largura(cods, TAM - 0.5)) / espacos : 0;
        const x = centralizar ? (W - largura(cods, TAM - 0.5)) / 2 : ME + PAD;
        ops.push(`BT /F1 ${TAM - 0.5} Tf ${tw.toFixed(3)} Tw ${x.toFixed(2)} ${yy.toFixed(2)} Td ${literalPdf(cods)} Tj ET`);
        yy -= ENTRE - 2;
      }
      y = topo - altura - 16;
      continue;
    }
    if (par.startsWith('## ')) { // subtítulo de seção (relatório)
      if (y < MI + 80) { rodape(); novaPagina(); cabeca(); }
      y -= 4;
      const c = codigos1252(par.slice(3).trim());
      ops.push(`BT /F2 ${TAM} Tf 0 Tw ${ME} ${y.toFixed(2)} Td ${literalPdf(c)} Tj ET`);
      y -= ENTRE;
      continue;
    }
    for (const ln of quebrarLinhas(par, TAM, LARG)) {
      if (y < MI + 40) { rodape(); novaPagina(); cabeca(); }
      const cods = codigos1252(ln.palavras.join(' '));
      const espacos = ln.palavras.length - 1;
      const tw = !ln.fim && espacos > 0 ? (LARG - largura(cods, TAM)) / espacos : 0;
      ops.push(`BT /F1 ${TAM} Tf ${tw.toFixed(3)} Tw ${ME} ${y.toFixed(2)} Td ${literalPdf(cods)} Tj ET`);
      y -= ENTRE;
    }
    y -= 8;
  }
  // local e data, alinhados à direita; a assinatura fica sempre na mesma página que a data
  if (y < MI + 200) { rodape(); novaPagina(); cabeca(); }
  y -= 18;
  const ld = codigos1252(localEData(emissao));
  ops.push(`BT /F1 ${TAM} Tf 0 Tw ${(W - MD - largura(ld, TAM)).toFixed(2)} ${y.toFixed(2)} Td ${literalPdf(ld)} Tj ET`);
  y -= 30;
  // carimbo e assinatura
  if (assinatura) {
    const nome = 'Im' + (imagens.length + 1);
    imagens.push({ nome, bytes: deBase64(assinatura.jpeg), w: assinatura.w, h: assinatura.h });
    const k = Math.min(230 / assinatura.w, 95 / assinatura.h);
    const iw = assinatura.w * k, ih = assinatura.h * k;
    y -= ih;
    ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${((W - iw) / 2).toFixed(2)} ${y.toFixed(2)} cm /${nome} Do Q`);
    y -= 6;
  } else y -= 50;
  ops.push(`0 G 0.5 w ${W / 2 - 110} ${y} m ${W / 2 + 110} ${y} l S`);
  y -= 14;
  // Nome, título e CRP. O CPF do profissional não aparece nos documentos.
  for (const [l, neg, tam] of [[perfil.nome, true, 10.5], [perfil.titulo, false, 9.5], [perfil.crp ? 'CRP ' + perfil.crp : '', false, 9.5]]) {
    if (!(l || '').trim()) continue;
    const c = codigos1252(l);
    ops.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf 0 Tw ${((W - largura(c, tam, neg)) / 2).toFixed(2)} ${y.toFixed(2)} Td ${literalPdf(c)} Tj ET`);
    y -= 13;
  }
  rodape();
  paginas.push(ops);
  for (const an of anexos) { // folhas manuscritas, uma por página
    ops = []; y = H - 64; cabeca();
    const leg = codigos1252(an.legenda || '');
    ops.push(`BT /F2 11 Tf 0 Tw ${ME} ${y.toFixed(2)} Td ${literalPdf(leg)} Tj ET`);
    y -= 14;
    const nome = 'Im' + (imagens.length + 1);
    imagens.push({ nome, bytes: an.bytes, w: an.w, h: an.h });
    const k = Math.min(LARG / an.w, (y - MI - 20) / an.h), iw = an.w * k, ih = an.h * k;
    ops.push(`0.8 G 0.5 w ${((W - iw) / 2).toFixed(2)} ${(y - ih).toFixed(2)} ${iw.toFixed(2)} ${ih.toFixed(2)} re S 0 G`);
    ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${((W - iw) / 2).toFixed(2)} ${(y - ih).toFixed(2)} cm /${nome} Do Q`);
    rodape();
    paginas.push(ops);
  }
  if (paginas.length > 1) paginas.forEach((pg, i) => {
    const c = codigos1252(`Página ${i + 1} de ${paginas.length}`);
    pg.push(`0.4 g BT /F1 8.5 Tf 0 Tw ${(W - MD - largura(c, 8.5)).toFixed(2)} 22 Td ${literalPdf(c)} Tj ET 0 g`);
  });
  return montarPdf(paginas.map(o => o.join('\n')), imagens, W, H);
}

function montarPdf(conteudos, imagens, W, H) {
  imagens = !imagens ? [] : Array.isArray(imagens) ? imagens : [{ nome: 'Im1', ...imagens }];
  const partes = []; let pos = 0; const offs = [];
  const bin = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  const add = x => { const b = typeof x === 'string' ? bin(x) : x; partes.push(b); pos += b.length; };
  const base = 5 + imagens.length;
  const n = conteudos.length;
  const kids = conteudos.map((_, i) => `${base + i * 2} 0 R`).join(' ');
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (num, corpo) => { offs[num] = pos; add(`${num} 0 obj\n${corpo}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  imagens.forEach((im, i) => {
    const num = 5 + i;
    offs[num] = pos;
    add(`${num} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
    add(im.bytes);
    add('\nendstream\nendobj\n');
  });
  const xobj = imagens.length ? ` /XObject << ${imagens.map((im, i) => `/${im.nome} ${5 + i} 0 R`).join(' ')} >>` : '';
  conteudos.forEach((c, i) => {
    const idPag = base + i * 2, idCont = idPag + 1;
    obj(idPag, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj} >> /Contents ${idCont} 0 R >>`);
    const corpo = bin(c);
    offs[idCont] = pos;
    add(`${idCont} 0 obj\n<< /Length ${corpo.length} >>\nstream\n`);
    add(corpo);
    add('\nendstream\nendobj\n');
  });
  const total = base + n * 2;
  const inicioXref = pos;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  add(xref + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  const saida = new Uint8Array(pos); let k = 0;
  for (const p of partes) { saida.set(p, k); k += p.length; }
  return saida;
}


// =====================================================================
// Versão 6: agenda do dia, pagamentos, busca geral e backup em um toque
// =====================================================================
let senhaBackup = null; // senha do backup lembrada (guardada cifrada no cofre)
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const PAGAMENTO = { areceber: 'A receber', pago: 'Pago', naocobrar: 'Não cobrar' };
const horariosDe = c => (c?.horarios || []).filter(h => h && h.hora !== undefined);
const somarDias = (ymd, n) => { const d = paraData(ymd); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const agoraHHMM = () => new Date().toTimeString().slice(0, 5);
function proximoHorario(p) {
  const c = cadastroDe(p.id) || p;
  const hoje = hojeISO(), agora = agoraHHMM();
  const o = ocorrenciasNoPeriodo(c, hoje, somarDias(hoje, 60)).find(x => x.hora && !x.feriado && !x.cancelada && (x.data > hoje || x.hora >= agora));
  return o ? { data: o.data, hora: o.hora } : null;
}
const horaCurta = h => h ? horaMsg(h) : '';

// ---------- Busca em todos os pacientes ----------
let termoGeral = '';
function telaBuscaGeral() {
  const entrada = el('input', { type: 'search', placeholder: 'Tema ou palavra', 'aria-label': 'Buscar em todos os pacientes', value: termoGeral });
  const resultados = el('div', { class: 'pilha' });
  const desenhar = () => {
    termoGeral = entrada.value;
    const q = semAcento(entrada.value.trim());
    if (q.length < 2) {
      resultados.replaceChildren(el('div', { class: 'cartao vazio-cartao' }, el('span', { class: 'ic-bolha grande' }, icone('busca')),
        el('p', { text: 'Digite ao menos duas letras. A busca percorre as fichas e as sessões de todos os pacientes, inclusive arquivados, sem diferenciar acentos.' })));
      return;
    }
    const grupos = [];
    let total = 0;
    for (const p of [...pacientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
      const achados = [];
      const nomeBate = ocorrencias(p.nome, q).length > 0;
      for (const [rotulo, txt] of [['Demanda inicial', p.demanda], ['Temas recorrentes', p.temas], ['Observações', p.observacoes]]) {
        const f = ocorrencias(txt, q);
        if (f.length) achados.push({ rotulo: 'Ficha: ' + rotulo, txt, f, ir: () => ir({ tela: 'ficha', id: p.id, aba: 'ficha' }) });
      }
      const ss = sessoesDe(p.id);
      for (const s of [...ss].reverse()) {
        for (const [rotulo, txt] of [['Relato', s.relato], ['Para retomar', s.retomar], ['Temas', s.temas]]) {
          const f = ocorrencias(txt, q);
          if (f.length) { achados.push({ rotulo: `Sessão ${ss.indexOf(s) + 1}, ${dataCurta(s.data)}`, txt, f, ir: () => ir({ tela: 'sessao', pid: p.id, sid: s.id }) }); break; }
        }
      }
      if (!achados.length && !nomeBate) continue;
      total += achados.length;
      grupos.push(el('section', { class: 'cartao grupo-busca' },
        el('button', { type: 'button', class: 'grupo-topo', onclick: () => { termoBusca = entrada.value; ir({ tela: 'ficha', id: p.id, aba: achados.length ? 'buscar' : 'retomar' }); } },
          avatar(p), el('span', { class: 'nome', text: p.nome + (p.arquivado ? ' (arquivado)' : '') }),
          el('span', { class: 'suave pequeno', text: achados.length ? `${achados.length} ${achados.length === 1 ? 'lugar' : 'lugares'}` : 'nome' })),
        achados.slice(0, 3).map(a => el('button', { type: 'button', class: 'resultado-mini', onclick: a.ir },
          el('small', { class: 'suave', text: a.rotulo }), trechoMarcado(a.txt, a.f))),
        achados.length > 3 && el('button', { type: 'button', class: 'link', text: `Ver os ${achados.length} lugares`, onclick: () => { termoBusca = entrada.value; ir({ tela: 'ficha', id: p.id, aba: 'buscar' }); } })));
    }
    resultados.replaceChildren(
      el('p', { class: 'suave pequeno', text: grupos.length ? `${grupos.length} ${grupos.length === 1 ? 'paciente' : 'pacientes'}, ${total} ${total === 1 ? 'lugar' : 'lugares'}` : 'Nada encontrado.' }),
      ...grupos);
  };
  let t = null;
  entrada.addEventListener('input', () => { clearTimeout(t); t = setTimeout(desenhar, 200); });
  mostrar(
    cabecalho('Buscar em tudo', { voltar: true }),
    el('div', { class: 'conteudo' }, el('label', { class: 'campo-busca' }, icone('busca'), entrada), resultados));
  desenhar();
  entrada.focus();
}

// ---------- Senha do backup lembrada ----------
async function lembrarSenhaBackup(senha) {
  senhaBackup = senha;
  await Cofre.salvar('c:senhabackup', { tipoRegistro: 'senhabackup', senha, atualizadoEm: new Date().toISOString() });
}
async function esquecerSenhaBackup() {
  const ok = await dialogo({ titulo: 'Esquecer a senha do backup?', texto: 'Nos próximos backups, o app vai pedir a senha de novo.', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Esquecer', valor: true, estilo: 'primario' }] });
  if (!ok) return;
  await Cofre.apagar('c:senhabackup');
  senhaBackup = null;
  telaConfig();
}

// ---------- Versão 14: lembretes por paciente (só na área clínica, cifrados com a ficha) ----------
// Cada lembrete: { id, texto, desde (aaaa-mm-dd), criadoEm }. Aparece na tela inicial a partir da data "desde".
const lembretesPendentes = p => (p.lembretes || []).filter(l => (l.desde || '') <= hojeISO());
function telefoneDoPaciente(p) {
  const c = typeof cadastroDe === 'function' ? cadastroDe(p.id) : null;
  return c?.telefone || p.dados?.telefone || p.dados?.celular || '';
}
function abrirWhatsPaciente(p) {
  const n = numeroWhats(telefoneDoPaciente(p));
  if (!n) return aviso('Sem celular', 'Cadastre o celular do paciente em Agenda, pagamentos e mensagens → Cadastro.');
  abrirExterno(`https://wa.me/${n}`);
}
function concluirLembrete(p, l) {
  p.lembretes = (p.lembretes || []).filter(x => x.id !== l.id);
  agendarSalvar('p:' + p.id, p);
}
function botaoLembretes(p) {
  const b = botaoIcone('Lembretes e WhatsApp', 'sino', () => janelaLembretes(p));
  const n = lembretesPendentes(p).length;
  if (n) {
    b.style.position = 'relative';
    b.append(el('span', { 'aria-label': `${n} lembrete(s)`, style: 'position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#d32f2f;color:#fff;font-size:11px;line-height:16px;text-align:center', text: String(n) }));
  }
  return b;
}
async function janelaLembretes(p) {
  // Versão 61: um só campo e dois botões — "Só para mim" (fica aqui, cifrado com a ficha) ou "Para o administrativo".
  const podeAdm = typeof novoLembreteAdm === 'function' && !!cadastroDe(p.id);
  const lista = el('div', { class: 'pilha-pequena' });
  const desenhar = () => lista.replaceChildren(...((p.lembretes || []).length ? [el('strong', { text: '🔒 Só para mim' }), ...p.lembretes.slice().sort((a, b) => (a.desde || '').localeCompare(b.desde || '')).map(l => el('div', { class: 'pag-linha' },
    el('span', { class: 'pag-info' }, el('span', { text: l.texto })),
    podeAdm && el('button', { type: 'button', class: 'secundario compacto', text: 'Mandar ao adm.', onclick: () => { fecharDialogos(); novoLembreteAdm(p.id, l.texto, () => concluirLembrete(p, l)); } }),
    el('button', { type: 'button', class: 'secundario compacto', text: 'Feito', onclick: () => { concluirLembrete(p, l); desenhar(); } })))]
    : [el('p', { class: 'suave pequeno', text: 'Nenhum lembrete seu para este paciente.' })]));
  desenhar();
  const texto = el('textarea', { rows: '3', placeholder: 'Escreva o lembrete e escolha abaixo para quem é' });
  const tel = numeroWhats(telefoneDoPaciente(p));
  const lAdm = typeof lembretesAdm !== 'undefined' ? lembretesAdm.filter(l => l.pid === p.id && !l.feito) : [];
  const r = await janela(`Lembretes · ${p.nome}`, [
    lista,
    lAdm.length > 0 && el('div', { class: 'pilha-pequena' }, el('strong', { text: '📋 Para o administrativo' }),
      ...lAdm.map(l => el('div', { class: 'pag-linha' }, el('span', { class: 'pag-info' }, el('span', { text: l.texto }), el('span', { class: 'suave', text: 'Aguardando o assistente' }))))),
    el('label', { class: 'campo' }, el('span', { text: 'Novo lembrete' }), texto),
    el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => abrirWhatsPaciente(p) }, icone('mensagem'),
      el('span', { text: tel ? `Abrir conversa com o paciente no WhatsApp` : 'WhatsApp: celular não cadastrado' }))
  ], [{ rotulo: 'Fechar', valor: null }, podeAdm && { rotulo: '📋 Para o administrativo', valor: 'adm' }, { rotulo: '🔒 Só para mim', valor: 'eu', estilo: 'primario' }].filter(Boolean));
  if (r === 'eu' && texto.value.trim()) {
    (p.lembretes ||= []).push({ id: crypto.randomUUID(), texto: texto.value.trim(), desde: hojeISO(), criadoEm: new Date().toISOString() });
    agendarSalvar('p:' + p.id, p);
  }
  if (r === 'adm') return novoLembreteAdm(p.id, texto.value.trim());
  render(history.state);
}
// Cartão na tela inicial: todos os lembretes do dia, com o nome do paciente.
function cartaoLembretes() {
  const itens = pacientes.filter(p => !p.arquivado).flatMap(p => lembretesPendentes(p).map(l => ({ p, l })))
    .sort((a, b) => (a.l.desde || '').localeCompare(b.l.desde || '') || a.p.nome.localeCompare(b.p.nome, 'pt-BR'));
  if (!itens.length) return null;
  return el('section', { class: 'cartao', style: 'border-left:5px solid #b26a00' },
    el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('sino')), el('span', { text: `Lembretes (${itens.length})` })),
    itens.map(({ p, l }) => el('div', { class: 'pag-linha' },
      el('button', { type: 'button', class: 'pag-info linha-botao', style: 'text-align:left;background:none;border:0;padding:0', onclick: () => ir({ tela: 'ficha', id: p.id, aba: 'retomar' }) },
        el('strong', { text: p.nome }), el('span', { text: l.texto })),
      numeroWhats(telefoneDoPaciente(p)) && botaoIcone(`WhatsApp de ${p.nome}`, 'mensagem', () => abrirWhatsPaciente(p)),
      el('button', { type: 'button', class: 'secundario compacto', text: 'Feito', onclick: () => { concluirLembrete(p, l); render(history.state); } }))));
}

// =====================================================================
// Anamnese por paciente (modelos adulto, adolescente e casal, editáveis) e compilado da evolução.
// Tudo na área clínica, cifrado; o administrativo não tem acesso.
// Formato do modelo: linha começando com "# " é uma seção; as outras linhas são campos.
// =====================================================================
const ANAMNESE_PADRAO = {
  adulto: { nome: 'Adulto', texto: `# Demanda
Queixa principal (nas palavras do paciente)
Como chegou ao atendimento / quem indicou
Expectativas em relação ao tratamento
# Histórico da queixa
Quando começou e em que circunstâncias
O que agrava ou alivia
Tratamentos psicológicos ou psiquiátricos anteriores
# Saúde
Condições de saúde e tratamentos médicos
Medicações em uso
Uso de álcool e outras substâncias
Sono e alimentação
Riscos (ideação suicida, autolesão, violência)
# Relações importantes
Mãe
Pai
Irmãos
Parceiro(a) e relacionamentos
Filhos
Outras pessoas importantes
# História de vida
Gestação, nascimento e primeira infância
Infância
Adolescência
Vida adulta: estudos, trabalho, relacionamentos
Acontecimentos marcantes
# Situação atual
Trabalho e rotina
Situação familiar e moradia
Rede de apoio
Lazer e vida social
# Impressões iniciais
Impressões das primeiras entrevistas` },
  adolescente: { nome: 'Adolescente', texto: `# Demanda
Queixa principal (nas palavras do adolescente)
Queixa dos responsáveis
Quem buscou o atendimento e por quê
Expectativas do adolescente e dos responsáveis
# Família e responsáveis
Responsáveis e com quem mora
Relação com a mãe
Relação com o pai
Irmãos
Separações, perdas ou mudanças na família
# Desenvolvimento
Gestação, nascimento e primeiros anos
Infância
Puberdade e mudanças do corpo
# Escola
Escola, ano e desempenho
Relação com colegas e professores
# Vida social
Amizades e grupos
Relacionamentos afetivos
Internet, redes sociais e jogos
Lazer e interesses
# Saúde
Condições de saúde e medicações
Sono e alimentação
Uso de álcool e outras substâncias
Riscos (ideação suicida, autolesão, violência)
Tratamentos anteriores
# Combinados
Combinados com os responsáveis (sigilo, pagamentos, contato)
# Impressões iniciais
Impressões das primeiras entrevistas` },
  casal: { nome: 'Casal', texto: `# Demanda
Motivo da procura, na visão de cada um
Quem tomou a iniciativa de buscar atendimento
Expectativas de cada um
# História do casal
Como se conheceram
Tempo de relação e marcos (namoro, casamento, moradia)
Crises anteriores e como foram atravessadas
# Vida atual
Rotina e divisão de tarefas
Comunicação e conflitos
Vida afetiva e sexual
Finanças
Filhos e parentalidade
Famílias de origem
# Cada parceiro
Parceiro(a) 1: história pessoal
Parceiro(a) 2: história pessoal
# Saúde
Condições de saúde, medicações e substâncias
Riscos (violência, ideação suicida)
Tratamentos anteriores (individuais ou de casal)
# Impressões iniciais
Impressões das primeiras entrevistas` }
};
let modelosAnamneseCache = null;
async function carregarModelosAnamnese() {
  if (!modelosAnamneseCache) {
    const salvo = await Cofre.ler('c:modelos-anamnese');
    modelosAnamneseCache = JSON.parse(JSON.stringify(ANAMNESE_PADRAO));
    for (const [k, v] of Object.entries(salvo?.modelos || {})) modelosAnamneseCache[k] = v;
  }
  return modelosAnamneseCache;
}
async function salvarModelosAnamnese() {
  const alterados = {};
  for (const [k, v] of Object.entries(modelosAnamneseCache)) if (!ANAMNESE_PADRAO[k] || ANAMNESE_PADRAO[k].texto !== v.texto || ANAMNESE_PADRAO[k].nome !== v.nome) alterados[k] = v;
  await Cofre.salvar('c:modelos-anamnese', { tipoRegistro: 'modelos-anamnese', modelos: alterados, atualizadoEm: agoraISO() });
}
function estruturaModelo(texto) {
  const secoes = []; let atual = null;
  for (const bruta of (texto || '').split(/\r?\n/)) {
    const l = bruta.trim(); if (!l) continue;
    if (l.startsWith('#')) { atual = { titulo: l.replace(/^#+\s*/, ''), campos: [] }; secoes.push(atual); }
    else { if (!atual) { atual = { titulo: 'Geral', campos: [] }; secoes.push(atual); } atual.campos.push(l); }
  }
  return secoes;
}
const chaveCampo = (secao, campo) => `${secao} › ${campo}`;

function abaAnamnese(p) {
  const caixa = el('div', { class: 'pilha' }, el('p', { class: 'suave', text: 'Carregando…' }));
  carregarModelosAnamnese().then(modelos => desenharAnamnese(p, caixa, modelos)).catch(() => caixa.replaceChildren(el('p', { class: 'faixa', text: 'Não foi possível abrir os modelos.' })));
  return caixa;
}
function desenharAnamnese(p, caixa, modelos) {
  const an = p.anamnese ||= { modelo: '', campos: {}, hipotese: '' };
  an.campos ||= {};
  const salvar = () => { an.atualizadoEm = agoraISO(); agendarSalvar('p:' + p.id, p); };
  const sel = el('select', { 'aria-label': 'Modelo de anamnese' }, el('option', { value: '', text: 'Escolha o modelo' }),
    Object.entries(modelos).map(([k, v]) => el('option', { value: k, text: v.nome })));
  sel.value = an.modelo || '';
  sel.addEventListener('change', () => { an.modelo = sel.value; salvar(); desenharAnamnese(p, caixa, modelos); });
  const topo = cartao('Modelo', 'nota', el('label', { class: 'campo' }, el('span', { text: 'Modelo de anamnese' }), sel),
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'secundario com-icone', onclick: () => importarAnamnese(p, caixa, modelos) }, icone('arquivo'), el('span', { text: 'Importar de um Word' })),
      el('button', { type: 'button', class: 'link', text: 'Editar os modelos', onclick: () => ir({ tela: 'modelosAnamnese', modelo: an.modelo || 'adulto' }) })),
    an.atualizadoEm && el('p', { class: 'suave pequeno', text: `Última alteração: ${dataBR(an.atualizadoEm)}.` }));
  const caixaTexto = (rotulo, valor, aoMudar, dica = '') => {
    const ta = el('textarea', { rows: '2', placeholder: dica, 'aria-label': rotulo });
    ta.value = valor || '';
    ta.addEventListener('input', () => { aoMudar(ta.value); crescer(ta); });
    setTimeout(() => crescer(ta));
    return el('label', { class: 'campo largo' }, el('span', { text: rotulo }), ta);
  };
  const blocos = [];
  if (an.modelo && modelos[an.modelo]) {
    const secoes = estruturaModelo(modelos[an.modelo].texto), usados = new Set();
    for (const s of secoes) blocos.push(cartao(s.titulo, 'nota', s.campos.map(c => {
      const k = chaveCampo(s.titulo, c); usados.add(k);
      return caixaTexto(c, an.campos[k], v => { an.campos[k] = v; salvar(); });
    })));
    const soltos = Object.keys(an.campos).filter(k => !usados.has(k) && (an.campos[k] || '').trim());
    if (soltos.length) blocos.push(cartao('Outros campos (de outro modelo ou importados)', 'nota', soltos.map(k => caixaTexto(k, an.campos[k], v => { an.campos[k] = v; salvar(); }))));
  } else blocos.push(el('p', { class: 'suave', text: 'Escolha o modelo (adulto, adolescente ou casal) para começar.' }));
  blocos.push(cartao('Hipótese diagnóstica', 'alvo', caixaTexto('Hipótese diagnóstica', an.hipotese, v => { an.hipotese = v; salvar(); }, 'Opcional')));
  caixa.replaceChildren(topo, ...blocos,
    el('p', { class: 'suave pequeno', text: 'A anamnese fica só na área clínica, cifrada. O administrativo não tem acesso. Os campos podem ficar em branco.' }));
}

// Importar uma anamnese já preenchida (Word): distribui o texto pelos campos cujo título aparece no documento.
async function importarAnamnese(p, caixa, modelos) {
  const an = p.anamnese;
  if (!an.modelo) return aviso('Escolha o modelo', 'Escolha primeiro o modelo de anamnese, para o app saber quais campos procurar.');
  const [f] = await escolherArquivos({ accept: '.docx,.odt,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain' });
  if (!f) return;
  let texto;
  try { texto = await extrairTexto(f); } catch { return aviso('Não foi possível ler', 'Use um arquivo Word (.docx), LibreOffice (.odt) ou texto (.txt).'); }
  const secoes = estruturaModelo(modelos[an.modelo].texto);
  const norma = x => semAcento(String(x).toLowerCase()).replace(/\([^)]*\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const alvos = secoes.flatMap(s => s.campos.map(c => ({ k: chaveCampo(s.titulo, c), n: norma(c.split(':')[0]) }))).filter(a => a.n.length >= 3).sort((a, b) => b.n.length - a.n.length);
  const achados = {}; let atual = 'Outros › Texto importado sem campo', buf = [];
  const fechar = () => { const v = buf.join('\n').replace(/_{3,}/g, '').replace(/-{5,}/g, '').trim(); if (v) achados[atual] = (achados[atual] ? achados[atual] + '\n' : '') + v; buf = []; };
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim(); if (!l) continue;
    const antes = norma(l.split(':')[0]);
    const alvo = alvos.find(a => antes === a.n || (antes.startsWith(a.n) && antes.length - a.n.length < 12));
    if (alvo) { fechar(); atual = alvo.k; const resto = l.includes(':') ? l.slice(l.indexOf(':') + 1).trim() : ''; if (resto) buf.push(resto); }
    else buf.push(l);
  }
  fechar();
  const n = Object.keys(achados).length;
  if (!n) return aviso('Nada encontrado', 'O documento não tinha texto para importar.');
  const ocupados = Object.keys(achados).filter(k => (an.campos[k] || '').trim());
  const ok = await dialogo({ titulo: 'Importar anamnese', texto: `${n} ${n === 1 ? 'trecho encontrado' : 'trechos encontrados'}.` + (ocupados.length ? ` ${ocupados.length} ${ocupados.length === 1 ? 'campo já preenchido vai' : 'campos já preenchidos vão'} receber o texto importado no fim.` : '') + ' O que não corresponder a nenhum campo vai para "Outros". Confira depois de importar.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Importar', valor: true, estilo: 'primario' }] });
  if (!ok) return;
  for (const [k, v] of Object.entries(achados)) an.campos[k] = (an.campos[k] || '').trim() ? an.campos[k].trim() + '\n\n' + v : v;
  an.atualizadoEm = agoraISO(); agendarSalvar('p:' + p.id, p);
  desenharAnamnese(p, caixa, modelos);
}

async function telaModelosAnamnese(k) {
  const modelos = await carregarModelosAnamnese();
  k = modelos[k] ? k : 'adulto';
  const sel = el('select', { 'aria-label': 'Modelo' }, Object.entries(modelos).map(([id, v]) => el('option', { value: id, text: v.nome })));
  sel.value = k;
  sel.addEventListener('change', () => ir({ tela: 'modelosAnamnese', modelo: sel.value }, false));
  const nome = el('input', { type: 'text', value: modelos[k].nome, 'aria-label': 'Nome do modelo' });
  const ta = el('textarea', { rows: '18', 'aria-label': 'Texto do modelo', style: 'font-family:monospace' });
  ta.value = modelos[k].texto;
  setTimeout(() => crescer(ta));
  const guardar = async () => {
    if (!estruturaModelo(ta.value).some(s => s.campos.length)) return aviso('Modelo vazio', 'Escreva ao menos uma seção com um campo.');
    modelos[k] = { nome: nome.value.trim() || modelos[k].nome, texto: ta.value };
    await salvarModelosAnamnese(); indicarStatus('Modelo salvo');
  };
  mostrar(
    cabecalho('Modelos de anamnese', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      cartao('Modelo', 'nota', el('label', { class: 'campo' }, el('span', { text: 'Qual modelo' }), sel),
        el('label', { class: 'campo' }, el('span', { text: 'Nome' }), nome)),
      cartao('Seções e campos', 'texto',
        el('p', { class: 'suave pequeno', text: 'Uma linha começando com "#" é o título de uma seção. Cada linha abaixo dela é um campo. Mudar um campo não apaga o que já foi escrito nas anamneses: o texto antigo aparece em "Outros campos".' }),
        ta,
        el('div', { class: 'botoes-linha' },
          el('button', { type: 'button', class: 'secundario', text: 'Novo modelo', onclick: async () => {
            const n = await dialogo({ titulo: 'Novo modelo', campos: [{ rotulo: 'Nome do modelo' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Criar', valor: true, estilo: 'primario' }] });
            if (!n || !String(n).trim()) return;
            const id = 'm' + Date.now(); modelos[id] = { nome: String(n).trim(), texto: '# Demanda\nQueixa principal' };
            await salvarModelosAnamnese(); ir({ tela: 'modelosAnamnese', modelo: id }, false);
          } }),
          ANAMNESE_PADRAO[k] && el('button', { type: 'button', class: 'link', text: 'Voltar ao modelo original', onclick: async () => {
            modelos[k] = JSON.parse(JSON.stringify(ANAMNESE_PADRAO[k])); await salvarModelosAnamnese(); telaModelosAnamnese(k);
          } })))),
    el('button', { type: 'button', class: 'fab estendido', onclick: guardar }, icone('nota'), el('span', { text: 'Salvar modelo' })));
}

// ---------- Compilado da evolução (registro documental, para o paciente que pedir acesso) ----------
let compiladoRasc = null;
function telaCompilado(pid) {
  const p = pacientes.find(x => x.id === pid);
  if (!p) { history.back(); return; }
  const ss = sessoesDe(pid);
  const r = compiladoRasc && compiladoRasc.pid === pid ? compiladoRasc
    : (compiladoRasc = { pid, de: ss[0]?.data || hojeISO(), ate: hojeISO(), anamnese: false, hipotese: false, retomar: false, cpf: true, manuscritas: true, emissao: hojeISO() });
  const doPeriodo = () => ss.filter(s => s.data >= r.de && s.data <= r.ate);
  const resumo = el('p', { class: 'suave' });
  const atualizar = () => { const n = doPeriodo().length, f = folhasNoPeriodo(p, r).length; resumo.textContent = `${n} ${n === 1 ? 'sessão' : 'sessões'} e ${f} ${f === 1 ? 'folha manuscrita' : 'folhas manuscritas'} no período.`; };
  const data = (rotulo, k) => el('label', { class: 'campo' }, el('span', { text: rotulo }), el('input', { type: 'date', value: r[k], onchange: e => { r[k] = e.target.value; atualizar(); } }));
  const marcar = (rotulo, k) => el('label', { class: 'marcar largo' }, el('input', { type: 'checkbox', checked: !!r[k], onchange: e => { r[k] = e.target.checked; } }), el('span', { text: rotulo }));
  mostrar(
    cabecalho('Compilado da evolução', { voltar: true, sub: p.nome }),
    el('div', { class: 'conteudo pilha' },
      cartao('Período', 'calendario', el('div', { class: 'grade duas' }, data('De', 'de'), data('Até', 'ate')), resumo),
      cartao('O que incluir', 'tag', el('div', { class: 'grade' },
        el('p', { class: 'suave pequeno largo', text: 'Sempre entram a identificação e a evolução de cada sessão (data, situação e registro).' }),
        marcar('Folhas manuscritas do caderno (como imagem)', 'manuscritas'),
        marcar('Anamnese', 'anamnese'),
        marcar('Hipótese diagnóstica', 'hipotese'),
        marcar('Anotações "para retomar"', 'retomar'),
        (p.dados?.cpf || cadastroDe?.(pid)?.cpf) && marcar('CPF do paciente', 'cpf'))),
      el('div', { class: 'grade duas' }, data('Data do documento', 'emissao')),
      el('p', { class: 'suave pequeno', text: 'O documento sai com a logo, o carimbo e as páginas numeradas, e fica guardado em Emitidos. Antes de entregar, confira o conteúdo: as anotações pessoais de trabalho podem ficar de fora.' }),
      el('button', { type: 'button', class: 'link', text: 'Ver a Resolução CFP 01/2009 (registro documental)', onclick: () => ir({ tela: 'normas', id: 'res-01-2009' }) })),
    el('button', { type: 'button', class: 'fab estendido', onclick: () => gerarCompilado(p) }, icone('arquivo'), el('span', { text: 'Gerar PDF' })));
  atualizar();
}
async function textoCompilado(p, r) {
  const c = typeof cadastroDe === 'function' ? cadastroDe(p.id) : null;
  const cpf = r.cpf ? (p.dados?.cpf || c?.cpf || '') : '';
  const ss = sessoesDe(p.id).filter(s => s.data >= r.de && s.data <= r.ate).sort((a, b) => a.data.localeCompare(b.data));
  const nasc = p.dados?.nascimento;
  const partes = ['## Identificação',
    `Paciente: ${p.nome}${nasc ? ` – nascimento ${dataCurta(nasc)}` : ''}${cpf ? ` – CPF ${cpf}` : ''}\n` +
    (p.dados?.inicio ? `Início do acompanhamento: ${dataCurta(p.dados.inicio)}\n` : '') +
    `Período deste registro: ${dataCurta(r.de)} a ${dataCurta(r.ate)} (${ss.length} ${ss.length === 1 ? 'sessão' : 'sessões'})\n` +
    `Profissional: ${perfil.nome || ''}${perfil.crp ? ' – CRP ' + perfil.crp : ''}`];
  if (r.anamnese && p.anamnese?.modelo) {
    const modelos = await carregarModelosAnamnese(), m = modelos[p.anamnese.modelo];
    const linhas = [];
    for (const s of estruturaModelo(m?.texto || '')) {
      const itens = s.campos.map(cp => [cp, (p.anamnese.campos[chaveCampo(s.titulo, cp)] || '').trim()]).filter(([, v]) => v);
      if (itens.length) linhas.push(`## Anamnese – ${s.titulo}`, itens.map(([cp, v]) => `${cp}: ${v}`).join('\n\n'));
    }
    if (linhas.length) partes.push(...linhas);
  }
  if (r.hipotese && (p.anamnese?.hipotese || '').trim()) partes.push('## Hipótese diagnóstica', p.anamnese.hipotese.trim());
  partes.push('## Evolução');
  if (!ss.length) partes.push('Nenhuma sessão registrada no período.');
  for (const s of ss) {
    partes.push(`## ${dataCurta(s.data)} (${DIAS[paraData(s.data).getDay()].toLowerCase()}) – ${STATUS[s.status] || 'Sessão'}`);
    partes.push((s.relato || '').trim() || '(sem registro escrito)');
    if (r.retomar && (s.retomar || '').trim()) partes.push('Para retomar: ' + s.retomar.trim());
  }
  return partes.join('\n\n');
}
async function gerarCompilado(p) {
  const r = compiladoRasc;
  if (perfilIncompleto()) return aviso('Faltam seus dados', 'Preencha ao menos seu nome e CRP em Dados profissionais.');
  if (r.de > r.ate) return aviso('Período inválido', 'A data inicial está depois da final.');
  indicarStatus('Gerando…');
  const texto = await textoCompilado(p, r);
  const anexos = r.manuscritas ? await imagensDasFolhas(p, r) : [];
  const bytes = gerarPdfDocumento({ titulo: 'Registro documental', subtitulo: 'Evolução do acompanhamento psicológico – Confidencial', texto, emissao: r.emissao, anexos });
  const nomeArq = `Registro documental - ${p.nome} - ${r.emissao}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  const d = await guardarDocumento(p, 'emitido', { nome: nomeArq, mime: 'application/pdf', bytes, descricao: `Compilado da evolução (${dataCurta(r.de)} a ${dataCurta(r.ate)})`, data: r.emissao, texto, modelo: 'evolucao', adm: false });
  indicarStatus('');
  compiladoRasc = null;
  const acao = await dialogo({ titulo: 'Compilado pronto', texto: 'Ficou guardado em Emitidos. Confira o conteúdo antes de entregar ao paciente.', botoes: [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Ver / enviar', valor: true, estilo: 'primario' }] });
  history.back();
  if (acao) await compartilharDocumento(d, bytes);
}

// =====================================================================
// Normas do CFP e LGPD. Resumos e links oficiais embutidos; o texto integral é colado pelo
// próprio Rodrigo a partir da fonte oficial e fica guardado neste aparelho, com busca, sem internet.
// =====================================================================
const NORMAS = [
  { id: 'codigo-etica', titulo: 'Código de Ética Profissional do Psicólogo', num: 'Resolução CFP nº 10/2005', principal: true,
    resumo: 'Princípios fundamentais, deveres e proibições, sigilo profissional, honorários, relação com outros profissionais e regras de divulgação dos serviços.',
    link: 'https://site.cfp.org.br/wp-content/uploads/2012/07/codigo-de-etica-psicologia.pdf' },
  { id: 'res-06-2019', titulo: 'Documentos escritos produzidos pela(o) psicóloga(o)', num: 'Resolução CFP nº 06/2019', principal: true,
    resumo: 'Tipos de documento (declaração, atestado, relatório, laudo e parecer), o que cada um pode conter, estrutura, entrega e guarda por no mínimo cinco anos. Na declaração, é vedado registrar sintomas ou estados psicológicos.',
    link: 'https://atosoficiais.com.br/cfp/resolucao-do-exercicio-profissional-n-6-2019-institui-regras-para-a-elaboracao-de-documentos-escritos-produzidos-pela-o-psicologa-o-no-exercicio-profissional-e-revoga-a-resolucao-cfp-n-151996-a-resolucao-cfp-n-07-2003-e-a-resolucao-cfp-n-04-2019' },
  { id: 'res-01-2009', titulo: 'Registro documental obrigatório', num: 'Resolução CFP nº 01/2009 (alterada pela nº 05/2010)', principal: true,
    resumo: 'Obriga o registro documental dos serviços: identificação, avaliação da demanda e objetivos, evolução do trabalho, encaminhamento ou encerramento e cópias dos documentos emitidos. Guarda mínima de cinco anos, em local que garanta o sigilo.',
    link: 'https://site.cfp.org.br/wp-content/uploads/2009/04/resolucao2009_01.pdf',
    extra: ['Alteração (Resolução nº 05/2010)', 'https://atosoficiais.com.br/cfp/resolucao-administrativa-financeira-n-5-2010-altera-a-resolucao-cfp-n-0012009-publicada-no-dia-1-de-abril-de-2009-pag-90-secao-i-do-dou'] },
  { id: 'res-11-2018', titulo: 'Atendimento por meios digitais (online)', num: 'Resolução CFP nº 11/2018',
    resumo: 'Regras para atendimentos por tecnologias da informação e comunicação, incluindo o cadastro no e-Psi. Artigos sobre emergências e violação de direitos tiveram regras próprias durante a pandemia (Resolução nº 04/2020); confira a situação atual no site oficial.',
    link: 'https://atosoficiais.com.br/cfp/resolucao-do-exercicio-profissional-n-11-2018-regulamenta-a-prestacao-de-servicos-psicologicos-realizados-por-meios-de-tecnologias-da-informacao-e-da-comunicacao-e-revoga-a-resolucao-cfp-n-112012' },
  { id: 'res-31-2022', titulo: 'Avaliação psicológica e testes (SATEPSI)', num: 'Resolução CFP nº 31/2022 (substituiu a nº 09/2018)',
    resumo: 'Diretrizes para a avaliação psicológica e para o uso de testes; uso de teste com parecer desfavorável ou não avaliado no SATEPSI é falta ética.',
    link: 'https://atosoficiais.com.br/cfp/resolucao-do-exercicio-profissional-n-31-2022-estabelece-diretrizes-para-a-realizacao-de-avaliacao-psicologica-no-exercicio-profissional-da-psicologa-e-do-psicologo-regulamenta-o-sistema-de-avaliacao-de-testes-psicologicos-satepsi-e-revoga-a-resolucao-cfp-no-09-2018' },
  { id: 'res-03-2007', titulo: 'Consolidação das resoluções (inclui registro de pessoa jurídica)', num: 'Resolução CFP nº 03/2007',
    resumo: 'Reúne normas administrativas do Sistema Conselhos, entre elas o registro e o cadastro de pessoas jurídicas que prestam serviços de psicologia. Confira no site oficial a redação atual.',
    link: 'https://atosoficiais.com.br/cfp' },
  { id: 'lgpd', titulo: 'Lei Geral de Proteção de Dados (LGPD)', num: 'Lei nº 13.709/2018',
    resumo: 'Regras para o tratamento de dados pessoais. Dados de saúde são dados pessoais sensíveis, com proteção reforçada.',
    link: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm' }
];
let normasCache = null;
async function carregarNormas() { if (!normasCache) normasCache = (await Cofre.ler('c:normas'))?.textos || {}; return normasCache; }
async function salvarNormas() { await Cofre.salvar('c:normas', { tipoRegistro: 'normas', textos: normasCache, atualizadoEm: agoraISO() }); }
function trechosCom(texto, termo, max = 30) {
  const t = semAcento(termo).trim(); if (t.length < 2) return [];
  return (texto || '').split(/\n+/).map((par, i) => ({ par: par.trim(), i })).filter(x => x.par && semAcento(x.par).includes(t)).slice(0, max);
}
function destacar(par, termo) {
  const t = semAcento(termo).trim(), base = semAcento(par), partes = [];
  if (!t) return [par];
  let i = 0, j;
  while ((j = base.indexOf(t, i)) !== -1) { partes.push(par.slice(i, j), el('mark', { text: par.slice(j, j + t.length) })); i = j + t.length; }
  partes.push(par.slice(i));
  return partes;
}
async function colarNorma(n) {
  const ta = el('textarea', { rows: '8', placeholder: 'Cole aqui o texto oficial', 'aria-label': 'Texto da norma' });
  const r = await janela(`Guardar o texto: ${n.num}`, [
    el('p', { class: 'suave pequeno', text: '1. Toque em "Abrir fonte oficial". 2. Na página, mantenha o dedo sobre o texto → "Selecionar tudo" → "Copiar". 3. Volte aqui, mantenha o dedo na caixa abaixo → "Colar" → "Guardar".' }),
    el('button', { type: 'button', class: 'secundario com-icone', onclick: () => abrirExterno(n.link) }, icone('seguinte'), el('span', { text: 'Abrir fonte oficial' })),
    ta
  ], [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Guardar', valor: true, estilo: 'primario' }]);
  const texto = ta.value.trim();
  if (!r) return;
  if (texto.length < 200) return aviso('Texto muito curto', 'Parece que o texto não foi colado inteiro. Tente de novo.');
  const cache = await carregarNormas();
  cache[n.id] = { texto, guardadoEm: agoraISO() };
  await salvarNormas(); render(history.state);
}
async function telaNormas(id, q = '') {
  const cache = await carregarNormas();
  if (id) {
    const n = NORMAS.find(x => x.id === id); if (!n) { history.back(); return; }
    const g = cache[n.id];
    const corpo = el('div', { class: 'pilha-pequena' });
    const busca = el('input', { type: 'search', placeholder: 'Buscar neste texto', value: q, 'aria-label': 'Buscar neste texto' });
    const desenhar = () => {
      const termo = busca.value.trim();
      if (!g) { corpo.replaceChildren(el('p', { class: 'suave', text: 'O texto integral ainda não foi guardado neste aparelho.' })); return; }
      const pars = g.texto.split(/\n+/).map(x => x.trim()).filter(Boolean);
      const achados = termo.length >= 2 ? pars.filter(p => semAcento(p).includes(semAcento(termo))) : pars;
      corpo.replaceChildren(...[
        termo.length >= 2 && el('p', { class: 'suave pequeno', text: `${achados.length} ${achados.length === 1 ? 'trecho encontrado' : 'trechos encontrados'}.` }),
        ...achados.map(p => el('p', { style: /^(art\.|cap[ií]tulo|se[çc][ãa]o|par[áa]grafo)/i.test(p) ? 'font-weight:600' : null }, ...destacar(p, termo.length >= 2 ? termo : '')))].filter(Boolean));
    };
    busca.addEventListener('input', desenhar);
    mostrar(
      cabecalho(n.num, { voltar: true, sub: n.titulo }),
      el('div', { class: 'conteudo pilha' },
        cartao('Resumo', 'texto', el('p', { text: n.resumo }),
          el('div', { class: 'botoes-linha' },
            el('button', { type: 'button', class: 'secundario compacto', text: 'Fonte oficial', onclick: () => abrirExterno(n.link) }),
            n.extra && el('button', { type: 'button', class: 'secundario compacto', text: n.extra[0], onclick: () => abrirExterno(n.extra[1]) }),
            el('button', { type: 'button', class: g ? 'link' : 'primario compacto', text: g ? 'Substituir o texto' : 'Guardar o texto integral', onclick: () => colarNorma(n) }),
            g && el('button', { type: 'button', class: 'link perigo-texto', text: 'Apagar o texto', onclick: async () => { delete cache[n.id]; await salvarNormas(); render(history.state); } })),
          g && el('p', { class: 'suave pequeno', text: `Texto guardado em ${dataBR(g.guardadoEm)}. Se o CFP alterar a norma, guarde a versão nova.` })),
        g && busca,
        corpo));
    desenhar();
    return;
  }
  const busca = el('input', { type: 'search', placeholder: 'Buscar em todas as normas guardadas (ex.: sigilo, prontuário)', value: q, 'aria-label': 'Buscar nas normas' });
  const resultados = el('div', { class: 'pilha-pequena' });
  const desenharBusca = () => {
    const termo = busca.value.trim();
    if (termo.length < 2) { resultados.replaceChildren(); return; }
    const itens = NORMAS.flatMap(n => trechosCom(cache[n.id]?.texto, termo, 8).map(x => ({ n, par: x.par })));
    resultados.replaceChildren(...(itens.length ? itens.map(({ n, par }) => el('button', { type: 'button', class: 'cartao linha-botao', style: 'text-align:left', onclick: () => ir({ tela: 'normas', id: n.id, q: termo }) },
      el('strong', { text: n.num }), el('p', { class: 'pequeno' }, ...destacar(par.length > 280 ? par.slice(0, 280) + '…' : par, termo))))
      : [el('p', { class: 'suave', text: 'Nada encontrado nos textos guardados.' })]));
  };
  busca.addEventListener('input', desenharBusca);
  const guardadas = NORMAS.filter(n => cache[n.id]).length;
  mostrar(
    cabecalho('Normas do CFP e LGPD', { voltar: true, sub: `${guardadas} de ${NORMAS.length} com texto integral guardado` }),
    el('div', { class: 'conteudo pilha' },
      busca, resultados,
      ...NORMAS.map(n => el('button', { type: 'button', class: 'cartao linha-botao', style: 'text-align:left', onclick: () => ir({ tela: 'normas', id: n.id }) },
        el('strong', { text: `${n.titulo}` }),
        el('span', { class: 'suave pequeno', text: `${n.num}${n.principal ? ' · principal' : ''} · ${cache[n.id] ? 'texto guardado ✓' : 'só resumo e link'}` }))),
      el('p', { class: 'suave pequeno', text: 'Os resumos são orientações gerais, não substituem a leitura do texto oficial. Os textos integrais ficam guardados só neste aparelho.' })));
  desenharBusca();
}

// =====================================================================
// Caderno de anotações e evolução: folhas manuscritas por paciente, escritas com a S Pen.
// O índice das folhas fica na ficha (p.folhas); os traços ficam em 'c:folha:<id>', cifrados.
// Só a caneta escreve; o dedo rola a página; a mão apoiada é ignorada.
// =====================================================================
const LARG_FOLHA = 900, ALT_FOLHA = Math.round(900 * 1.414);
const CORES_CANETA = [['#222222', 'Preto'], ['#1f4fbf', 'Azul'], ['#c62828', 'Vermelho'], ['#2e7d32', 'Verde']];
const ESPESSURAS = [[1.4, 'Fina'], [2.2, 'Média'], [3.4, 'Grossa']];
let preferenciasCaneta = { cor: '#222222', esp: 2.2, papel: 'liso', dedo: false };
try { Object.assign(preferenciasCaneta, JSON.parse(localStorage.getItem('consultorio-caneta') || '{}')); } catch { }
const guardarPreferenciasCaneta = () => { try { localStorage.setItem('consultorio-caneta', JSON.stringify(preferenciasCaneta)); } catch { } };
const chaveFolha = id => 'c:folha:' + id;
// Versão 24: página importada (PDF ou imagem) guardada como fundo da folha, cifrada, em 'a:fundo:<folha>:<página>'.
const chaveFundo = (fid, i) => `a:fundo:${fid}:${i}`;
const alturaPagina = (reg, i) => reg.alturas?.[i] || ALT_FOLHA;
async function imagemDoFundo(fid, i) {
  const r = await Cofre.ler(chaveFundo(fid, i));
  if (!r?.b64) return null;
  return createImageBitmap(new Blob([deBase64(r.b64)], { type: 'image/jpeg' }));
}
// Converte cada página do PDF (ou a imagem) em JPEG com 1400 px de largura.
async function paginasDoArquivo(f, aoProgredir) {
  const LARG = 1400, res = [];
  const paraJpeg = async (desenhar, w, h) => {
    const esc = LARG / w, W = LARG, H = Math.min(Math.round(h * esc), LARG * 12);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    await desenhar(ctx, esc);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: H };
  };
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
    const pdfjs = await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', location.href).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
    const n = Math.min(doc.numPages, 60);
    for (let i = 1; i <= n; i++) {
      aoProgredir?.(i, n);
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 });
      res.push(await paraJpeg((ctx, esc) => pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: esc }) }).promise, vp.width, vp.height));
    }
    await doc.destroy();
  } else {
    const bmp = await createImageBitmap(f);
    res.push(await paraJpeg((ctx, esc) => ctx.drawImage(bmp, 0, 0, bmp.width * esc, bmp.height * esc), bmp.width, bmp.height));
  }
  return res;
}
async function importarParaCaderno(p, op = {}) {
  const arquivos = await escolherArquivos({ multiplo: true, accept: 'application/pdf,.pdf,image/*' });
  if (!arquivos?.length) return;
  const nomeBase = arquivos[0].name.replace(/\.[^.]+$/, '');
  const r = await dialogo({ titulo: 'Trazer para a sessão', texto: 'Cada página vira uma folha, e você pode continuar escrevendo em cima com a caneta. A folha fica dentro da sessão do mesmo dia. Data do atendimento e título:',
    campos: [{ rotulo: 'Data', tipo: 'date', valor: op.data || hojeISO() }, { rotulo: 'Título', valor: nomeBase }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Trazer', valor: true, estilo: 'primario' }] });
  if (!r) return;
  const [data, titulo] = r;
  let paginas = [];
  try {
    for (const [k, f] of arquivos.entries())
      paginas.push(...await paginasDoArquivo(f, (i, n) => indicarStatus(`Lendo ${arquivos.length > 1 ? `arquivo ${k + 1}, ` : ''}página ${i} de ${n}…`)));
  } catch (e) {
    console.warn('importar', e); indicarStatus('');
    return aviso('Não foi possível ler o arquivo', e?.name === 'PasswordException' ? 'O PDF tem senha. Salve de novo sem senha e tente outra vez.' : 'Confira se é um PDF ou uma imagem e tente de novo.');
  }
  indicarStatus('');
  if (!paginas.length) return aviso('Nada encontrado', 'O arquivo não tem páginas.');
  const f = { id: crypto.randomUUID(), data: data || hojeISO(), titulo: (titulo || '').trim(), paginas: paginas.length, importada: true, criadoEm: agoraISO(), atualizadoEm: agoraISO() };
  if (op.sid && (data || hojeISO()) === op.data) f.sid = op.sid;
  for (const [i, pg] of paginas.entries())
    await Cofre.salvar(chaveFundo(f.id, i), { tipoRegistro: 'fundo', b64: paraBase64(pg.bytes), w: pg.w, h: pg.h, atualizadoEm: f.atualizadoEm });
  await Cofre.salvar(chaveFolha(f.id), { tipoRegistro: 'folha', id: f.id, pid: p.id, paginas: paginas.map(() => []),
    fundos: paginas.map(() => true), alturas: paginas.map(pg => Math.round(LARG_FOLHA * pg.h / pg.w)), atualizadoEm: f.atualizadoEm });
  (p.folhas ||= []).push(f);
  agendarSalvar('p:' + p.id, p);
  await salvarAgora();
  indicarStatus('Salvo');
  ir({ tela: 'caderno', pid: p.id, fid: f.id });
}
const folhasDe = p => (p.folhas || []).slice().sort((a, b) => b.data.localeCompare(a.data) || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
const folhasNoPeriodo = (p, r) => (p.folhas || []).filter(f => f.data >= r.de && f.data <= r.ate).sort((a, b) => a.data.localeCompare(b.data) || (a.criadoEm || '').localeCompare(b.criadoEm || ''));

function abaCaderno(p) {
  const lista = folhasDe(p);
  return el('div', { class: 'pilha' },
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => novaFolha(p) }, icone('nota'), el('span', { text: 'Nova folha' })),
      el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => importarParaCaderno(p) }, icone('clipe'), el('span', { text: 'Trazer PDF ou imagem' }))),
    lista.length ? lista.map(f => el('button', { type: 'button', class: 'cartao linha-botao', style: 'text-align:left;display:flex;align-items:center;gap:.8rem', onclick: () => ir({ tela: 'caderno', pid: p.id, fid: f.id }) },
      el('span', { class: 'ic-bolha' }, icone('nota')),
      el('span', { style: 'display:flex;flex-direction:column;gap:2px' },
        el('strong', { text: `${dataCurta(f.data)}${f.titulo ? ' · ' + f.titulo : ''}` }),
        el('span', { class: 'suave pequeno', text: `${f.paginas || 1} ${(f.paginas || 1) === 1 ? 'página' : 'páginas'}${f.atualizadoEm ? ' · alterada em ' + dataBR(f.atualizadoEm) : ''}` }))))
      : el('div', { class: 'cartao vazio-cartao' },
        el('span', { class: 'ic-bolha grande' }, icone('nota')),
        el('p', { text: 'Nenhuma folha ainda. Toque em "Nova folha" para escrever com a caneta, como no Samsung Notes, ou em "Trazer PDF ou imagem" para guardar aqui anotações que já existem (por exemplo, o PDF de uma nota do Samsung Notes).' })),
    el('p', { class: 'suave pequeno', text: 'As folhas ficam só na área clínica, cifradas. O administrativo não tem acesso. Elas entram no backup e podem entrar no compilado da evolução.' }));
}
async function novaFolha(p, op = {}) {
  let data = op.data, titulo = '';
  if (!op.sid) {
    const r = await dialogo({ titulo: 'Nova folha', texto: 'Data do atendimento e, se quiser, um título.',
      campos: [{ rotulo: 'Data', tipo: 'date', valor: hojeISO() }, { rotulo: 'Título (opcional)' }],
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Criar', valor: true, estilo: 'primario' }] });
    if (!r) return;
    [data, titulo] = r;
  }
  const f = { id: crypto.randomUUID(), data: data || hojeISO(), titulo: (titulo || '').trim(), paginas: 1, criadoEm: agoraISO(), atualizadoEm: agoraISO() };
  if (op.sid) f.sid = op.sid;
  (p.folhas ||= []).push(f);
  agendarSalvar('p:' + p.id, p);
  await Cofre.salvar(chaveFolha(f.id), { tipoRegistro: 'folha', id: f.id, pid: p.id, paginas: [[]], atualizadoEm: f.atualizadoEm });
  ir({ tela: 'caderno', pid: p.id, fid: f.id });
}

// Desenho de um traço. Pontos guardados em unidades da folha (900 de largura): [x, y, pressão×100, ...].
function desenharTracoFolha(ctx, t, esc) {
  const pts = t.p, n = pts.length / 3;
  ctx.globalCompositeOperation = t.b ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = t.b ? '#000' : t.c;
  const larg = pr => (t.b ? 28 : t.e * (0.45 + pr / 100)) * esc;
  if (n === 1) { ctx.beginPath(); ctx.arc(pts[0] * esc, pts[1] * esc, larg(pts[2]) / 2, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 1; i < n; i++) {
    ctx.lineWidth = larg((pts[i * 3 - 1] + pts[i * 3 + 2]) / 2);
    ctx.beginPath(); ctx.moveTo(pts[i * 3 - 3] * esc, pts[i * 3 - 2] * esc); ctx.lineTo(pts[i * 3] * esc, pts[i * 3 + 1] * esc); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}
// Versão 22: o papel é desenhado num canvas próprio, por baixo da tinta. Assim o modo escuro do navegador
// não escurece só a folha (deixando a tinta invisível), e a borracha continua sem apagar as linhas.
function desenharPapel(cv, papel, img) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, r = W / LARG_FOLHA;
  ctx.fillStyle = img ? '#ffffff' : '#fffdf8'; ctx.fillRect(0, 0, W, H);
  if (img) { ctx.drawImage(img, 0, 0, W, W * img.height / img.width); return; }
  if (papel !== 'linhas') return;
  const passo = 52 * r;
  ctx.fillStyle = '#e3ddd1';
  for (let y = 80 * r; y < H - 10 * r; y += passo) ctx.fillRect(0, Math.round(y), W, Math.max(1, Math.round(r * 1.2)));
}

async function telaCaderno(pid, fid) {
  const p = pacientes.find(x => x.id === pid), meta = p && (p.folhas || []).find(f => f.id === fid);
  if (!meta) { history.back(); return; }
  const reg = (await Cofre.ler(chaveFolha(fid))) || { tipoRegistro: 'folha', id: fid, pid, paginas: [[]] };
  if (!reg.paginas?.length) reg.paginas = [[]];
  const est = preferenciasCaneta;
  const historico = [], refazer = [];
  let salvarTimer = null, alterado = false;
  const salvar = async () => {
    clearTimeout(salvarTimer); salvarTimer = null;
    if (!alterado) return;
    alterado = false;
    reg.atualizadoEm = meta.atualizadoEm = agoraISO(); meta.paginas = reg.paginas.length;
    await Cofre.salvar(chaveFolha(fid), reg);
    agendarSalvar('p:' + p.id, p);
    indicarStatus('Salvo');
  };
  const mudou = () => { alterado = true; clearTimeout(salvarTimer); salvarTimer = setTimeout(salvar, 1200); };
  const folhasDom = [];
  const zona = el('div', { style: 'padding:14px 0 90px' });
  const larguraTela = () => Math.min(900, (zona.clientWidth || document.documentElement.clientWidth) - 16);
  const redesenhar = i => {
    const { c, ctx } = folhasDom[i], esc = c.width / LARG_FOLHA;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const t of reg.paginas[i]) desenharTracoFolha(ctx, t, esc);
  };
  const dimensionar = i => {
    const f = folhasDom[i], larg = larguraTela(), alt = larg * alturaPagina(reg, i) / LARG_FOLHA;
    // limite de pixels por canvas, para páginas muito compridas não travarem o tablet
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(14e6 / (larg * alt)));
    f.div.style.width = larg + 'px';
    for (const cv of [f.papel, f.c]) {
      cv.style.width = larg + 'px'; cv.style.height = alt + 'px';
      cv.width = Math.round(larg * dpr); cv.height = Math.round(alt * dpr);
    }
    desenharPapel(f.papel, est.papel, f.img);
    redesenhar(i);
  };
  const montarPagina = i => {
    const papel = el('canvas', { 'aria-hidden': 'true', style: 'display:block;border-radius:6px;pointer-events:none' });
    const c = el('canvas', { 'aria-label': `Página ${i + 1}`, style: 'position:absolute;left:0;top:0;display:block;touch-action:none;border-radius:6px' });
    const div = el('div', { style: 'position:relative;margin:0 auto 16px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.14);color-scheme:light;forced-color-adjust:none' }, papel, c,
      el('span', { style: 'position:absolute;right:12px;bottom:8px;font-size:11px;color:#a39b91;pointer-events:none', text: `Página ${i + 1}` }));
    const f = { c, papel, ctx: c.getContext('2d'), div, img: null };
    folhasDom[i] = f;
    if (reg.fundos?.[i]) imagemDoFundo(fid, i).then(img => { if (!img) return; f.img = img; desenharPapel(f.papel, est.papel, img); }).catch(() => { });
    ligar(i);
    return div;
  };
  const ligar = i => {
    const { c } = folhasDom[i];
    let atual = null, id = null, rolando = null;
    const ponto = e => {
      const r = c.getBoundingClientRect(), esc = LARG_FOLHA / r.width;
      const pr = e.pointerType === 'pen' && e.pressure ? e.pressure : 0.5;
      return [Math.round((e.clientX - r.left) * esc * 10) / 10, Math.round((e.clientY - r.top) * esc * 10) / 10, Math.round(pr * 100)];
    };
    const aceita = e => e.pointerType === 'pen' || e.pointerType === 'mouse' || (est.dedo && e.pointerType === 'touch');
    c.addEventListener('pointerdown', e => {
      if (!aceita(e)) {
        if (e.pointerType === 'touch' && !atual) { rolando = { id: e.pointerId, y: e.clientY, x0: e.clientX, y0: e.clientY }; c.setPointerCapture(e.pointerId); }
        return;
      }
      e.preventDefault(); c.setPointerCapture(e.pointerId); id = e.pointerId;
      if (e.pointerType === 'pen' && !canetaVista) { canetaVista = true; try { localStorage.setItem('consultorio-caneta-vista', '1'); } catch { } dicaCaneta.remove(); }
      const borracha = est.ferramenta === 'borracha' || e.button === 5 || (e.buttons & 32);
      atual = { c: est.cor, e: est.esp, b: borracha ? 1 : 0, p: ponto(e) };
      desenharTracoFolha(folhasDom[i].ctx, atual, c.width / LARG_FOLHA);
    });
    c.addEventListener('pointermove', e => {
      if (rolando && e.pointerId === rolando.id) { window.scrollBy(0, rolando.y - e.clientY); rolando.y = e.clientY; return; }
      if (!atual || e.pointerId !== id) return;
      e.preventDefault();
      const esc = c.width / LARG_FOLHA;
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
        const pt = ponto(ev), n = atual.p.length;
        const seg = { ...atual, p: [atual.p[n - 3], atual.p[n - 2], atual.p[n - 1], ...pt] };
        atual.p.push(...pt);
        desenharTracoFolha(folhasDom[i].ctx, seg, esc);
      }
    });
    const fim = e => {
      if (rolando && e.pointerId === rolando.id) {
        // Um risco feito "como dedo" que não chega a rolar a página: provavelmente a caneta não foi reconhecida.
        if (!canetaVista && !est.dedo && Math.hypot(e.clientX - rolando.x0, e.clientY - rolando.y0) > 12) dicaCaneta.classList.add('destaque-dica');
        rolando = null; return;
      }
      if (!atual || e.pointerId !== id) return;
      reg.paginas[i].push(atual); historico.push({ i, t: atual }); refazer.length = 0;
      atual = null; id = null; mudou();
    };
    c.addEventListener('pointerup', fim); c.addEventListener('pointercancel', fim);
  };
  const botaoBarra = (rotulo, ativo, aoTocar, extra = {}) => el('button', { type: 'button', 'aria-pressed': String(!!ativo), class: 'secundario compacto', style: (ativo ? 'box-shadow:inset 0 0 0 2px currentColor;' : '') + (extra.style || ''), 'aria-label': extra.aria || rotulo, onclick: aoTocar }, extra.filho || rotulo);
  const barra = el('div', { role: 'toolbar', 'aria-label': 'Ferramentas da caneta', style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:6px 10px 8px;background:var(--fundo);border-bottom:1px solid rgba(128,128,128,.25)' });
  const desenharBarra = () => barra.replaceChildren(
    botaoBarra('✒️ Caneta', est.ferramenta !== 'borracha', () => { est.ferramenta = 'caneta'; desenharBarra(); }),
    botaoBarra('🧽 Borracha', est.ferramenta === 'borracha', () => { est.ferramenta = 'borracha'; desenharBarra(); }),
    ...CORES_CANETA.map(([cor, nome]) => botaoBarra(nome, est.cor === cor && est.ferramenta !== 'borracha', () => { est.cor = cor; est.ferramenta = 'caneta'; guardarPreferenciasCaneta(); desenharBarra(); },
      { aria: nome, filho: el('span', { style: `display:block;width:18px;height:18px;border-radius:50%;background:${cor};box-shadow:0 0 0 1.5px rgba(255,255,255,.75)` }) })),
    ...ESPESSURAS.map(([v, nome]) => botaoBarra(nome, est.esp === v, () => { est.esp = v; guardarPreferenciasCaneta(); desenharBarra(); })),
    botaoBarra('↶', false, () => { const h = historico.pop(); if (!h) return; reg.paginas[h.i].splice(reg.paginas[h.i].lastIndexOf(h.t), 1); refazer.push(h); redesenhar(h.i); mudou(); }, { aria: 'Desfazer' }),
    botaoBarra('↷', false, () => { const h = refazer.pop(); if (!h) return; reg.paginas[h.i].push(h.t); historico.push(h); redesenhar(h.i); mudou(); }, { aria: 'Refazer' }),
    botaoBarra(est.papel === 'linhas' ? 'Linhas largas' : 'Folha lisa', false, () => { est.papel = est.papel === 'linhas' ? 'liso' : 'linhas'; guardarPreferenciasCaneta(); desenharBarra(); folhasDom.forEach(f => desenharPapel(f.papel, est.papel, f.img)); }),
    botaoBarra('☝️ Dedo escreve', est.dedo, () => { est.dedo = !est.dedo; guardarPreferenciasCaneta(); desenharBarra(); if (est.dedo) dicaCaneta?.remove(); }));
  est.ferramenta = 'caneta';
  desenharBarra();
  let canetaVista = false;
  try { canetaVista = localStorage.getItem('consultorio-caneta-vista') === '1'; } catch { }
  const dicaCaneta = el('p', { class: 'suave pequeno', style: 'margin:0;padding:4px 12px 6px;background:var(--fundo)',
    text: 'A caneta não escreve? Toque em "☝️ Dedo escreve". Com ele ligado, o dedo também escreve; para rolar a folha, desligue de novo.' });
  if (canetaVista || est.dedo) dicaCaneta.remove();
  const editarDados = async () => {
    const r = await dialogo({ titulo: 'Dados da folha', campos: [{ rotulo: 'Data', tipo: 'date', valor: meta.data }, { rotulo: 'Título (opcional)', valor: meta.titulo || '' }],
      botoes: [{ rotulo: 'Excluir folha', valor: 'excluir', estilo: 'perigo' }, { rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }] });
    if (r === 'excluir') {
      const ok = await dialogo({ titulo: 'Excluir esta folha?', texto: 'A folha e tudo o que foi escrito nela serão apagados deste aparelho.', botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }] });
      if (!ok) return;
      clearTimeout(salvarTimer); alterado = false;
      p.folhas = p.folhas.filter(f => f.id !== fid); agendarSalvar('p:' + p.id, p);
      for (let k = 0; k < (reg.fundos || []).length; k++) if (reg.fundos[k]) await Cofre.apagar(chaveFundo(fid, k));
      await Cofre.apagar(chaveFolha(fid)); history.back(); return;
    }
    if (!r) return;
    meta.data = r[0] || meta.data; meta.titulo = (r[1] || '').trim(); meta.atualizadoEm = agoraISO();
    agendarSalvar('p:' + p.id, p); document.getElementById('titulo-tela').textContent = tituloFolha();
  };
  const tituloFolha = () => `${dataCurta(meta.data)}${meta.titulo ? ' · ' + meta.titulo : ''}`;
  const botaoNova = el('button', { type: 'button', class: 'secundario com-icone centralizado', style: 'display:flex;margin:0 auto', onclick: () => {
    reg.paginas.push([]); const i = reg.paginas.length - 1;
    zona.insertBefore(montarPagina(i), botaoNova); dimensionar(i); mudou();
    folhasDom[i].div.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } }, icone('mais'), el('span', { text: 'Nova página' }));
  reg.paginas.forEach((_, i) => zona.append(montarPagina(i)));
  zona.append(botaoNova);
  mostrar(
    el('div', { style: 'position:sticky;top:0;z-index:6' },
      cabecalho(tituloFolha(), { voltar: true, sub: p.nome, status: true, acoes: [botaoIcone('Data, título ou excluir', 'opcoes', editarDados)] }),
      barra, dicaCaneta),
    zona);
  reg.paginas.forEach((_, i) => dimensionar(i));
  const aoRedimensionar = () => { if (!document.body.contains(zona)) { window.removeEventListener('resize', aoRedimensionar); return; } folhasDom.forEach((_, i) => dimensionar(i)); };
  window.addEventListener('resize', aoRedimensionar);
  // salva ao sair da tela ou ao bloquear
  const aoSair = () => { if (alterado) salvar(); };
  window.addEventListener('pagehide', aoSair, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) aoSair(); });
  telaCadernoSair = aoSair;
}
let telaCadernoSair = null;

// Imagens das folhas para o compilado (JPEG, fundo branco).
async function imagensDasFolhas(p, r) {
  const res = [];
  for (const f of folhasNoPeriodo(p, r)) {
    const reg = await Cofre.ler(chaveFolha(f.id));
    if (!reg?.paginas) continue;
    for (let i = 0; i < reg.paginas.length; i++) {
      const fundo = reg.fundos?.[i] ? await imagemDoFundo(f.id, i).catch(() => null) : null;
      if (!reg.paginas[i].length && !fundo) continue;
      const W = 1000, H = Math.round(W * alturaPagina(reg, i) / LARG_FOLHA);
      const tinta = document.createElement('canvas'); tinta.width = W; tinta.height = H;
      const tc = tinta.getContext('2d');
      for (const t of reg.paginas[i]) desenharTracoFolha(tc, t, W / LARG_FOLHA);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      if (fundo) ctx.drawImage(fundo, 0, 0, W, W * fundo.height / fundo.width);
      ctx.drawImage(tinta, 0, 0);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
      res.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: H,
        legenda: `Folha manuscrita – ${dataCurta(f.data)}${f.titulo ? ' – ' + f.titulo : ''}${reg.paginas.length > 1 ? ` (página ${i + 1} de ${reg.paginas.length})` : ''}` });
    }
  }
  return res;
}

// =====================================================================
// Pasta do paciente no Google Drive. O app guarda só o endereço da pasta (na ficha cifrada).
// Os arquivos são listados direto do Drive, com a conta Google do próprio Rodrigo, e só
// entram no app (cifrados) quando ele toca em "Trazer para o app". Nada passa por terceiros.
// =====================================================================
const TIPO_PASTA = 'application/vnd.google-apps.folder';
const EXPORTAR_GOOGLE = { 'application/vnd.google-apps.document': ['application/pdf', '.pdf'], 'application/vnd.google-apps.spreadsheet': ['application/pdf', '.pdf'], 'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'] };
const linkDaPasta = id => `https://drive.google.com/drive/folders/${id}`;
async function tokenLeitura() {
  if (!driveCfg().clientId) { await aviso('Falta a chave do Google', 'Em Configurações → Google Drive, cole a chave de conexão (ID do cliente).'); return null; }
  try { await carregarGoogle(); return await pedirTokenGoogle(); }
  catch (e) { await aviso('Sem acesso ao Google', e.message === 'sem-internet' ? 'Verifique a internet e tente de novo.' : 'O acesso ao Drive não foi concedido. Toque de novo e entre na sua conta.'); return null; }
}
function cartaoPastaDrive(p) {
  if (driveCfg().clientId) carregarGoogle().catch(() => { });
  const pasta = p.drivePasta;
  return cartao('Pasta no Google Drive', 'arquivo',
    pasta ? el('p', { class: 'suave pequeno', text: `Ligada à pasta "${pasta.nome || 'do paciente'}".` })
      : el('p', { class: 'suave pequeno', text: 'Ligue este paciente à pasta dele no seu Drive para ver e trazer declarações e outros arquivos que já estão lá.' }),
    el('div', { class: 'botoes-linha' },
      pasta && el('button', { type: 'button', class: 'primario com-icone', onclick: async () => { if (await tokenLeitura()) ir({ tela: 'drivePaciente', pid: p.id, pasta: pasta.id, nome: pasta.nome }); } }, icone('arquivo'), el('span', { text: 'Ver arquivos' })),
      pasta && el('button', { type: 'button', class: 'secundario compacto', text: 'Abrir no Drive', onclick: () => abrirExterno(linkDaPasta(pasta.id)) }),
      el('button', { type: 'button', class: pasta ? 'link' : 'primario compacto', text: pasta ? 'Trocar pasta' : 'Encontrar a pasta', onclick: () => encontrarPastaPaciente(p) }),
      !pasta && el('button', { type: 'button', class: 'secundario compacto', text: 'Colar link', onclick: () => colarLinkPasta(p) }),
      pasta && el('button', { type: 'button', class: 'link perigo-texto', text: 'Desligar', onclick: () => { delete p.drivePasta; agendarSalvar('p:' + p.id, p); render(history.state); } })));
}
async function encontrarPastaPaciente(p) {
  const token = await tokenLeitura(); if (!token) return;
  const palavras = semAcento(p.nome).split(/\s+/).filter(w => w.length > 2);
  const termo = (p.nome.split(/\s+/)[0] || '').replace(/'/g, "\\'");
  let achadas = [];
  try {
    const q = encodeURIComponent(`mimeType = '${TIPO_PASTA}' and name contains '${termo}' and trashed = false`);
    const r = await (await driveApi(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`, token)).json();
    achadas = (r.files || []).map(f => ({ ...f, pontos: palavras.filter(w => semAcento(f.name).includes(w)).length })).sort((a, b) => b.pontos - a.pontos || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 12);
  } catch { return aviso('Não foi possível buscar', 'Verifique a internet e tente de novo.'); }
  if (!achadas.length) {
    const ok = await dialogo({ titulo: 'Nenhuma pasta encontrada', texto: `Não achei pastas com "${termo}" no nome. Você pode colar o link da pasta.`, botoes: [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Colar link', valor: true, estilo: 'primario' }] });
    if (ok) colarLinkPasta(p);
    return;
  }
  const r = await janela(`Pasta de ${p.nome}`, [el('p', { class: 'suave pequeno', text: 'Toque na pasta deste paciente.' })],
    [...achadas.map((f, i) => ({ rotulo: f.name, valor: String(i) })), { rotulo: 'Colar link', valor: 'colar' }, { rotulo: 'Cancelar', valor: null }]);
  if (r === 'colar') return colarLinkPasta(p);
  if (r === null || r === undefined || !achadas[Number(r)]) return;
  const f = achadas[Number(r)];
  p.drivePasta = { id: f.id, nome: f.name, ligadaEm: agoraISO() };
  agendarSalvar('p:' + p.id, p); render(history.state);
}
async function colarLinkPasta(p) {
  const r = await dialogo({ titulo: 'Link da pasta no Drive', texto: 'No Drive: na pasta do paciente, toque nos três pontinhos → Compartilhar → Copiar link. Cole aqui. (A pasta continua privada; o link só serve para o app saber qual é.)',
    campos: [{ rotulo: 'https://drive.google.com/drive/folders/…' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }] });
  if (!r) return;
  const id = idDaPasta(String(r).trim());
  if (!id) return aviso('Link não reconhecido', 'Copie o link da pasta pelo botão Compartilhar do Drive.');
  p.drivePasta = { id, nome: '', ligadaEm: agoraISO() };
  agendarSalvar('p:' + p.id, p); render(history.state);
}
async function telaDrivePaciente(pid, pastaId, nomePasta) {
  const p = pacientes.find(x => x.id === pid);
  if (!p) { history.back(); return; }
  const lista = el('div', { class: 'pilha-pequena' }, el('p', { class: 'suave', text: 'Carregando os arquivos do Drive…' }));
  mostrar(
    cabecalho(nomePasta || p.drivePasta?.nome || 'Pasta no Drive', { voltar: true, sub: p.nome, status: true, acoes: [botaoIcone('Abrir no Drive', 'seguinte', () => abrirExterno(linkDaPasta(pastaId)))] }),
    el('div', { class: 'conteudo pilha' }, lista,
      el('p', { class: 'suave pequeno', text: '"Trazer para o app" guarda uma cópia cifrada no paciente (em Recebidos ou Emitidos). O arquivo continua também no Drive.' })));
  let token = tokenGoogle && tokenGoogle.expira > Date.now() + 60000 ? tokenGoogle.valor : null;
  if (!token) { lista.replaceChildren(el('p', { class: 'faixa', text: 'A conexão com o Google expirou.' }), el('button', { type: 'button', class: 'primario', text: 'Conectar de novo', onclick: async () => { if (await tokenLeitura()) telaDrivePaciente(pid, pastaId, nomePasta); } })); return; }
  let arquivos = [];
  try {
    const q = encodeURIComponent(`'${pastaId}' in parents and trashed = false`);
    const r = await (await driveApi(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&orderBy=folder,modifiedTime desc&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`, token)).json();
    arquivos = r.files || [];
    if (!nomePasta && p.drivePasta?.id === pastaId && !p.drivePasta.nome) {
      const meta = await (await driveApi(`https://www.googleapis.com/drive/v3/files/${pastaId}?fields=name&supportsAllDrives=true`, token)).json();
      p.drivePasta.nome = meta.name || ''; agendarSalvar('p:' + p.id, p); document.getElementById('titulo-tela').textContent = meta.name || 'Pasta no Drive';
    }
  } catch (e) {
    lista.replaceChildren(el('p', { class: 'faixa', text: e.message === 'nao-encontrado' ? 'A pasta não foi encontrada. Ela pode ter sido movida ou apagada; use "Trocar pasta".' : 'Não foi possível abrir a pasta agora. Verifique a internet.' }));
    return;
  }
  const trazidos = new Set(documentos.filter(d => d.pid === pid && d.driveId).map(d => d.driveId));
  if (!arquivos.length) { lista.replaceChildren(el('p', { class: 'suave', text: 'A pasta está vazia.' })); return; }
  lista.replaceChildren(...arquivos.map(f => {
    const pasta = f.mimeType === TIPO_PASTA;
    return el('div', { class: 'pag-linha' },
      el('button', { type: 'button', class: 'pag-info linha-botao', style: 'text-align:left;background:none;border:0;padding:0',
        onclick: () => pasta ? ir({ tela: 'drivePaciente', pid, pasta: f.id, nome: f.name }) : abrirExterno(f.webViewLink) },
        el('strong', { text: (pasta ? '📁 ' : '') + f.name }),
        el('span', { class: 'suave', text: (pasta ? 'Pasta' : `Alterado em ${dataBR(f.modifiedTime)}`) + (trazidos.has(f.id) ? ' · já está no app' : '') })),
      !pasta && el('button', { type: 'button', class: 'secundario compacto', text: trazidos.has(f.id) ? 'Trazer de novo' : 'Trazer para o app', onclick: () => trazerDoDrive(p, f) }));
  }));
}
async function trazerDoDrive(p, f) {
  const tipo = await dialogo({ titulo: 'Trazer para o app', texto: `"${f.name}" vai ser guardado cifrado neste paciente. Onde?`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Recebidos', valor: 'recebido' }, { rotulo: 'Emitidos', valor: 'emitido', estilo: 'primario' }] });
  if (!tipo) return;
  const token = tokenGoogle?.valor; if (!token) return aviso('Conexão expirada', 'Volte e toque em "Ver arquivos" de novo.');
  if (Number(f.size) > 25 * 1048576) return aviso('Arquivo grande demais', 'O app guarda arquivos de até 25 MB. Abra este pelo Drive.');
  indicarStatus('Baixando…');
  try {
    const exp = EXPORTAR_GOOGLE[f.mimeType];
    if (!exp && f.mimeType.startsWith('application/vnd.google-apps')) throw new Error('tipo');
    const url = exp ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(exp[0])}`
      : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`;
    const bytes = new Uint8Array(await (await driveApi(url, token)).arrayBuffer());
    const nome = exp && !f.name.toLowerCase().endsWith(exp[1]) ? f.name + exp[1] : f.name;
    const data = (f.modifiedTime || agoraISO()).slice(0, 10);
    const d = await guardarDocumento(p, tipo, { nome, mime: exp ? exp[0] : (f.mimeType || 'application/octet-stream'), bytes, descricao: nome.replace(/\.[^.]+$/, ''), data });
    d.driveId = f.id; await Cofre.salvar(chaveDoc(d), d);
    indicarStatus('Guardado no app');
    render(history.state);
  } catch (e) {
    indicarStatus('');
    aviso('Não foi possível trazer', e.message === 'tipo' ? 'Este tipo de arquivo do Google não pode ser copiado. Abra pelo Drive.' : 'Verifique a internet e tente de novo.');
  }
}

// Versão 77: colocar um paciente (da lista de todos) em "Atendendo agora", com horário fixo opcional.
async function incluirEmAtendimento(p, aoFim) {
  let c = cadastroDe(p.id);
  const dia = el('select', { 'aria-label': 'Dia da semana' }, el('option', { value: '', text: 'Sem horário fixo' }), ...DIAS.map((d, i) => el('option', { value: String(i), text: d })));
  const hora = el('input', { type: 'time', value: '', 'aria-label': 'Horário' });
  const r = await janela(`Colocar ${p.nome} em "Atendendo agora"`, [
    el('p', { class: 'suave pequeno', text: 'Se ele tem horário fixo, escolha o dia e a hora: ele entra na agenda toda semana. Se ainda não tem, deixe "Sem horário fixo" — ele entra na lista do mesmo jeito.' }),
    el('label', { class: 'campo' }, el('span', { text: 'Dia' }), dia),
    el('label', { class: 'campo' }, el('span', { text: 'Horário' }), hora)
  ], [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Colocar', valor: true, estilo: 'primario' }]);
  if (!r) return;
  if (!c) { c = novoCadastro({ id: p.id, nome: p.nome }); cadastros.push(c); }
  if (c.encerradoEm) { for (const h of horariosDe(c)) if (h.fim === c.encerradoEm) { delete h.fim; delete h.fimAntes; } delete c.encerradoEm; delete c.avulsosEncerrados; }
  if (c.arquivado) c.arquivado = false;
  if (dia.value !== '' && hora.value) {
    const hs = (c.horarios ||= []);
    if (!hs.some(h => h.dia === Number(dia.value) && h.hora === hora.value && !h.fim)) hs.push({ dia: Number(dia.value), hora: hora.value });
  }
  c.emAtendimento = hojeISO(); c.atualizadoEm = agoraISO(); salvarCadastro(c);
  if (p.arquivado) { p.arquivado = false; agendarSalvar('p:' + p.id, p); }
  await salvarAgora();
  indicarStatus(`${primeiroNome(p.nome)} está em "Atendendo agora".`);
  if (aoFim) aoFim(); else render(history.state);
}
