'use strict';
/* CONSULTÓRIO — versão 2: pacientes, ficha, sessões, busca, retorno e backup cifrado. */

const app = document.getElementById('app');
const mostrar = (...nos) => app.replaceChildren(...nos.flat().filter(n => n != null && n !== false));
const VERSAO = 'versão 4';

let pacientes = [];          // decifrados, só na memória enquanto desbloqueado
let sessoes = [];            // todas as sessões, idem
const pendentes = new Map(); // alterações ainda não gravadas (chave → objeto)
let timerSalvar = null;
let filaGravacao = Promise.resolve();
let ultimaAtividade = Date.now();
let config = { bloqueioMin: 5 };
let ignorarOcultacao = false; // durante biometria, compartilhamento e escolha de arquivo
let verArquivados = false;
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
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f);
  return e;
}

const ICONES = {
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
  colar: [['rect', { x: 6, y: 4, width: 12, height: 17, rx: 2 }], ['path', { d: 'M9 4V3h6v1M9 10h6M9 14h6' }]]
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
      type: c.tipo || 'text', placeholder: c.rotulo, 'aria-label': c.rotulo, autocomplete: c.autocomplete || 'off'
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
  telaBloqueio();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && Cofre.aberto() && !ignorarOcultacao) trancar();
});
['pointerdown', 'keydown', 'input', 'scroll'].forEach(ev =>
  document.addEventListener(ev, () => { ultimaAtividade = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  if (Cofre.aberto() && Date.now() - ultimaAtividade > config.bloqueioMin * 60000) trancar();
}, 10000);

// ---------- Navegação ----------
function render(s) {
  if (!s || s.tela === 'lista') telaLista();
  else if (s.tela === 'ficha') telaFicha(s.id, s.aba || 'retomar');
  else if (s.tela === 'sessao') telaSessao(s.pid, s.sid);
  else if (s.tela === 'config') telaConfig();
  else if (s.tela === 'importar') telaImportar(s.pid);
  else if (s.tela === 'planilha') telaPlanilha();
}
function ir(estado, empilhar = true) {
  salvarAgora();
  const antes = history.state || {};
  const mudou = antes.tela !== estado.tela || antes.id !== estado.id || antes.sid !== estado.sid;
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
  [pacientes, sessoes] = await Promise.all([Cofre.lerTodos('p:'), Cofre.lerTodos('s:')]);
  history.replaceState({ tela: 'lista' }, '');
  telaLista();
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
    el('p', { class: 'suave pequeno centro', text: 'Vai trazer registros de outro aparelho? Crie a senha e depois use Configurações → Restaurar backup.' })
  ));
  s1.focus();
}

async function telaBloqueio() {
  app.replaceChildren();
  const campo = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha mestra', 'aria-label': 'Senha mestra' });
  const msg = el('p', { class: 'erro-msg', role: 'alert' });
  const botao = el('button', { type: 'button', class: 'primario', text: 'Desbloquear' });
  const tentarSenha = async () => {
    if (!campo.value) return;
    botao.disabled = true;
    msg.textContent = '';
    try { await Cofre.abrirComSenha(campo.value); campo.value = ''; await entrar(); }
    catch { msg.textContent = 'Senha incorreta.'; botao.disabled = false; campo.select(); }
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
  mostrar(porta(campo, msg, botao, botaoBio));
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

function telaLista() {
  const busca = el('input', { type: 'search', placeholder: 'Procurar pelo nome', 'aria-label': 'Procurar paciente pelo nome' });
  const lista = el('div', { class: 'cartoes' });
  const ativos = pacientes.filter(p => !p.arquivado).length;
  const desenhar = () => {
    const q = semAcento(busca.value.trim());
    const itens = pacientes
      .filter(p => !!p.arquivado === verArquivados)
      .filter(p => !q || semAcento(p.nome).includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    lista.replaceChildren(...itens.map(p => {
      const ss = sessoesDe(p.id);
      const ult = ss[ss.length - 1];
      return el('button', { type: 'button', class: 'cartao paciente', onclick: () => ir({ tela: 'ficha', id: p.id, aba: 'retomar' }) },
        avatar(p),
        el('span', { class: 'info' },
          el('span', { class: 'nome', text: p.nome }),
          el('span', { class: 'meta' }, icone('relogio'),
            el('span', { text: ult ? `Última sessão ${relativo(ult.data)}` : 'Nenhuma sessão ainda' })),
          p.dados.frequencia && el('span', { class: 'meta' }, icone('calendario'), el('span', { text: p.dados.frequencia }))),
        el('span', { class: 'contador', title: 'Sessões registradas', text: String(ss.length) }),
        icone('seguinte'));
    }));
    if (!itens.length) {
      const texto = q ? 'Nenhum nome encontrado.'
        : verArquivados ? 'Nenhum paciente arquivado.' : 'Toque em + para cadastrar o primeiro paciente.';
      lista.append(el('div', { class: 'vazio', text: texto }));
    }
  };
  busca.addEventListener('input', desenhar);

  mostrar(
    cabecalho(verArquivados ? 'Arquivados' : 'Pacientes', {
      grande: true,
      sub: verArquivados ? null : `${ativos} em acompanhamento`,
      acoes: [botaoIcone('Bloquear agora', 'cadeado', trancar), botaoIcone('Configurações', 'ajustes', () => ir({ tela: 'config' }))]
    }),
    el('div', { class: 'conteudo' },
      !verArquivados && avisoBackup(),
      el('label', { class: 'campo-busca' }, icone('busca'), busca),
      lista,
      el('button', {
        type: 'button', class: 'link',
        text: verArquivados ? 'Mostrar pacientes ativos' : 'Mostrar arquivados',
        onclick: () => { verArquivados = !verArquivados; telaLista(); }
      }),
      !verArquivados && el('button', { type: 'button', class: 'link com-icone', onclick: abrirPlanilha }, icone('tabela'), el('span', { text: 'Importar planilha com vários pacientes' }))),
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
    dados: { nascimento: '', telefone: '', contatoEmergencia: '', inicio: '', frequencia: '' },
    demanda: '', temas: '', observacoes: ''
  };
  await Cofre.salvar('p:' + p.id, p);
  pacientes.push(p);
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

  const abas = [['retomar', 'Retomar', 'retomar'], ['sessoes', 'Sessões', 'sessoes'], ['ficha', 'Ficha', 'pessoa'], ['buscar', 'Buscar', 'busca']];
  const corpo = aba === 'sessoes' ? abaSessoes(p, ss)
    : aba === 'ficha' ? abaFicha(p)
      : aba === 'buscar' ? abaBuscar(p, ss)
        : abaRetomar(p, ss);

  mostrar(
    cabecalho(p.nome, { voltar: true, status: true, acoes: [botaoIcone('Opções do paciente', 'opcoes', () => opcoesPaciente(p))] }),
    el('div', { class: 'conteudo' },
      p.arquivado && el('p', { class: 'faixa', text: 'Paciente arquivado. Os registros continuam guardados.' }),
      el('section', { class: 'hero' }, avatar(p, true),
        el('div', { class: 'hero-texto' },
          el('h2', { id: 'nome-hero', text: p.nome }),
          el('div', { class: 'chips' }, chips.map(c => el('span', { class: 'chip', text: c }))))),
      el('nav', { class: 'abas', role: 'tablist' }, abas.map(([k, rotulo, ic]) => el('button', {
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
    top.length && cartao('Temas em evidência', 'tag',
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
    el('p', { class: 'trecho' + (s.relato ? '' : ' suave'), text: s.relato ? trecho(s.relato, compacto ? 140 : 220) : 'Sem relato.' }),
    !compacto && temas.length && el('div', { class: 'chips' }, temas.map(t => el('span', { class: 'chip', text: t }))));
}

function abaSessoes(p, ss) {
  if (!ss.length) return vazioSessoes(p);
  const ordem = recentesPrimeiro ? [...ss].reverse() : ss;
  return el('div', { class: 'pilha' },
    el('div', { class: 'barra-lista' },
      el('span', { class: 'suave', text: `${ss.length} ${ss.length === 1 ? 'sessão' : 'sessões'}` }),
      el('button', {
        type: 'button', class: 'link com-icone',
        onclick: () => { recentesPrimeiro = !recentesPrimeiro; ir({ tela: 'ficha', id: p.id, aba: 'sessoes' }, false); }
      }, icone('ordenar'), el('span', { text: recentesPrimeiro ? 'Mais recentes primeiro' : 'Mais antigas primeiro' }))),
    ordem.map(s => itemSessao(p, s, ss)));
}

function abaFicha(p) {
  const salvar = () => agendarSalvar('p:' + p.id, p);
  const campo = (rotulo, chave, tipo = 'text', largo = false) =>
    el('label', { class: 'campo' + (largo ? ' largo' : '') },
      el('span', { text: rotulo }),
      el('input', { type: tipo, value: p.dados[chave] || '', oninput: e => { p.dados[chave] = e.target.value; salvar(); } }));
  const nome = el('label', { class: 'campo largo' },
    el('span', { text: 'Nome' }),
    el('input', {
      type: 'text', value: p.nome,
      oninput: e => {
        if (!e.target.value.trim()) return;
        p.nome = e.target.value.trim();
        document.getElementById('titulo-tela').textContent = p.nome;
        document.getElementById('nome-hero').textContent = p.nome;
        salvar();
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
        campo('Telefone', 'telefone', 'tel'),
        campo('Início do acompanhamento', 'inicio', 'date'),
        campo('Frequência e horário', 'frequencia'),
        campo('Contato de emergência', 'contatoEmergencia', 'text', true))),
    topico('Demanda inicial', 'alvo', 'demanda', 'O que motivou a procura, nas palavras do paciente'),
    topico('Temas recorrentes', 'repetir', 'temas', 'Significantes, cenas e questões que retornam'),
    topico('Observações', 'nota', 'observacoes', 'Anotações gerais'));
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
  data.addEventListener('change', () => { if (!data.value) return; s.data = data.value; salvar(); telaSessao(pid, sid); });

  const segmento = el('div', { class: 'segmento', role: 'radiogroup', 'aria-label': 'Situação' },
    Object.entries(STATUS).map(([k, rotulo]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(s.status === k), class: s.status === k ? 'ativo ' + k : '',
      text: rotulo,
      onclick: () => { s.status = k; salvar(); telaSessao(pid, sid); }
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
        cartao('O que foi trazido', 'texto', area('O que foi trazido', 'relato', 'Relato da sessão', true),
          s.origem && el('small', { class: 'suave origem', text: 'Importado de ' + s.origem })),
        cartao('Para retomar', 'retomar', area('Para retomar', 'retomar', 'O que retomar no próximo atendimento', false)),
        cartao('Temas da sessão', 'tag',
          el('input', {
            type: 'text', value: s.temas, placeholder: 'Separe por vírgulas: pai, trabalho, sonho da escada', 'aria-label': 'Temas da sessão',
            oninput: e => { s.temas = e.target.value; desenharPrevia(); salvar(); }
          }),
          previa)))
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
    await Cofre.apagar('p:' + p.id);
    sessoes = sessoes.filter(s => s.pid !== p.id);
    pacientes = pacientes.filter(x => x.id !== p.id);
    history.back();
  }
}

// ---------- Backup cifrado ----------
async function fazerBackup() {
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
  await salvarAgora();
  const registros = {};
  pacientes.forEach(p => { registros['p:' + p.id] = p; });
  sessoes.forEach(s => { registros[chaveSessao(s)] = s; });
  const texto = await Cofre.cifrarPacote(s1, { formato: 'consultorio', versao: 1, criadoEm: new Date().toISOString(), registros });
  const nome = `consultorio-backup-${hojeISO()}.cifrado.txt`;
  const arquivo = new File([texto], nome, { type: 'text/plain' });

  const destino = await dialogo({
    titulo: 'Backup pronto e cifrado',
    texto: `${pacientes.length} pacientes e ${sessoes.length} sessões. Fora deste app, o arquivo é ilegível sem a senha. Onde guardar?`,
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
    await aviso('Backup feito', 'Guarde a senha do backup junto com a senha mestra.');
    if (history.state?.tela === 'config') telaConfig(); else render(history.state);
  }
}

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
  const [arquivo] = await escolherArquivos({ accept: '.txt,text/plain' });
  if (!arquivo) return;
  const senha = await dialogo({
    titulo: 'Restaurar backup',
    texto: arquivo.name,
    campos: [{ rotulo: 'Senha do backup', tipo: 'password', autocomplete: 'off' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Restaurar', valor: true, estilo: 'primario' }]
  });
  if (!senha) return;
  let pacote;
  try { pacote = await Cofre.decifrarPacote(senha, await arquivo.text()); }
  catch (e) {
    return aviso('Não foi possível restaurar', e.message === 'senha-incorreta' ? 'Senha do backup incorreta.' : 'Este arquivo não é um backup do Consultório.');
  }
  await salvarAgora();
  let novos = 0, atualizados = 0, mantidos = 0;
  for (const [k, o] of Object.entries(pacote.registros || {})) {
    const lista = k.startsWith('p:') ? pacientes : k.startsWith('s:') ? sessoes : null;
    if (!lista) continue;
    const pos = lista.findIndex(x => (k.startsWith('p:') ? 'p:' + x.id : chaveSessao(x)) === k);
    if (pos < 0) { await Cofre.salvar(k, o); lista.push(o); novos++; }
    else if ((o.atualizadoEm || '') > (lista[pos].atualizadoEm || '')) { await Cofre.salvar(k, o); lista[pos] = o; atualizados++; }
    else mantidos++;
  }
  await aviso('Backup restaurado', `${novos} registros novos, ${atualizados} atualizados e ${mantidos} mantidos porque a versão deste aparelho era igual ou mais recente.`);
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
      importacao.avisos.length && el('div', { class: 'aviso-backup' },
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
const CAMPOS_DADOS = ['nascimento', 'telefone', 'contatoEmergencia', 'inicio', 'frequencia'];
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
        dados: { nascimento: '', telefone: '', contatoEmergencia: '', inicio: '', frequencia: '' }, demanda: '', temas: '', observacoes: '' };
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

  const tempo = el('select', { 'aria-label': 'Tempo até o bloqueio automático' },
    ...[1, 2, 5, 10, 15].map(m => el('option', { value: String(m), text: m + (m === 1 ? ' minuto' : ' minutos') })));
  tempo.value = String(config.bloqueioMin);
  tempo.addEventListener('change', async () => { config.bloqueioMin = Number(tempo.value); await Cofre.salvarConfig(config); });

  const linha = (ic, titulo, detalhe, controle) => el('div', { class: 'linha-config' },
    el('span', { class: 'ic-bolha' }, icone(ic)),
    el('div', { class: 'linha-texto' }, el('p', { text: titulo }), detalhe && el('small', { text: detalhe })), controle);
  const secao = (titulo, ...linhas) => el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: titulo }), ...linhas);

  mostrar(
    cabecalho('Configurações', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      secao('Acesso',
        linha('relogio', 'Bloqueio automático', 'Sem uso por este tempo, o app se fecha. Ele também se fecha ao sair para outro app.', tempo),
        linha('pessoa', 'Biometria', temBio ? 'Ativada neste aparelho.' : 'Desbloqueio pela digital, com a senha mestra como reserva.',
          el('button', { type: 'button', class: 'secundario compacto', text: temBio ? 'Desativar' : 'Ativar', onclick: temBio ? desativarBio : ativarBio })),
        linha('cadeado', 'Senha mestra', null, el('button', { type: 'button', class: 'secundario compacto', text: 'Trocar', onclick: trocarSenha }))),
      secao('Backup e transferência',
        linha('escudo', 'Fazer backup cifrado',
          config.ultimoBackup ? `Último: ${dataBR(config.ultimoBackup)}.` : 'Nenhum backup feito ainda.',
          el('button', { type: 'button', class: 'primario compacto', text: 'Fazer', onclick: fazerBackup })),
        linha('tabela', 'Importar planilha', 'Traz vários pacientes e sessões de uma planilha (Google Planilhas, Excel ou CSV).',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Importar', onclick: abrirPlanilha })),
        linha('retomar', 'Restaurar backup', 'Também serve para passar os registros do celular para o tablet e vice-versa.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Restaurar', onclick: restaurarBackup }))),
      secao('Armazenamento',
        linha('nota', 'Proteção contra limpeza automática',
          persistente ? 'Ativa: o Android não apaga estes dados para liberar espaço.' : 'Inativa: o Android pode apagar os dados se faltar espaço.',
          !persistente && el('button', { type: 'button', class: 'secundario compacto', text: 'Ativar', onclick: async () => { await navigator.storage?.persist?.(); telaConfig(); } }))),
      el('p', { class: 'suave pequeno centro', text: `Consultório, ${VERSAO}. Este app não se conecta a nenhum servidor: a única atividade de rede é baixar as próprias atualizações.` }))
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

// ---------- Início ----------
(async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.SEM_SW) navigator.serviceWorker.register('sw.js').catch(() => { });
  Object.assign(config, await Cofre.lerConfig());
  if (await Cofre.existe()) telaBloqueio();
  else telaCriacao();
})();
