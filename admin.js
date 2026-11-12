'use strict';
/* ÁREA ADMINISTRATIVA — versão 7 (agenda com séries e feriados na versão 11)
   Abre com a senha do administrativo (ou com a senha mestra, que abre tudo).
   Aqui ficam: cadastro administrativo dos pacientes (nome, celular, CPF, valor, horários, nota fiscal),
   agenda de atendimentos, pagamentos com comprovante, mensagens, declarações de comparecimento e recibos.
   Nada de conteúdo clínico passa por aqui: fichas, sessões e documentos recebidos ficam na área clínica.
   Todos os registros daqui usam chaves "x:" e são cifrados com a chave administrativa. */

let cadastros = [];      // x:p:<id>
let atendimentos = [];   // x:a:<pid>:<id>  (data, hora, presença, pagamento, valor)
let lembretesAdm = [];   // x:l:<id>  (versão 58: lembretes do Rodrigo para o administrativo; sem dados clínicos)
let pagamentos = [];     // x:g:<pid>:<id>  (data, valor, atendimentos pagos, comprovante, nota fiscal)
const lapides = new Map(); // registros excluídos, guardados só como marca para a troca entre aparelhos
let senhaTroca = null;   // senha dos arquivos trocados com o outro aparelho (guardada dentro do cofre)
let entradaIds = [];     // comprovantes recebidos pelo compartilhamento, ainda sem paciente
let pagamentoRasc = null;
let verTodosAtend = false;
let verArquivadosAdm = false;
let aparelhoComClinica = false;

const PRESENCA = { realizada: 'Veio', falta: 'Faltou', tardia: 'Desmarcou em cima da hora', cancelada: 'Desmarcou (24h ou mais)', remarcada: 'Remarcada' };
const chaveCad = c => 'x:p:' + c.id;
const chaveAt = a => `x:a:${a.pid}:${a.id}`;
const chavePag = g => `x:g:${g.pid}:${g.id}`;
const cadastroDe = id => cadastros.find(c => c.id === id) || null;
const salvarCadastro = c => agendarSalvar(chaveCad(c), c);
const salvarAt = a => agendarSalvar(chaveAt(a), a);
const salvarPag = g => agendarSalvar(chavePag(g), g);
const chaveLem = l => 'x:l:' + l.id;
const salvarLem = l => { l.atualizadoEm = agoraISO(); agendarSalvar(chaveLem(l), l); };
// Versão 65: o valor da sessão tem histórico com data. Mudar o valor vale a partir da data escolhida;
// as sessões anteriores continuam com o valor antigo. c.valores = [{ desde: 'aaaa-mm-dd', valor }].
function valorNaData(c, data) {
  if (!c) return perfil?.valorSessao || '';
  const hist = (c.valores || []).filter(v => v.desde <= (data || hojeISO())).sort((a, b) => a.desde.localeCompare(b.desde));
  if (hist.length) return hist[hist.length - 1].valor || perfil?.valorSessao || '';
  if (c.valores?.length) return c.valores.slice().sort((a, b) => a.desde.localeCompare(b.desde))[0].antes ?? (perfil?.valorSessao || '');
  return c.valor || perfil?.valorSessao || '';
}
const valorPadrao = (c, data) => valorNaData(c, data);
const valorDe = a => valorNum(a.valor) || valorNum(valorNaData(cadastroDe(a.pid), a.data));
const agoraISO = () => new Date().toISOString();
const nomeMes = ym => paraData(ym + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
const somarMeses = (ym, n) => { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function atendimentosDe(pid) {
  return atendimentos.filter(a => a.pid === pid).sort((x, y) => x.data.localeCompare(y.data) || (x.hora || '').localeCompare(y.hora || ''));
}
const pagamentosDe = pid => pagamentos.filter(g => g.pid === pid).sort((x, y) => y.data.localeCompare(x.data) || (y.criadoEm || '').localeCompare(x.criadoEm || ''));

function limparAdm() {
  cadastros = []; atendimentos = []; pagamentos = []; lembretesAdm = []; lapides.clear();
  senhaTroca = null; entradaIds = []; pagamentoRasc = null; verTodosAtend = false; tokenGoogle = null; importacaoDrive = null; notaRasc = null;
}

// ---------- Carregar e entrar ----------
async function carregarAdm() {
  const [cs, as, gs, ds, ls] = await Promise.all([Cofre.lerTodos('x:p:'), Cofre.lerTodos('x:a:'), Cofre.lerTodos('x:g:'), Cofre.lerTodos('x:d:'), Cofre.lerTodos('x:l:')]);
  lapides.clear();
  const separar = (lista, chave) => lista.filter(o => { if (o.excluido) { lapides.set(chave(o), o); return false; } return true; });
  cadastros = cs;
  atendimentos = separar(as, chaveAt);
  pagamentos = separar(gs, chavePag);
  lembretesAdm = ls.filter(l => !l.excluido);
  perfil = Object.assign(PERFIL_PADRAO(), (await Cofre.ler('x:perfil')) || {});
  if (modo === 'adm') assinatura = await Cofre.ler('x:assinatura');
  senhaTroca = (await Cofre.ler('x:senhatroca'))?.senha || null;
  documentos = modo === 'adm' ? ds : [...documentos.filter(d => !d.adm), ...ds];
  try { entradaIds = (await Cofre.listarEntrada()).map(i => i.id); } catch { entradaIds = []; }
}

async function entrarAdm() {
  ultimaAtividade = Date.now();
  modo = 'adm';
  aparelhoComClinica = await Cofre.temClinica();
  await Cofre.garantirChavesEntrada();
  await carregarAdm();
  history.replaceState({ tela: 'lista' }, '');
  if (!(await abrirEntradaSePendente())) telaInicioAdm();
}

async function recarregarTudo() {
  if (Cofre.clinicaAberta()) {
    [pacientes, sessoes] = await Promise.all([Cofre.lerTodos('p:'), Cofre.lerTodos('s:')]);
    await carregarExtras();
  }
  await carregarAdm();
  if (modo === 'dono') { await sincronizarCadastros(); await sincronizarAtendimentos(); await salvarAgora(); }
}

function renderAdm(s) {
  if (s.tela === 'adm') { telaAdm(s.id, s.aba || 'atendimentos'); return true; }
  if (s.tela === 'admInicio') { telaInicioAdm(); return true; }
  if (s.tela === 'admPacientes') { telaInicioAdm(true); return true; }
  if (s.tela === 'mes') { telaMes(s.ym || hojeISO().slice(0, 7)); return true; }
  if (s.tela === 'pagar') { telaPagar(s); return true; }
  if (s.tela === 'notaRecebida') { telaNotaRecebida(s); return true; }
  if (s.tela === 'drive') { telaDrive(); return true; }
  if (s.tela === 'driveImportar') { telaImportarDrive(); return true; }
  if (s.tela === 'agenda') { telaAgenda(s.semana); return true; }
  if (s.tela === 'agendaMes') { telaAgendaMes(s.ym); return true; }
  if (s.tela === 'confirmacoes') { telaConfirmacoes(s.semana); return true; }
  if (s.tela === 'listaSemana') { telaListaSemana(s.semana); return true; }
  if (s.tela === 'expediente') { telaExpediente(); return true; }
  if (s.tela === 'agendar') { telaAgendar(s.id); return true; }
  if (s.tela === 'feriados') { telaFeriados(s.ano); return true; }
  return false;
}

// ---------- Migração da versão 6 e ligação com a área clínica (só com a senha mestra) ----------
function novoCadastro(dados) {
  const agora = agoraISO();
  return Object.assign({ id: crypto.randomUUID(), nome: '', telefone: '', cpf: '', nascimento: '', valor: '', horarios: [], nf: false, pagador: '', cpfPagador: '', arquivado: false, criadoEm: agora, atualizadoEm: agora }, dados);
}
async function criarCadastro(dados) {
  const c = novoCadastro(dados);
  cadastros.push(c);
  await Cofre.salvar(chaveCad(c), c);
  return c;
}

async function migrarParaV7() {
  if (await Cofre.ler('x:migrado7')) return;
  if (perfilAntigo && !perfil.atualizadoEm) { perfil = Object.assign(PERFIL_PADRAO(), perfilAntigo); salvarPerfil(); }
  for (const p of pacientes) {
    if (cadastroDe(p.id)) continue;
    const c = novoCadastro({ id: p.id, nome: p.nome, telefone: p.dados.telefone || '', cpf: p.dados.cpf || '', nascimento: p.dados.nascimento || '', valor: p.dados.valorSessao || '', horarios: p.dados.horarios || [], arquivado: !!p.arquivado });
    cadastros.push(c); salvarCadastro(c);
  }
  await salvarAgora();
  await Cofre.salvar('x:migrado7', { tipoRegistro: 'migracao', em: agoraISO() });
  if (perfilAntigo) { await Cofre.apagar('c:perfil'); perfilAntigo = null; }
  if (modo === 'dono') await atualizarCopiaAssinatura();
}

// Nome, CPF e celular existem nos dois lados. O cadastro administrativo vale em caso de diferença;
// campos vazios de um lado são preenchidos pelo outro.
async function sincronizarCadastros() {
  if (modo !== 'dono') return;
  const pares = [['nome', p => p.nome, (p, v) => { p.nome = v; }], ['cpf', p => p.dados.cpf, (p, v) => { p.dados.cpf = v; }], ['telefone', p => p.dados.telefone, (p, v) => { p.dados.telefone = v; }],
    ['nascimento', p => p.dados.nascimento, (p, v) => { p.dados.nascimento = v; }]];
  for (const p of pacientes) {
    let c = cadastroDe(p.id);
    if (!c) { c = novoCadastro({ id: p.id, nome: p.nome, telefone: p.dados.telefone || '', cpf: p.dados.cpf || '', nascimento: p.dados.nascimento || '', arquivado: !!p.arquivado }); cadastros.push(c); salvarCadastro(c); continue; }
    let mudouP = false, mudouC = false;
    for (const [campo, lerP, gravarP] of pares) {
      const vp = (lerP(p) || '').trim(), vc = (c[campo] || '').trim();
      if (vc && vp !== vc) { gravarP(p, c[campo]); mudouP = true; }
      else if (!vc && vp) { c[campo] = lerP(p); mudouC = true; }
    }
    if (p.arquivado && !c.arquivado) { c.arquivado = true; mudouC = true; }
    if (mudouP) agendarSalvar('p:' + p.id, p);
    if (mudouC) salvarCadastro(c);
  }
  const agora = agoraISO();
  for (const c of cadastros) {
    if (pacientes.some(p => p.id === c.id)) continue;
    const p = { id: c.id, nome: c.nome, criadoEm: agora, atualizadoEm: agora, arquivado: !!c.arquivado,
      dados: { nascimento: c.nascimento || '', cpf: c.cpf || '', telefone: c.telefone || '', contatoEmergencia: '', inicio: '', frequencia: '' }, demanda: '', temas: '', observacoes: '' };
    pacientes.push(p); agendarSalvar('p:' + p.id, p);
  }
}
function copiarParaCadastro(p) {
  const c = cadastroDe(p.id);
  if (!c) return;
  c.nome = p.nome; c.cpf = p.dados.cpf || ''; c.telefone = p.dados.telefone || ''; c.nascimento = p.dados.nascimento || '';
  salvarCadastro(c);
}
function copiarParaFicha(c) {
  if (modo !== 'dono') return;
  const p = pacientes.find(x => x.id === c.id);
  if (!p) return;
  p.nome = c.nome; p.dados.cpf = c.cpf; p.dados.telefone = c.telefone; p.dados.nascimento = c.nascimento || '';
  agendarSalvar('p:' + p.id, p);
}
async function arquivarCadastro(pid, arquivado) {
  const c = cadastroDe(pid);
  if (!c) return;
  c.arquivado = arquivado; salvarCadastro(c); await salvarAgora();
}
async function excluirAdmDe(pid) {
  for (const a of atendimentos.filter(x => x.pid === pid)) await Cofre.apagar(chaveAt(a));
  for (const g of pagamentos.filter(x => x.pid === pid)) await Cofre.apagar(chavePag(g));
  for (const d of documentos.filter(x => x.pid === pid && x.adm)) { await Cofre.apagar(chaveDoc(d)); await Cofre.apagar(chaveConteudo(d)); }
  await Cofre.apagar('x:p:' + pid);
  atendimentos = atendimentos.filter(x => x.pid !== pid);
  pagamentos = pagamentos.filter(x => x.pid !== pid);
  documentos = documentos.filter(x => !(x.pid === pid && x.adm));
  cadastros = cadastros.filter(x => x.id !== pid);
}

// Cada sessão registrada na área clínica corresponde a um atendimento da agenda (sem o conteúdo).
// Regra do consultório: veio, faltou ou desmarcou com menos de 24h → cobra; desmarcou com 24h ou mais, ou remarcou → não cobra.
function pagamentoInicial(presenca) { return ['realizada', 'falta', 'tardia'].includes(presenca) ? 'areceber' : presenca ? 'naocobrar' : null; }
function horaFixa(c, data) { return horariosDe(c).find(h => Number(h.dia) === paraData(data).getDay())?.hora || ''; }
async function sincronizarAtendimentos() {
  if (modo !== 'dono') return;
  const porSid = new Map(atendimentos.filter(a => a.sid).map(a => [a.sid, a]));
  const agora = agoraISO();
  for (const s of sessoes) {
    if (porSid.has(s.id)) continue;
    const livre = atendimentos.find(a => a.pid === s.pid && a.data === s.data && !a.sid);
    if (livre) { livre.sid = s.id; if (!livre.presenca) { livre.presenca = s.status; ajustarPagamentoAoStatus(livre); } salvarAt(livre); continue; }
    const c = cadastroDe(s.pid);
    // Sessões antigas ou importadas só entram na cobrança se já tinham controle de pagamento (versão 6).
    const a = { id: crypto.randomUUID(), sid: s.id, pid: s.pid, data: s.data, hora: horaFixa(c, s.data), presenca: s.status,
      pagamento: s.pagamento || null, valor: s.valor || '', pagoEm: s.pagoEm || null, pagamentoManual: !!s.pagamentoManual, criadoEm: agora, atualizadoEm: agora };
    atendimentos.push(a); salvarAt(a);
    if (a.pagamento === 'pago') {
      const g = { id: crypto.randomUUID(), pid: a.pid, data: a.pagoEm || a.data, valor: valorDe(a), atendimentos: [a.id], comprovanteId: null, nf: { emitida: false, numero: '' }, criadoEm: agora, atualizadoEm: agora };
      a.pagamentoId = g.id; pagamentos.push(g); salvarPag(g);
    }
  }
}
function vincularSessao(s, nova = false) {
  let a = atendimentos.find(x => x.sid === s.id);
  if (!a) a = atendimentos.find(x => x.pid === s.pid && x.data === s.data && !x.sid);
  if (!a) {
    const agora = agoraISO();
    a = { id: crypto.randomUUID(), pid: s.pid, data: s.data, hora: horaFixa(cadastroDe(s.pid), s.data), presenca: s.status,
      pagamento: nova ? pagamentoInicial(s.status) : null, valor: valorPadrao(cadastroDe(s.pid), s.data), criadoEm: agora, atualizadoEm: agora };
    atendimentos.push(a);
  }
  a.sid = s.id; a.data = s.data; a.presenca = s.status;
  if (!a.pagamento && nova) a.pagamento = pagamentoInicial(s.status);
  ajustarPagamentoAoStatus(a);
  salvarAt(a);
}
async function desvincularSessao(s) {
  const a = atendimentos.find(x => x.sid === s.id);
  if (!a) return;
  if (a.pagamento === 'pago') { a.sid = null; salvarAt(a); } else await excluirAtendimento(a);
}
function ajustarPagamentoAoStatus(a) {
  if (!a.pagamento || a.pagamento === 'pago' || a.pagamentoManual) return;
  a.pagamento = pagamentoInicial(a.presenca) || a.pagamento;
  if (a.pagamento === 'areceber') usarCredito(a);
}
// Pagamento adiantado (ou pacote do mês): cada atendimento novo consome o saldo que sobrou.
function saldoDe(g) {
  const usado = atendimentos.filter(x => (g.atendimentos || []).includes(x.id)).reduce((t, x) => t + valorDe(x), 0);
  return valorNum(g.valor) - usado;
}
function usarCredito(a) {
  const v = valorDe(a);
  if (!v) return;
  const g = pagamentos.filter(x => x.pid === a.pid).sort((x, y) => x.data.localeCompare(y.data)).find(x => saldoDe(x) >= v - 0.005);
  if (!g) return;
  g.atendimentos = [...(g.atendimentos || []), a.id]; salvarPag(g);
  a.pagamento = 'pago'; a.pagoEm = g.data; a.pagamentoId = g.id;
}
function cartaoAtendimentoSessao(p, s) {
  const a = atendimentos.find(x => x.sid === s.id);
  if (!a || !a.pagamento) return null;
  return el('button', { type: 'button', class: 'cartao atalho-largo', onclick: () => ir({ tela: 'adm', id: p.id, aba: 'pagamentos' }) },
    el('span', { class: 'ic-bolha' }, icone('moeda')),
    el('span', { class: 'info' }, el('strong', { text: 'Pagamento' }),
      el('small', { class: 'suave', text: `R$ ${reais(valorDe(a))}` })),
    el('span', { class: 'selo ' + a.pagamento, text: PAGAMENTO[a.pagamento] }), icone('seguinte'));
}

async function excluirAtendimento(a) {
  atendimentos = atendimentos.filter(x => x !== a);
  pendentes.delete(chaveAt(a));
  const l = { id: a.id, pid: a.pid, excluido: true, atualizadoEm: agoraISO() };
  lapides.set(chaveAt(a), l);
  await Cofre.salvar(chaveAt(a), l);
}

// ---------- Assinatura na área administrativa ----------
async function atualizarCopiaAssinatura() {
  if (modo !== 'dono') return;
  if (perfil.assinaturaNoAdm && assinatura) await Cofre.salvar('x:assinatura', { ...assinatura, atualizadoEm: agoraISO() });
  else await Cofre.apagar('x:assinatura');
}

// ---------- Agenda do dia (tela inicial) ----------
function marcarPresenca(c, data, hora, presenca) {
  let a = atendimentos.find(x => x.pid === c.id && x.data === data);
  if (!a) {
    const agora = agoraISO();
    a = { id: crypto.randomUUID(), pid: c.id, data, hora, presenca: null, pagamento: null, valor: valorPadrao(c, data), criadoEm: agora, atualizadoEm: agora };
    atendimentos.push(a);
  }
  a.presenca = presenca;
  if (!a.pagamento) a.pagamento = pagamentoInicial(presenca);
  ajustarPagamentoAoStatus(a);
  salvarAt(a);
  render(history.state);
}
function cartaoAgenda() {
  if (!cadastros.some(c => !c.arquivado && temAgenda(c))) return null;
  const hoje = hojeISO(), amanha = somarDias(hoje, 1);
  const linha = ({ c, hora }, dia) => {
    const a = atendimentos.find(x => x.pid === c.id && x.data === dia);
    let acoes;
    if (dia !== hoje) {
      acoes = el('button', { type: 'button', class: 'chip acao', text: 'Confirmar', onclick: () => {
        rascunhoMsg[c.id] = { modelo: 0, data: amanha, hora, texto: null };
        ir({ tela: 'adm', id: c.id, aba: 'mensagem' });
      } });
    } else {
      // Versão 29: presença direto na linha de hoje (veio, faltou, desmarcou com a regra das 24h, remarcou).
      const o = ocorrenciasNoPeriodo(c, dia, dia).find(x => (x.hora || '') === (hora || '')) || { c, data: dia, hora: hora || '' };
      const pres = atDaOcorrencia(c, dia, hora)?.presenca;
      const chipPres = el('button', { type: 'button', class: 'chip acao' + (pres ? '' : ' marcado'), text: pres ? CHIP_PRESENCA[pres] : 'Presença', 'aria-label': `Presença de ${c.nome}`, onclick: () => acoesListaPaciente(o) });
      if (modo === 'dono') {
        const feita = sessoesDe(c.id).find(s => s.data === hoje);
        const chipSessao = feita ? el('button', { type: 'button', class: 'chip acao', text: 'Anotação feita', onclick: () => ir({ tela: 'sessao', pid: c.id, sid: feita.id }) })
          : el('button', { type: 'button', class: 'chip acao', text: 'Anotar sessão', onclick: () => { const p = pacientes.find(x => x.id === c.id); if (p) novaSessao(p); } });
        acoes = el('span', { class: 'chips' }, chipPres, chipPagamentoSessao(c, atDaOcorrencia(c, dia, hora)), chipSessao);
      } else acoes = el('span', { class: 'chips' }, chipPres, chipPagamentoSessao(c, atDaOcorrencia(c, dia, hora)));
    }
    return el('div', { class: 'agenda-linha' },
      el('span', { class: 'agenda-hora', text: horaCurta(hora) || '—' }),
      el('button', { type: 'button', class: 'agenda-nome', onclick: () => ir(modo === 'dono' ? { tela: 'ficha', id: c.id, aba: 'retomar' } : { tela: 'adm', id: c.id, aba: 'atendimentos' }) }, avatar(c), el('span', { text: c.nome })),
      acoes);
  };
  const hj = agendaDoDia(hoje, true), am = agendaDoDia(amanha);
  const titulo = d => `${paraData(d).toLocaleDateString('pt-BR', { weekday: 'long' })}, ${dataCurta(d).slice(0, 5)}`;
  return el('section', { class: 'cartao agenda' },
    el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('calendario')), el('span', { text: 'Hoje, ' + titulo(hoje) })),
    diaSemAtendimento(hoje) && el('p', { class: 'faixa', text: `Hoje: ${diaSemAtendimento(hoje).nome}. Sem atendimentos.` }),
    hj.length ? hj.map(i => linha(i, hoje)) : !diaSemAtendimento(hoje) && el('p', { class: 'suave pequeno', text: 'Nenhum atendimento hoje.' }),
    am.length > 0 && el('details', { class: 'agenda-amanha' },
      el('summary', { text: `Amanhã: ${am.length} ${am.length === 1 ? 'atendimento' : 'atendimentos'}` }),
      am.map(i => linha(i, amanha))),
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'link', text: 'Ver a agenda da semana', onclick: () => ir({ tela: 'agenda' }) }),
      el('button', { type: 'button', class: 'link', text: 'Confirmações da semana', onclick: () => ir({ tela: 'confirmacoes' }) })));
}

// ---------- Aniversários ----------
function fazAniversario(c, ymd) {
  if (!c.nascimento || c.arquivado) return false;
  const md = c.nascimento.slice(5), [a, m, d] = ymd.split('-').map(Number);
  const bissexto = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  return md === ymd.slice(5) || (md === '02-29' && !bissexto && m === 2 && d === 28);
}
function aniversariantes(ymd) { return cadastros.filter(c => fazAniversario(c, ymd)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')); }
function mandarParabens(c) {
  const modelos = [...MODELOS_MSG, ...(perfil.modelos || [])];
  const i = Math.max(0, modelos.findIndex(m => m.nome === 'Aniversário'));
  rascunhoMsg[c.id] = { modelo: i, data: '', hora: '', texto: null };
  ir({ tela: 'adm', id: c.id, aba: 'mensagem' });
}
function cartaoAniversarios() {
  const hoje = hojeISO();
  const hj = aniversariantes(hoje);
  const proximos = [];
  for (let n = 1; n <= 7; n++) { const d = somarDias(hoje, n); for (const c of aniversariantes(d)) proximos.push({ c, d }); }
  if (!hj.length && !proximos.length) return null;
  const anos = c => { const i = idade(c.nascimento); return i != null ? ` (${i} anos)` : ''; };
  return el('section', { class: 'cartao agenda aniversarios' },
    el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('bolo')),
      el('span', { text: hj.length ? (hj.length === 1 ? 'Aniversário hoje' : 'Aniversários hoje') : 'Aniversários da semana' })),
    hj.map(c => el('div', { class: 'agenda-linha' },
      el('button', { type: 'button', class: 'agenda-nome', onclick: () => ir({ tela: 'adm', id: c.id, aba: 'cadastro' }) }, avatar(c), el('span', { text: c.nome + anos(c) })),
      el('button', { type: 'button', class: 'chip acao marcado', text: 'Parabéns', onclick: () => mandarParabens(c) }))),
    proximos.length > 0 && (hj.length
      ? el('details', { class: 'agenda-amanha' }, el('summary', { text: `Nos próximos 7 dias: ${proximos.length}` }), proximos.map(linhaProximo))
      : proximos.map(linhaProximo)));
  function linhaProximo({ c, d }) {
    return el('div', { class: 'agenda-linha' },
      el('span', { class: 'agenda-hora', text: dataCurta(d).slice(0, 5) }),
      el('button', { type: 'button', class: 'agenda-nome', onclick: () => ir({ tela: 'adm', id: c.id, aba: 'cadastro' }) }, avatar(c), el('span', { text: c.nome })),
      el('span', { class: 'suave pequeno', text: diaSemana(d) }));
  }
}

function cartaoEntrada() {
  if (!entradaIds.length) return null;
  const n = entradaIds.length;
  return el('div', { class: 'aviso-backup aviso-entrada' },
    el('span', { class: 'ic-bolha' }, icone('clipe')),
    el('div', {},
      el('strong', { text: n === 1 ? '1 comprovante recebido' : `${n} comprovantes recebidos` }),
      el('small', { text: 'Escolha o paciente para registrar o pagamento.' })),
    el('button', { type: 'button', class: 'primario compacto', text: 'Abrir', onclick: () => ir({ tela: 'pagar', eid: entradaIds[0] }) }));
}
async function abrirEntradaSePendente() {
  const q = new URLSearchParams(location.search);
  if (!q.has('recebido')) return false;
  const erro = q.get('recebido') === 'erro';
  history.replaceState(history.state, '', location.pathname);
  if (erro) { setTimeout(() => aviso('Comprovante não recebido', 'O arquivo não pôde ser guardado. Abra o app uma vez com a senha e tente compartilhar de novo.'), 300); return false; }
  if (!entradaIds.length) return false;
  ir({ tela: 'pagar', eid: entradaIds[0] });
  return true;
}

// ---------- Tela inicial do administrativo ----------
// Versão 48: a tela inicial mostra só o resumo; a lista completa fica em "Todos os pacientes".
function telaInicioAdm(todos = false) {
  if (!todos) verArquivadosAdm = false;
  const busca = el('input', { type: 'search', placeholder: 'Procurar pelo nome', 'aria-label': 'Procurar paciente pelo nome' });
  const lista = el('div', { class: 'cartoes' });
  const ym = hojeISO().slice(0, 7);
  const desenhar = () => {
    const q = semAcento(busca.value.trim());
    let itens = cadastros.filter(c => !!c.arquivado === verArquivadosAdm && (!q || semAcento(c.nome).includes(q)))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!todos && cadastros.length) {
      if (!q) { lista.replaceChildren(); return; }   // na tela inicial, os nomes só aparecem quando a pessoa digita
      itens = itens.slice(0, 8);
    }
    lista.replaceChildren(...itens.map(c => {
      const px = proximoHorario(c);
      const r = resumoMes(c, ym);
      return el('button', { type: 'button', class: 'cartao paciente', onclick: () => ir({ tela: 'adm', id: c.id, aba: 'atendimentos' }) },
        avatar(c),
        el('span', { class: 'info' },
          el('span', { class: 'nome', text: c.nome }),
          el('span', { class: 'meta' }, icone('calendario'), el('span', { text: px ? `Próximo: ${diaSemana(px.data)} ${dataCurta(px.data).slice(0, 5)}, ${horaCurta(px.hora)}` : 'Sem horário fixo' }))),
        r.status && el('span', { class: 'selo ' + r.status, text: SITUACAO_MES[r.status] }),
        icone('seguinte'));
    }));
    if (!itens.length) lista.append(el('div', { class: 'vazio' }, el('p', { text: q ? 'Nenhum nome encontrado.' : verArquivadosAdm ? 'Nenhum paciente arquivado.' : 'Nenhum paciente ainda.' }),
      !q && !verArquivadosAdm && modo === 'adm' && !cadastros.length && el('button', { type: 'button', class: 'secundario', text: 'Receber dados do aparelho do Rodrigo', onclick: importarAdm })));
  };
  busca.addEventListener('input', desenhar);
  const tot = totaisMes(ym);
  mostrar(
    todos ? cabecalho(verArquivadosAdm ? 'Arquivados' : 'Todos os pacientes', { voltar: true, sub: `${cadastros.filter(c => !c.arquivado).length} ativos` }) : cabecalho(modo === 'adm' ? 'Consultório' : 'Administrativo', {
      grande: modo === 'adm', voltar: modo === 'dono', sub: modo === 'adm' ? 'Área administrativa' : null,
      acoes: [botaoSincronizar(), botaoConfirmacoes(), botaoAgenda(), botaoIcone('Pagamentos do mês', 'moeda', () => ir({ tela: 'mes' })),
        botaoIcone('Bloquear agora', 'cadeado', trancar), botaoIcone('Configurações', 'ajustes', () => ir({ tela: 'config' }))]
    }),
    el('div', { class: 'conteudo' },
      !todos && cartaoLembretesAdm(),
      !todos && cartaoAvisosAgenda(),
      !todos && cartaoEntrada(),
      !todos && cartaoAniversarios(),
      !todos && cartaoVencidos(),
      !todos && cartaoSemNota(),
      !todos && cartaoAgenda(),
      !todos && cartaoPagamentosInicio(ym, tot),
      el('label', { class: 'campo-busca' }, icone('busca'), busca),
      lista,
      !todos && cadastros.length > 0 && el('button', { type: 'button', class: 'cartao paciente todos-pacientes', onclick: () => ir({ tela: 'admPacientes' }) },
        el('span', { class: 'ic-bolha' }, icone('pessoa')),
        el('span', { class: 'info' }, el('span', { class: 'nome', text: 'Todos os pacientes' }), el('span', { class: 'meta' }, el('span', { text: `${cadastros.filter(c => !c.arquivado).length} ativos · arquivados` }))),
        icone('seguinte')),
      el('div', { class: 'atalhos' },
        el('button', { type: 'button', class: 'atalho', onclick: () => { if (!todos) { verArquivadosAdm = true; ir({ tela: 'admPacientes' }); return; } verArquivadosAdm = !verArquivadosAdm; telaInicioAdm(true); } },
          el('span', { class: 'ic-bolha' }, icone(verArquivadosAdm ? 'pessoa' : 'caixa')), el('span', { text: verArquivadosAdm ? 'Pacientes ativos' : 'Arquivados' })),
        !todos && el('button', { type: 'button', class: 'atalho', onclick: () => ir({ tela: 'drive' }) },
          el('span', { class: 'ic-bolha' }, icone('retomar')), el('span', { text: 'Google Drive' })),
        !todos && el('button', { type: 'button', class: 'atalho', onclick: () => abrirExterno(/^https:\/\//.test(perfil.nfUrl || '') ? perfil.nfUrl : 'https://www.nfse.gov.br/EmissorNacional/Login') },
          el('span', { class: 'ic-bolha' }, icone('moeda')), el('span', { text: 'Site da nota fiscal' })),
        !todos && modo === 'adm' && aparelhoComClinica && el('button', { type: 'button', class: 'atalho', onclick: entrarNaClinica },
          el('span', { class: 'ic-bolha' }, icone('cadeado')), el('span', { text: 'Área clínica' })))),
    !verArquivadosAdm && el('button', { type: 'button', class: 'fab', 'aria-label': 'Novo paciente', title: 'Novo paciente', onclick: novoPacienteAdm }, icone('mais'))
  );
  desenhar();
}

async function novoPacienteAdm() {
  const nome = await dialogo({ titulo: 'Novo paciente', campos: [{ rotulo: 'Nome' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Cadastrar', valor: true, estilo: 'primario' }] });
  if (!nome || !nome.trim()) return;
  const c = await criarCadastro({ nome: nome.trim(), valor: '' });
  if (modo === 'dono') { await sincronizarCadastros(); await salvarAgora(); }
  ir({ tela: 'adm', id: c.id, aba: 'cadastro' });
}

async function entrarNaClinica() {
  if (!(await Cofre.temClinica())) return aviso('Área clínica', 'Este aparelho não tem área clínica. As fichas e sessões ficam só no aparelho do Rodrigo.');
  const senha = await dialogo({
    titulo: 'Área clínica', texto: 'Fichas e sessões dos pacientes. Digite a senha mestra.',
    campos: [{ rotulo: 'Senha mestra', tipo: 'password', autocomplete: 'current-password' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Entrar', valor: true, estilo: 'primario' }]
  });
  if (!senha) return;
  await salvarAgora();
  try { await Cofre.abrirClinicaComSenha(senha); }
  catch { return aviso('Não foi possível entrar', 'Senha mestra incorreta.'); }
  await entrar();
}

// ---------- Paciente, na área administrativa ----------
function telaAdm(id, aba) {
  const c = cadastroDe(id);
  if (!c) { render({ tela: 'lista' }); return; }
  const chips = [];
  const hs = horariosDe(c).filter(h => h.hora);
  if (hs.length) chips.push(hs.map(h => `${DIAS[h.dia].slice(0, 3)} ${horaCurta(h.hora)}`).join(', '));
  if (valorPadrao(c)) chips.push('R$ ' + reais(valorNum(valorPadrao(c))));
  if (c.nf) chips.push('Nota fiscal'); else if (c.recibo) chips.push('Pede recibo');
  const abas = [['atendimentos', 'Agenda', 'calendario'], ['pagamentos', 'Pagamentos', 'moeda'], ['mensagem', 'Mensagem', 'mensagem'],
    ['documentos', 'Documentos', 'assinar'], ['cadastro', 'Cadastro', 'pessoa']];
  const corpo = aba === 'pagamentos' ? abaPagamentosAdm(c)
    : aba === 'mensagem' ? abaMensagem(c)
      : aba === 'documentos' ? abaDocumentosAdm(c)
        : aba === 'cadastro' ? abaCadastro(c)
          : abaAtendimentos(c);
  mostrar(
    cabecalho(c.nome, { voltar: true, status: true, acoes: [modo === 'dono' && botaoIcone('Ficha clínica', 'pessoa', () => ir({ tela: 'ficha', id: c.id, aba: 'retomar' }))] }),
    el('div', { class: 'conteudo' },
      c.arquivado && el('p', { class: 'faixa', text: 'Paciente arquivado.' }),
      el('section', { class: 'hero' }, avatar(c, true),
        el('div', { class: 'hero-texto' },
          el('h2', { id: 'nome-hero', text: c.nome }),
          el('div', { class: 'chips' }, chips.map(t => el('span', { class: 'chip', text: t }))))),
      el('nav', { class: 'abas cinco', role: 'tablist' }, abas.map(([k, rotulo, ic]) => el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(k === aba), class: 'aba' + (k === aba ? ' ativa' : ''),
        onclick: () => ir({ tela: 'adm', id, aba: k }, false)
      }, icone(ic), el('span', { text: rotulo })))),
      corpo),
    aba === 'pagamentos' && el('button', { type: 'button', class: 'fab estendido', onclick: () => { pagamentoRasc = null; ir({ tela: 'pagar', pid: c.id }); } }, icone('mais'), el('span', { text: 'Registrar pagamento' }))
  );
  app.querySelectorAll('textarea').forEach(crescer);
}

function cartaoHorarios(c) {
  const salvar = () => salvarCadastro(c);
  const caixa = el('div', { class: 'horarios' });
  const desenhar = () => {
    const hs = c.horarios || (c.horarios = []);
    caixa.replaceChildren(
      ...hs.map((h, i) => {
        if (h.hora === undefined) return null;
        if (h.inicio) { // série criada pela agenda
          const r = resumoSerie(c, h, i);
          return el('div', { class: 'pag-linha' },
            el('span', { class: 'pag-info' }, el('strong', { text: h.fim ? 'Série encerrada' : 'Série' }), el('span', { class: 'suave', text: r.texto })),
            !h.fim && el('button', { type: 'button', class: 'secundario compacto', text: 'Renovar', onclick: () => renovarSerie(c, h) }),
            botaoIcone('Remover série', 'lixeira', async () => {
              const ok = await dialogo({ titulo: 'Remover esta série?', texto: 'Os agendamentos futuros desta série somem da agenda. Atendimentos já registrados continuam.', botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Remover', valor: true, estilo: 'perigo' }] });
              if (ok) { hs.splice(i, 1); salvar(); desenhar(); }
            }));
        }
        if (h.fim && h.fim <= hojeISO()) return el('div', { class: 'pag-linha' },
          el('span', { class: 'pag-info' }, el('strong', { text: `${DIAS[h.dia]}, ${horaCurta(h.hora || '')}` }), el('span', { class: 'suave', text: `Horário encerrado em ${dataCurta(h.fim)}` })));
        return el('div', { class: 'horario-linha' },
          (() => {
            const sel = el('select', { 'aria-label': 'Dia da semana' }, [1, 2, 3, 4, 5, 6, 0].map(d => el('option', { value: String(d), text: DIAS[d] })));
            sel.value = String(h.dia);
            sel.addEventListener('change', () => { h.dia = Number(sel.value); salvar(); });
            return sel;
          })(),
          el('input', { type: 'time', value: h.hora || '', 'aria-label': 'Horário', onchange: e => { h.hora = e.target.value; salvar(); } }),
          botaoIcone('Remover horário', 'lixeira', () => { hs.splice(i, 1); salvar(); desenhar(); }));
      }),
      ...(c.avulsos || []).filter(a => a.data >= hojeISO()).sort((x, y) => x.data.localeCompare(y.data)).map(a => el('div', { class: 'pag-linha' },
        el('span', { class: 'pag-info' }, el('strong', { text: 'Sessão avulsa' }), el('span', { class: 'suave', text: `${dataComDia(a.data)}${a.hora ? ', ' + horaCurta(a.hora) : ''}` })))),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'primario com-icone', onclick: () => { agendamentoRasc = null; ir({ tela: 'agendar', id: c.id }); } }, icone('calendario'), el('span', { text: 'Agendar sessões' })),
        el('button', { type: 'button', class: 'link com-icone', onclick: () => {
          hs.push({ dia: hs.length ? hs[hs.length - 1].dia : 1, hora: '' });
          salvar(); desenhar();
        } }, icone('mais'), el('span', { text: 'Horário fixo sem data final' }))));
  };
  desenhar();
  const explicacao = el('p', { class: 'suave pequeno', text: FREQ_DICA[freqDe(c)] });
  const freq = el('select', { 'aria-label': 'Frequência' }, Object.entries(FREQUENCIAS).map(([k, v]) => el('option', { value: k, text: v })));
  freq.value = freqDe(c);
  freq.addEventListener('change', () => { c.frequencia = freq.value; salvar(); explicacao.textContent = FREQ_DICA[freq.value]; });
  return cartao('Horários e sessões agendadas', 'relogio',
    c.encerradoEm && el('p', { class: 'faixa', text: `Atendimento encerrado em ${dataCurta(c.encerradoEm)}. O paciente não aparece mais na agenda nem em "Atendendo agora"; o que ele deve continua em "Quem deve".` }),
    el('label', { class: 'campo' }, el('span', { text: 'Frequência' }), freq), explicacao, caixa,
    c.encerradoEm
      ? el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => retomarAtendimento(c) }, icone('retomar'), el('span', { text: 'Retomar atendimento' }))
      : el('button', { type: 'button', class: 'secundario perigo-texto com-icone centralizado', onclick: () => encerrarAtendimento(c) }, icone('lixeira'), el('span', { text: 'Encerrar atendimento (parou de vir)' })));
}

function abaAtendimentos(c) {
  const todos = [...atendimentosDe(c.id)].reverse();
  const lista = verTodosAtend ? todos : todos.slice(0, 15);
  return el('div', { class: 'pilha' },
    cartaoHorarios(c),
    el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => dialogoAtendimento(c, null) }, icone('mais'), el('span', { text: 'Registrar atendimento' })),
    todos.length ? cartao('Atendimentos', 'calendario',
      lista.map(a => el('button', { type: 'button', class: 'pag-linha linha-botao', onclick: () => dialogoAtendimento(c, a) },
        el('span', { class: 'pag-info' },
          el('strong', { text: `${dataCurta(a.data)}, ${diaSemana(a.data)}${a.hora ? ', ' + horaCurta(a.hora) : ''}` }),
          el('span', { class: 'suave', text: (a.presenca ? PRESENCA[a.presenca] : 'Agendado') + (a.pagamento ? ` · R$ ${reais(valorDe(a))}` : '') })),
        a.pagamento && el('span', { class: 'selo ' + a.pagamento, text: PAGAMENTO[a.pagamento] }))),
      todos.length > 15 && el('button', { type: 'button', class: 'link', text: verTodosAtend ? 'Mostrar só os recentes' : `Ver todos os ${todos.length}`, onclick: () => { verTodosAtend = !verTodosAtend; render(history.state); } }))
      : el('div', { class: 'cartao vazio-cartao' }, el('span', { class: 'ic-bolha grande' }, icone('calendario')),
        el('p', { text: 'Nenhum atendimento ainda. Marque "Veio" ou "Faltou" na agenda do dia, ou registre aqui.' })));
}

// Janela com conteúdo livre.
function janela(titulo, conteudo, botoes) {
  return new Promise(resolve => {
    const d = el('dialog', { class: 'dialogo largo-dialogo' });
    const fim = v => { d.close(); d.remove(); resolve(v); };
    d.addEventListener('cancel', e => { e.preventDefault(); fim(null); });
    d.append(el('h2', { text: titulo }), ...[conteudo].flat().filter(n => n != null && n !== false),
      el('div', { class: 'botoes' }, ...botoes.map(b => el('button', { type: 'button', class: b.estilo || 'secundario', text: b.rotulo, onclick: () => fim(b.valor) }))));
    document.body.append(d);
    d.showModal();
  });
}
function segmentoEscolha(opcoes, atual, aoMudar, extra = '') {
  const caixa = el('div', { class: 'segmento ' + extra, role: 'radiogroup' });
  const desenhar = v => caixa.replaceChildren(...Object.entries(opcoes).map(([k, rot]) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === k), class: v === k ? 'ativo ' + k : '', text: rot,
    onclick: () => { aoMudar(k); desenhar(k); }
  })));
  desenhar(atual);
  return caixa;
}

async function dialogoAtendimento(c, a) {
  const novo = !a;
  const r = a ? { ...a } : { data: hojeISO(), hora: horaFixa(c, hojeISO()), presenca: 'realizada', pagamento: 'areceber', valor: valorPadrao(c) };
  const data = el('input', { type: 'date', value: r.data, 'aria-label': 'Data' });
  const hora = el('input', { type: 'time', value: r.hora || '', 'aria-label': 'Horário' });
  const valor = el('input', { type: 'text', inputmode: 'decimal', value: r.valor ?? '', placeholder: valorPadrao(c) || '200,00', 'aria-label': 'Valor (R$)' });
  const pago = r.pagamento === 'pago';
  let pagManual = false;
  const segPag = pago ? null : segmentoEscolha({ areceber: 'A receber', naocobrar: 'Não cobrar' }, r.pagamento || 'naocobrar', k => { r.pagamento = k; pagManual = true; }, 'dois');
  const conteudo = [
    el('div', { class: 'grade duas' }, el('label', { class: 'campo' }, el('span', { text: 'Data' }), data), el('label', { class: 'campo' }, el('span', { text: 'Horário' }), hora)),
    el('p', { class: 'rotulo-campo', text: 'Presença' }),
    segmentoEscolha(PRESENCA, r.presenca, k => { r.presenca = k; if (!pago && !pagManual && segPag) { r.pagamento = pagamentoInicial(k); segPag.replaceWith(segPag2()); } }),
    el('p', { class: 'rotulo-campo', text: 'Pagamento' }),
    pago ? el('p', { class: 'faixa', text: `Pago em ${dataCurta(r.pagoEm || r.data)}. Para desfazer, exclua o pagamento na aba Pagamentos.` }) : segPag,
    el('label', { class: 'campo espaco-cima' }, el('span', { text: 'Valor (R$)' }), valor),
    a?.sid && el('p', { class: 'suave pequeno', text: 'Ligado a uma sessão registrada na área clínica.' })];
  let segAtual = segPag;
  function segPag2() { segAtual = segmentoEscolha({ areceber: 'A receber', naocobrar: 'Não cobrar' }, r.pagamento || 'naocobrar', k => { r.pagamento = k; pagManual = true; }, 'dois'); return segAtual; }
  const acao = await janela(novo ? 'Registrar atendimento' : 'Atendimento', conteudo, [
    !novo && !pago && !a.sid && { rotulo: 'Excluir', valor: 'excluir', estilo: 'secundario perigo-texto' },
    { rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: 'salvar', estilo: 'primario' }].filter(Boolean));
  if (acao === 'excluir') {
    const ok = await dialogo({ titulo: 'Excluir este atendimento?', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }] });
    if (ok) { await excluirAtendimento(a); render(history.state); }
    return;
  }
  if (acao !== 'salvar' || !data.value) return;
  const alvo = a || { id: crypto.randomUUID(), pid: c.id, criadoEm: agoraISO() };
  alvo.data = data.value; alvo.hora = hora.value; alvo.presenca = r.presenca; alvo.valor = valor.value;
  if (!pago) { alvo.pagamento = r.pagamento === 'areceber' ? 'areceber' : 'naocobrar'; alvo.pagamentoManual = pagManual || alvo.pagamentoManual; }
  if (novo) { atendimentos.push(alvo); if (alvo.pagamento === 'areceber') usarCredito(alvo); }
  salvarAt(alvo);
  render(history.state);
}

// ---------- Pagamentos ----------
const SITUACAO_MES = { pago: 'Pago', parcial: 'Parcial', areceber: 'A receber' };
function resumoMes(c, ym) {
  const ats = atendimentosDe(c.id).filter(a => a.data.slice(0, 7) === ym && (a.pagamento === 'areceber' || a.pagamento === 'pago'));
  const pendentesMes = ats.filter(a => a.pagamento === 'areceber');
  const gs = pagamentos.filter(g => g.pid === c.id && g.data.slice(0, 7) === ym);
  const pago = gs.reduce((t, g) => t + valorNum(g.valor), 0);
  const aReceber = pendentesMes.reduce((t, a) => t + valorDe(a), 0);
  const anteriores = atendimentosDe(c.id).filter(a => a.pagamento === 'areceber' && a.data.slice(0, 7) < ym).reduce((t, a) => t + valorDe(a), 0);
  const status = !ats.length && !pago ? null : !pendentesMes.length ? 'pago' : pago > 0 || ats.some(a => a.pagamento === 'pago') ? 'parcial' : 'areceber';
  const nfPendente = !!c.nf && gs.some(g => !g.nf?.emitida);
  return { ats, pendentesMes, gs, pago, aReceber, anteriores, status, nfPendente };
}
function totaisMes(ym) {
  const t = { recebido: 0, aReceber: 0, anteriores: 0 };
  for (const c of cadastros) {
    const r = resumoMes(c, ym);
    t.recebido += r.pago; t.aReceber += r.aReceber; t.anteriores += r.anteriores;
  }
  return t;
}

let filtroMes = 'todos';
let abaMes = 'resumo';
const ABAS_MES = { fechamento: 'Fechamento', resumo: 'Resumo', devendo: 'Quem deve', lista: 'Lista do mês', mensais: 'Mensais', recibos: 'Recibos' };
const pedeRecibo = c => !c.arquivado && !!(c.recibo || c.nf);
function telaMes(ym) {
  if (abaMes !== 'resumo') return telaMesAba(ym);
  const linhas = [];
  let recebido = 0, aReceber = 0, anteriores = 0, qtdPagos = 0;
  for (const c of [...cadastros].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
    const r = resumoMes(c, ym);
    recebido += r.pago; aReceber += r.aReceber; anteriores += r.anteriores;
    if (!r.status) continue;
    if (r.status === 'pago') qtdPagos++;
    if (filtroMes === 'pagos' && r.status !== 'pago') continue;
    if (filtroMes === 'areceber' && r.status === 'pago') continue;
    if (filtroMes === 'nota' && !r.nfPendente) continue;
    linhas.push(el('button', { type: 'button', class: 'cartao paciente', onclick: () => ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }) },
      avatar(c),
      el('span', { class: 'info' },
        el('span', { class: 'nome', text: c.nome }),
        el('span', { class: 'meta' },
          el('span', { class: 'selo ' + r.status, text: SITUACAO_MES[r.status] }),
          r.aReceber > 0 && el('span', { text: `falta R$ ${reais(r.aReceber)}` }),
          r.nfPendente && el('span', { class: 'selo nota', text: 'Nota pendente' }))),
      el('strong', { class: 'valor-lista', text: r.pago ? 'R$ ' + reais(r.pago) : '—' })));
  }
  const filtro = (k, rot) => el('button', { type: 'button', class: 'chip acao' + (filtroMes === k ? ' marcado' : ''), text: rot, onclick: () => { filtroMes = k; telaMes(ym); } });
  mostrar(
    cabecalho('Pagamentos', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      segmentoAbasMes(ym),
      el('div', { class: 'navega' },
        el('button', { type: 'button', class: 'secundario compacto com-icone', onclick: () => ir({ tela: 'mes', ym: somarMeses(ym, -1) }, false) }, icone('voltar'), el('span', { text: 'Anterior' })),
        el('strong', { text: nomeMes(ym) }),
        el('button', { type: 'button', class: 'secundario compacto com-icone', disabled: ym >= hojeISO().slice(0, 7), onclick: () => ir({ tela: 'mes', ym: somarMeses(ym, 1) }, false) }, el('span', { text: 'Seguinte' }), icone('seguinte'))),
      el('div', { class: 'cartao destaque total-clinica' },
        el('small', { text: 'Total recebido pela clínica' }),
        el('strong', { text: 'R$ ' + reais(recebido) }),
        el('span', { text: `${qtdPagos} ${qtdPagos === 1 ? 'paciente em dia' : 'pacientes em dia'} neste mês` })),
      el('div', { class: 'resumo-fin' },
        el('div', { class: 'cartao numero' }, el('small', { text: 'A receber neste mês' }), el('strong', { text: 'R$ ' + reais(aReceber) })),
        el('div', { class: 'cartao numero' }, el('small', { text: 'De meses anteriores' }), el('strong', { text: 'R$ ' + reais(anteriores) }))),
      el('div', { class: 'chips' }, filtro('todos', 'Todos'), filtro('pagos', 'Pagos'), filtro('areceber', 'A receber'), filtro('nota', 'Nota pendente')),
      linhas.length ? linhas : el('div', { class: 'cartao vazio-cartao' }, el('span', { class: 'ic-bolha grande' }, icone('moeda')), el('p', { text: 'Nenhum paciente nesta lista.' }))),
    el('button', { type: 'button', class: 'fab estendido', onclick: () => { pagamentoRasc = null; ir({ tela: 'pagar' }); } }, icone('mais'), el('span', { text: 'Registrar pagamento' })));
}

function abaPagamentosAdm(c) {
  const hoje = hojeISO(), ym = hoje.slice(0, 7);
  const pend = atendimentosDe(c.id).filter(a => a.pagamento === 'areceber').reverse();
  const totalPend = pend.reduce((t, a) => t + valorDe(a), 0);
  const r = resumoMes(c, ym);
  const gs = pagamentosDe(c.id);
  return el('div', { class: 'pilha' },
    el('div', { class: 'resumo-fin' },
      el('div', { class: 'cartao numero' }, el('small', { text: 'A receber' }), el('strong', { text: 'R$ ' + reais(totalPend) }), el('span', { class: 'suave pequeno', text: `${pend.length} ${pend.length === 1 ? 'atendimento' : 'atendimentos'}` })),
      el('div', { class: 'cartao numero' }, el('small', { text: 'Recebido este mês' }), el('strong', { text: 'R$ ' + reais(r.pago) }), el('span', { class: 'suave pequeno', text: `${r.gs.length} ${r.gs.length === 1 ? 'pagamento' : 'pagamentos'}` }))),
    el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => escolherRecibo(c, { soPagas: true }) }, icone('assinar'), el('span', { text: 'Recibo ou nota fiscal' })),
    c.nf && r.nfPendente && el('p', { class: 'faixa', text: 'Há pagamento deste mês sem nota fiscal emitida. Toque no pagamento para emitir.' }),
    cartao('Consultas ainda não pagas', 'moeda',
      pend.length ? Object.entries(pend.reduce((m, a) => ((m[a.data.slice(0, 7)] ||= []).push(a), m), {})).sort((x, y) => y[0].localeCompare(x[0])).map(([mes, lista]) =>
        el('div', { class: 'pilha-pequena' },
          el('div', { class: 'mes-titulo' }, el('strong', { text: nomeMes(mes) }), el('span', { class: 'suave', text: `${lista.length} ${lista.length === 1 ? 'consulta' : 'consultas'} · R$ ${reais(lista.reduce((t, a) => t + valorDe(a), 0))}` })),
          ...lista.sort((x, y) => x.data.localeCompare(y.data)).map(a => el('div', { class: 'pag-linha' },
            el('span', { class: 'pag-info' }, el('strong', { text: `${dataCurta(a.data)}, ${diaSemana(a.data)}` }),
              el('span', { class: 'suave', text: `R$ ${reais(valorDe(a))}${a.presenca === 'falta' ? ' (faltou: cobrada)' : a.presenca === 'tardia' ? ' (desmarcou em cima da hora: cobrada)' : ''}` })),
            el('button', { type: 'button', class: 'chip acao marcado', text: 'Pagou', onclick: () => pagarSessao(c, a) })))))
        : el('p', { class: 'suave', text: 'Nada pendente. 🎉' })),
    cartao('Pagamentos recebidos', 'sessoes',
      gs.length ? gs.slice(0, 24).map(g => el('button', { type: 'button', class: 'pag-linha linha-botao', onclick: () => dialogoPagamento(c, g) },
        el('span', { class: 'pag-info' }, el('strong', { text: `R$ ${reais(valorNum(g.valor))}` }),
          el('span', { class: 'suave', text: `${dataCurta(g.data)} · ${g.atendimentos?.length || 0} ${g.atendimentos?.length === 1 ? 'atendimento' : 'atendimentos'}${g.comprovanteId ? ' · com comprovante' : ''}` })),
        (c.nf || g.nf?.emitida) && el('span', { class: 'selo ' + (g.nf?.emitida ? 'pago' : 'nota'), text: g.nf?.emitida ? 'Nota emitida' : 'Nota pendente' }))) : el('p', { class: 'suave', text: 'Nenhum pagamento registrado.' })),
    el('p', { class: 'suave pequeno', text: 'Sessões em que o paciente veio, faltou ou desmarcou com menos de 24h entram como "a receber" com o valor do cadastro. Toque em "Pagou" quando o paciente pagar. O Rodrigo pode abonar uma sessão.' }));
}

async function registrarPagamento(c, { valor, data, ids, arquivo }) {
  const agora = agoraISO();
  const g = { id: crypto.randomUUID(), pid: c.id, data, valor: valorNum(valor), atendimentos: ids, comprovanteId: null, nf: { emitida: false, numero: '' }, criadoEm: agora, atualizadoEm: agora };
  if (arquivo) {
    const d = await guardarDocumento(c, 'comprovante', { nome: arquivo.nome, mime: arquivo.mime, bytes: arquivo.bytes, descricao: `Comprovante de R$ ${reais(g.valor)}`, data, adm: true });
    g.comprovanteId = d.id;
  }
  for (const a of atendimentos.filter(x => ids.includes(x.id))) { a.pagamento = 'pago'; a.pagoEm = data; a.pagamentoId = g.id; a.pagamentoManual = true; salvarAt(a); }
  pagamentos.push(g);
  salvarPag(g);
  await salvarAgora();
  return g;
}
async function excluirPagamento(g) {
  for (const a of atendimentos.filter(x => x.pagamentoId === g.id)) {
    a.pagamento = a.presenca === 'realizada' || !a.presenca ? 'areceber' : 'naocobrar'; a.pagoEm = null; a.pagamentoId = null; salvarAt(a);
  }
  const d = documentos.find(x => x.id === g.comprovanteId);
  if (d) { await Cofre.apagar(chaveDoc(d)); await Cofre.apagar(chaveConteudo(d)); documentos = documentos.filter(x => x !== d); }
  pagamentos = pagamentos.filter(x => x !== g);
  pendentes.delete(chavePag(g));
  const l = { id: g.id, pid: g.pid, excluido: true, atualizadoEm: agoraISO() };
  lapides.set(chavePag(g), l);
  await Cofre.salvar(chavePag(g), l);
  await salvarAgora();
}
function desligarComprovante(d) {
  for (const g of pagamentos.filter(x => x.comprovanteId === d.id)) { g.comprovanteId = null; salvarPag(g); }
}

async function dialogoPagamento(c, g) {
  const ats = atendimentos.filter(a => (g.atendimentos || []).includes(a.id)).sort((a, b) => a.data.localeCompare(b.data));
  const doc = documentos.find(d => d.id === g.comprovanteId);
  g.nf ||= { emitida: false, numero: '' };
  const notaDoc = g.nf.docId && documentos.find(d => d.id === g.nf.docId);
  const numero = el('input', { type: 'text', value: g.nf.numero || '', placeholder: 'Número da nota (opcional)', 'aria-label': 'Número da nota', oninput: e => { g.nf.numero = e.target.value; salvarPag(g); } });
  const conteudo = [
    el('p', { text: `${dataCurta(g.data)} · R$ ${reais(valorNum(g.valor))}` }),
    el('p', { class: 'suave pequeno', text: ats.length ? 'Atendimentos: ' + listaNatural(ats.map(a => dataCurta(a.data))) + '.' : 'Sem atendimento ligado (pagamento adiantado ou avulso).' }),
    saldoDe(g) > 0.005 && el('p', { class: 'faixa', text: `Saldo de R$ ${reais(saldoDe(g))}: os próximos atendimentos com presença serão abatidos daqui.` }),
    el('div', { class: 'botoes-linha' },
      doc ? el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => { fecharDialogos(); abrirDocumento(c, doc); } }, icone('clipe'), el('span', { text: 'Ver comprovante' }))
        : el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: async () => { fecharDialogos(); await anexarComprovante(c, g); } }, icone('clipe'), el('span', { text: 'Anexar comprovante' })),
      notaDoc ? el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => { fecharDialogos(); abrirDocumento(c, notaDoc); } }, icone('arquivo'), el('span', { text: 'Ver nota' }))
        : el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => { fecharDialogos(); abrirNotaFiscal(c, g); } }, icone('arquivo'), el('span', { text: 'Emitir nota fiscal' }))),
    !notaDoc && el('button', { type: 'button', class: 'link', text: 'Anexar PDF ou XML da nota', onclick: () => { fecharDialogos(); anexarNota(c, g); } }),
    notaDoc && el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => { fecharDialogos(); enviarNotaWhatsApp(c, notaDoc, g); } }, icone('mensagem'), el('span', { text: `Enviar nota para ${primeiroNome(c.nome)} pelo WhatsApp` })),
    el('label', { class: 'marcar espaco-cima' },
      el('input', { type: 'checkbox', checked: !!g.nf.emitida, onchange: e => { g.nf.emitida = e.target.checked; salvarPag(g); } }),
      el('span', { text: 'Nota fiscal emitida' })),
    numero];
  const acao = await janela('Pagamento', conteudo, [
    { rotulo: 'Excluir', valor: 'excluir', estilo: 'secundario perigo-texto' },
    { rotulo: 'Fechar', valor: null, estilo: 'primario' }]);
  if (acao === 'excluir') {
    const ok = await dialogo({ titulo: 'Excluir este pagamento?', texto: 'Os atendimentos voltam a ficar "a receber" e o comprovante é apagado.', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Excluir', valor: true, estilo: 'perigo' }] });
    if (ok) await excluirPagamento(g);
  }
  await salvarAgora();
  if (Cofre.aberto()) render(history.state);
}

async function lerArquivoComprovante(f) {
  let bytes = new Uint8Array(await f.arrayBuffer());
  let mime = f.type || 'application/octet-stream';
  let nome = f.name || 'comprovante';
  if (/^image\/(jpeg|png|webp|heic|heif)/.test(mime) && bytes.length > 1.5 * 1048576) {
    const menor = await reduzirImagem(new Blob([bytes], { type: mime }));
    if (menor && menor.length < bytes.length) { bytes = menor; mime = 'image/jpeg'; nome = nome.replace(/\.\w+$/, '') + '.jpg'; }
  }
  return { nome, mime, bytes };
}
async function anexarComprovante(c, g) {
  const [f] = await escolherArquivos({ accept: 'image/*,application/pdf,.pdf' });
  if (!f) return;
  const arq = await lerArquivoComprovante(f);
  const d = await guardarDocumento(c, 'comprovante', { ...arq, descricao: `Comprovante de R$ ${reais(valorNum(g.valor))}`, data: g.data, adm: true });
  g.comprovanteId = d.id; salvarPag(g); await salvarAgora();
  render(history.state);
}

// ---------- Registrar pagamento (com ou sem comprovante recebido) ----------
async function telaPagar(s) {
  if (!pagamentoRasc || pagamentoRasc.eid !== (s.eid || null) || (s.pid && pagamentoRasc.pid !== s.pid && !pagamentoRasc.pidEscolhido)) {
    pagamentoRasc = { eid: s.eid || null, pid: s.pid || null, ids: null, valor: '', valorEditado: false, data: hojeISO(), arquivo: null, carregando: !!s.eid };
    if (s.eid) {
      try {
        const item = (await Cofre.listarEntrada()).find(i => i.id === s.eid);
        if (!item) { pagamentoRasc = null; entradaIds = entradaIds.filter(i => i !== s.eid); history.back(); return; }
        const bytes = await Cofre.lerEntrada(item);
        if (!s.comoComprovante && (/xml/.test(item.mime) || /\.xml$/i.test(item.nome) || /nfs-?e|nota/i.test(item.nome))) { pagamentoRasc = null; ir({ tela: 'notaRecebida', eid: s.eid }, false); return; }
        const arq = await lerArquivoComprovante(new File([bytes], item.nome, { type: item.mime }));
        pagamentoRasc.arquivo = arq; pagamentoRasc.recebidoEm = item.recebidoEm;
      } catch { pagamentoRasc.erro = true; }
      pagamentoRasc.carregando = false;
    }
  }
  const r = pagamentoRasc;
  if (!Cofre.aberto()) return;
  const ativos = cadastros.filter(c => !c.arquivado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const c = cadastroDe(r.pid);
  const pend = c ? atendimentosDe(c.id).filter(a => a.pagamento === 'areceber') : [];
  if (c && r.ids === null) r.ids = new Set(pend.map(a => a.id));
  const soma = () => pend.filter(a => r.ids.has(a.id)).reduce((t, a) => t + valorDe(a), 0);
  if (c && !r.valorEditado) r.valor = soma() ? reais(soma()) : (valorPadrao(c) || '');

  const previa = el('div', { class: 'visualizador' });
  if (r.erro) previa.append(el('p', { class: 'erro-msg', text: 'Não foi possível abrir o arquivo recebido.' }));
  else if (r.arquivo?.mime.startsWith('image/')) { const cv = el('canvas', { class: 'imagem-doc', 'aria-label': 'Comprovante' }); previa.append(cv); desenharImagem(cv, r.arquivo.bytes, r.arquivo.mime, 900).catch(() => { }); }
  else if (r.arquivo) previa.append(el('p', { class: 'suave', text: `${r.arquivo.nome}, ${tamanhoLegivel(r.arquivo.bytes.length)}` }));
  else previa.append(el('p', { class: 'suave', text: 'Sem comprovante. É opcional.' }));

  const sel = el('select', { 'aria-label': 'Paciente' }, el('option', { value: '', text: 'Escolha o paciente' }), ativos.map(x => el('option', { value: x.id, text: x.nome })));
  sel.value = r.pid || '';
  sel.addEventListener('change', () => { r.pid = sel.value || null; r.pidEscolhido = true; r.ids = null; r.valorEditado = false; telaPagar({ ...history.state }); });
  const valor = el('input', { type: 'text', inputmode: 'decimal', value: r.valor, 'aria-label': 'Valor recebido (R$)', oninput: e => { r.valor = e.target.value; r.valorEditado = true; } });
  const data = el('input', { type: 'date', value: r.data, 'aria-label': 'Data do pagamento', onchange: e => { if (e.target.value) r.data = e.target.value; } });

  const restantes = entradaIds.filter(i => i !== r.eid).length;
  mostrar(
    cabecalho('Registrar pagamento', { voltar: true, sub: r.eid && restantes ? `mais ${restantes} na fila` : null }),
    el('div', { class: 'conteudo pilha' },
      cartao(r.eid ? 'Comprovante recebido' : 'Comprovante', 'clipe', previa,
        !r.eid && el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: async () => {
          const [f] = await escolherArquivos({ accept: 'image/*,application/pdf,.pdf' });
          if (f) { r.arquivo = await lerArquivoComprovante(f); telaPagar({ ...history.state }); }
        } }, icone('clipe'), el('span', { text: r.arquivo ? 'Trocar arquivo' : 'Anexar foto ou PDF' })),
        r.eid && r.arquivo?.mime === 'application/pdf' && el('button', { type: 'button', class: 'link', text: 'É uma nota fiscal emitida', onclick: () => { pagamentoRasc = null; ir({ tela: 'notaRecebida', eid: r.eid }, false); } }),
        r.eid && el('button', { type: 'button', class: 'link perigo-texto', text: 'Descartar este arquivo', onclick: descartarEntrada })),
      cartao('De quem é', 'pessoa', sel),
      c && cartao('O que está sendo pago', 'calendario',
        pend.length ? el('div', { class: 'lista-marcar' }, pend.map(a => el('label', { class: 'marcar' },
          el('input', { type: 'checkbox', checked: r.ids.has(a.id), onchange: e => { if (e.target.checked) r.ids.add(a.id); else r.ids.delete(a.id); r.valorEditado = false; telaPagar({ ...history.state }); } }),
          el('span', { text: `${dataCurta(a.data)}, ${diaSemana(a.data)} · R$ ${reais(valorDe(a))}` }))))
          : el('p', { class: 'suave pequeno', text: 'Nenhum atendimento a receber. O pagamento fica registrado como adiantado.' })),
      c && cartao('Valor e data', 'moeda',
        el('div', { class: 'grade duas' }, el('label', { class: 'campo' }, el('span', { text: 'Valor (R$)' }), valor), el('label', { class: 'campo' }, el('span', { text: 'Data' }), data))),
      el('p', { class: 'suave pequeno', text: 'O app não lê o valor escrito no comprovante: confira e ajuste o valor acima. O comprovante fica guardado cifrado, junto do pagamento.' })),
    el('button', { type: 'button', class: 'fab estendido', disabled: !c, onclick: concluirPagamento }, icone('moeda'), el('span', { text: 'Registrar' })));
}
async function concluirPagamento() {
  const r = pagamentoRasc;
  const c = cadastroDe(r.pid);
  if (!c) return;
  if (!valorNum(r.valor)) return aviso('Falta o valor', 'Informe o valor recebido.');
  const g = await registrarPagamento(c, { valor: r.valor, data: r.data, ids: [...(r.ids || [])], arquivo: r.erro ? null : r.arquivo });
  if (r.eid) { await Cofre.apagarEntrada(r.eid); entradaIds = entradaIds.filter(i => i !== r.eid); }
  pagamentoRasc = null;
  indicarStatus('Salvo');
  if (entradaIds.length) { ir({ tela: 'pagar', eid: entradaIds[0] }, false); return; }
  const querNota = c.nf && await dialogo({ titulo: 'Pagamento registrado', texto: `${c.nome} recebe nota fiscal. Emitir agora?`, botoes: [{ rotulo: 'Depois', valor: null }, { rotulo: 'Emitir nota', valor: true, estilo: 'primario' }] });
  ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }, false);
  if (querNota) abrirNotaFiscal(c, g);
}
async function descartarEntrada() {
  const r = pagamentoRasc;
  const ok = await dialogo({ titulo: 'Descartar este arquivo?', texto: 'Ele é apagado deste app. O original continua no WhatsApp.', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Descartar', valor: true, estilo: 'perigo' }] });
  if (!ok) return;
  await Cofre.apagarEntrada(r.eid);
  entradaIds = entradaIds.filter(i => i !== r.eid);
  pagamentoRasc = null;
  if (entradaIds.length) ir({ tela: 'pagar', eid: entradaIds[0] }, false); else history.back();
}

// ---------- Nota fiscal: o app prepara os dados e abre o site; a emissão é feita no site ----------
async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); botao.textContent = 'Copiado'; setTimeout(() => { botao.textContent = 'Copiar'; }, 1800); }
  catch { botao.textContent = 'Selecione e copie'; }
}
function descricaoNota(c, g) {
  const ats = atendimentos.filter(a => (g.atendimentos || []).includes(a.id)).sort((a, b) => a.data.localeCompare(b.data));
  const datas = ats.length ? listaNatural(ats.map(a => dataCurta(a.data))) : dataCurta(g.data);
  return (perfil.nfDescricao || '').replaceAll('{datas}', datas).replaceAll('{nome}', c.nome).replaceAll('{mes}', nomeMes(g.data.slice(0, 7)).toLowerCase());
}
// Versão 56: "Recibo" oferece os dois jeitos — recibo feito no aplicativo ou nota fiscal no site do governo (Emissor Nacional).
async function escolherRecibo(c, opcoes = {}) {
  const r = await janela('Recibo', [el('p', { text: c.nome }),
    el('p', { class: 'suave pequeno', text: 'Recibo do aplicativo: sai em PDF com seu logo e dados, pronto para enviar. Nota fiscal: abre o site do governo; depois de emitir, anexe a nota e envie ao paciente pelo WhatsApp.' })],
    [{ rotulo: 'Fechar', valor: null }, { rotulo: '🏛️ Nota fiscal (site)', valor: 'nota' }, { rotulo: '📄 Recibo do aplicativo', valor: 'recibo', estilo: 'primario' }]);
  if (r === 'recibo') return novaDeclaracao(c, { modelo: 'recibo', soPagas: !!opcoes.soPagas, de: opcoes.de, ate: opcoes.ate });
  if (r !== 'nota') return;
  const gs = pagamentosDe(c.id).filter(g => !opcoes.de || (g.data >= opcoes.de && g.data <= opcoes.ate));
  const semNota = gs.filter(g => !g.nf?.emitida);
  const candidatos = (semNota.length ? semNota : gs).slice(0, 5);
  if (candidatos.length === 1) return abrirNotaFiscal(c, candidatos[0]);
  if (!candidatos.length) {   // nenhum pagamento registrado: só abre o site e depois oferece guardar a nota
    abrirExterno(/^https:\/\//.test(perfil.nfUrl || '') ? perfil.nfUrl : 'https://www.nfse.gov.br/EmissorNacional/Login');
    setTimeout(async () => {
      if (!Cofre.aberto()) return;
      const q = await janela('Nota emitida?', [el('p', { text: 'Se já emitiu, anexe o PDF da nota: ela fica guardada e dá para enviar ao paciente.' })],
        [{ rotulo: 'Agora não', valor: null }, { rotulo: 'Anexar a nota', valor: true, estilo: 'primario' }]);
      if (q) anexarNota(c, null);
    }, 1500);
    return;
  }
  const g = await janela('Nota de qual pagamento?', [el('p', { class: 'suave pequeno', text: semNota.length ? 'Pagamentos ainda sem nota fiscal:' : 'Todos já têm nota. Escolha um para emitir de novo:' })],
    [{ rotulo: 'Fechar', valor: null }, ...candidatos.map(x => ({ rotulo: `${dataCurta(x.data)} · R$ ${reais(valorNum(x.valor))}`, valor: x }))]);
  if (g) abrirNotaFiscal(c, g);
}
async function abrirNotaFiscal(c, g) {
  const tomador = (c.pagador || '').trim() || c.nome;
  const cpf = (c.cpfPagador || '').trim() || (c.cpf || '').trim();
  const ats = atendimentos.filter(a => (g.atendimentos || []).includes(a.id)).sort((a, b) => a.data.localeCompare(b.data));
  const competencia = dataCurta(ats.length ? ats[ats.length - 1].data : g.data);
  const itens = [['Data de competência', competencia], ['CPF do tomador', cpf], ['Nome do tomador', tomador], ['Descrição do serviço', descricaoNota(c, g)], ['Valor do serviço', reais(valorNum(g.valor))]];
  const conteudo = [
    el('p', { class: 'suave pequeno', text: 'Na ordem em que o Emissor Nacional pede. Copie cada dado e cole no site, depois de entrar pelo gov.br.' }),
    ...itens.map(([rot, val]) => {
      const b = el('button', { type: 'button', class: 'secundario compacto', text: 'Copiar' });
      b.addEventListener('click', () => copiar(val, b));
      return el('div', { class: 'linha-copiar' }, el('div', { class: 'linha-texto' }, el('small', { class: 'suave', text: rot }), el('p', { text: val || '(vazio no cadastro)' })), b);
    }),
    !cpf && el('p', { class: 'faixa', text: 'Falta o CPF no cadastro do paciente.' }),
    el('p', { class: 'suave pequeno', text: 'Depois de emitir, baixe o PDF ou o XML da nota e compartilhe com o Consultório: ele liga a nota a este pagamento.' })];
  const acao = await janela('Nota fiscal', conteudo, [
    { rotulo: 'Fechar', valor: null },
    { rotulo: 'Anexar a nota', valor: 'anexar' },
    { rotulo: 'Abrir o site', valor: 'site', estilo: 'primario' }]);
  if (acao === 'site') {
    if (!/^https:\/\//.test(perfil.nfUrl || '')) return aviso('Site não definido', 'Defina o endereço do site da nota em Configurações.');
    abrirExterno(perfil.nfUrl);
    setTimeout(() => { if (Cofre.aberto()) perguntarNotaEmitida(g); }, 1500);
  } else if (acao === 'anexar') await anexarNota(c, g);
}
async function perguntarNotaEmitida(g, direto = false) {
  const n = await dialogo({
    titulo: direto ? 'Nota emitida' : 'Depois de emitir no site',
    texto: 'Anote o número da nota e confirme. Se baixar o PDF ou o XML, compartilhe com o Consultório para guardar a nota junto do pagamento.',
    campos: [{ rotulo: 'Número da nota (opcional)' }],
    botoes: [{ rotulo: 'Ainda não', valor: null }, { rotulo: 'Marcar como emitida', valor: true, estilo: 'primario' }]
  });
  if (n === null) return;
  g.nf = { emitida: true, numero: (n || '').trim(), em: hojeISO() };
  salvarPag(g); await salvarAgora();
  render(history.state);
}

// ---------- Nota emitida de volta para o app (PDF ou XML baixado do Emissor Nacional) ----------
// Tudo é lido aqui dentro do aparelho. O XML traz os dados exatos; do PDF o app tenta ler o texto e pede conferência.
let notaRasc = null;
const ehXml = arq => /xml/.test(arq?.mime || '') || /\.xml$/i.test(arq?.nome || '');
async function inflar(bytes) {
  // Lê o que der: alguns PDFs deixam bytes sobrando depois do fim do trecho comprimido.
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter(); w.write(bytes).catch(() => { }); w.close().catch(() => { });
  const leitor = ds.readable.getReader(), pedacos = [];
  try { for (;;) { const { done, value } = await leitor.read(); if (done) break; pedacos.push(value); } } catch { }
  const total = pedacos.reduce((t, x) => t + x.length, 0), out = new Uint8Array(total);
  let i = 0; for (const x of pedacos) { out.set(x, i); i += x.length; }
  return out;
}
const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
function textoDeConteudo(c) {
  const partes = [];
  const lit = s => s.replace(/\\([nrtbf()\\])/g, (_, x) => ({ n: '\n', r: '', t: ' ', b: '', f: '' }[x] ?? x)).replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  const re = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(T\*|ET|Td|TD)/g;
  let m;
  while ((m = re.exec(c))) {
    if (m[1] != null) partes.push((m[1].match(/\(((?:\\.|[^\\)])*)\)/g) || []).map(x => lit(x.slice(1, -1))).join(''));
    else if (m[2] != null) partes.push(lit(m[2]));
    else partes.push(m[3] === 'Td' || m[3] === 'TD' ? ' ' : '\n');
  }
  return partes.join('');
}
async function textoDoPdf(bytes) {
  const bruto = latin1(bytes);
  let texto = '';
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(bruto))) {
    const ini = m.index + m[0].length, fim = bruto.indexOf('endstream', ini);
    if (fim < 0) break;
    let f = fim; while (f > ini && (bytes[f - 1] === 10 || bytes[f - 1] === 13)) f--;
    let dados = bytes.subarray(ini, f);
    try { if (/FlateDecode/.test(m[1])) dados = await inflar(dados); else if (/Filter/.test(m[1])) continue; } catch { continue; }
    const c = latin1(dados);
    if (/\b(Tj|TJ)\b/.test(c)) texto += textoDeConteudo(c) + '\n';
  }
  return texto;
}
function dadosDoXml(bytes) {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  const tag = (nome, raiz = doc) => raiz.getElementsByTagNameNS('*', nome)[0]?.textContent?.trim() || '';
  const toma = doc.getElementsByTagNameNS('*', 'toma')[0];
  const quando = tag('dhProc') || tag('dhEmi') || tag('dCompet');
  return { numero: tag('nNFSe') || tag('nDPS'), data: quando.slice(0, 10), valor: tag('vServ') || tag('vLiq'),
    cpf: toma ? (tag('CPF', toma) || tag('CNPJ', toma)) : '', nome: toma ? tag('xNome', toma) : '', lido: !!(tag('nNFSe') || tag('vServ')) };
}
function dadosDoTexto(t) {
  const plano = t.replace(/[ \t]+/g, ' ');
  const numero = plano.match(/N[úu]mero da NFS-?e\s*[:\-]?\s*\n?\s*(\d{1,15})/i)?.[1] || '';
  const d = plano.match(/(?:Data e Hora da emiss[ãa]o da NFS-?e|Emiss[ãa]o)[^\d]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i) || plano.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const valor = plano.match(/Valor (?:do Servi[çc]o|L[íi]quido(?: da NFS-?e)?)[^\d]{0,30}([\d.]+,\d{2})/i)?.[1] || '';
  const meu = soDigitos(perfil?.cpf);
  const cpf = (plano.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/g) || []).map(soDigitos).find(x => x !== meu) || '';
  return { numero, data: d ? `${d[3]}-${d[2]}-${d[1]}` : '', valor: valor.replace(/\./g, '').replace(',', '.'), cpf, nome: '', lido: !!(numero || valor) };
}
async function lerDadosNota(arq) {
  try { return ehXml(arq) ? dadosDoXml(arq.bytes) : await dadosDoPdf(arq); } catch { return { numero: '', data: '', valor: '', cpf: '', nome: '', lido: false }; }
}
async function dadosDoPdf(arq) { return dadosDoTexto(await textoDoPdf(arq.bytes)); }
function pacientePorCpf(cpf) {
  const d = soDigitos(cpf);
  if (d.length < 11) return null;
  return cadastros.find(c => soDigitos(c.cpf) === d || soDigitos(c.cpfPagador) === d) || null;
}
const semNota = c => pagamentosDe(c.id).filter(g => !g.nf?.emitida);
function pagamentoProvavel(c, valor) {
  const gs = semNota(c);
  const v = Number(valor) || 0;
  return (v && gs.find(g => Math.abs(valorNum(g.valor) - v) < 0.01)) || gs[0] || null;
}
async function guardarNota(c, g, arq, dados) {
  const numero = (dados.numero || '').trim();
  const outro = numero && pagamentos.find(x => x !== g && x.nf?.numero === numero);
  if (outro) {
    const co = cadastroDe(outro.pid);
    const ok = await dialogo({ titulo: 'Nota já registrada', texto: `A nota ${numero} já está ligada a um pagamento de ${co?.nome || 'outro paciente'} em ${dataCurta(outro.data)}. Guardar mesmo assim?`,
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Guardar', valor: true, estilo: 'primario' }] });
    if (!ok) return null;
  }
  const d = await guardarDocumento(c, 'nota', { ...arq, descricao: `Nota fiscal${numero ? ' ' + numero : ''}${dados.valor ? ' · R$ ' + reais(Number(dados.valor)) : ''}`, data: dados.data || hojeISO(), adm: true });
  if (g) { g.nf = { emitida: true, numero, em: dados.data || hojeISO(), docId: d.id }; salvarPag(g); }
  await salvarAgora();
  return d;
}
async function anexarNota(c, g) {
  const [f] = await escolherArquivos({ accept: 'application/pdf,.pdf,text/xml,application/xml,.xml' });
  if (!f) return;
  const arq = { nome: f.name || 'nota', mime: f.type || (/\.xml$/i.test(f.name) ? 'text/xml' : 'application/pdf'), bytes: new Uint8Array(await f.arrayBuffer()) };
  notaRasc = { eid: null, arq, pid: c.id, gid: g?.id || null };
  notaRasc.dados = await lerDadosNota(arq);
  ir({ tela: 'notaRecebida' });
}
async function telaNotaRecebida(s) {
  if (s.eid && (!notaRasc || notaRasc.eid !== s.eid)) {
    try {
      const item = (await Cofre.listarEntrada()).find(i => i.id === s.eid);
      if (!item) { history.back(); return; }
      const bytes = await Cofre.lerEntrada(item);
      const arq = { nome: item.nome, mime: item.mime, bytes };
      const dados = await lerDadosNota(arq);
      const c = pacientePorCpf(dados.cpf);
      notaRasc = { eid: s.eid, arq, dados, pid: c?.id || null, gid: null };
    } catch { notaRasc = null; await aviso('Não foi possível abrir', 'O arquivo recebido não pôde ser lido.'); history.back(); return; }
  }
  const r = notaRasc;
  if (!r || !Cofre.aberto()) { history.back(); return; }
  const c = cadastroDe(r.pid);
  if (c && !r.gid) r.gid = pagamentoProvavel(c, r.dados.valor)?.id || '';
  const ativos = cadastros.filter(x => !x.arquivado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const sel = el('select', { 'aria-label': 'Paciente' }, el('option', { value: '', text: 'Escolha o paciente' }), ativos.map(x => el('option', { value: x.id, text: x.nome })));
  sel.value = r.pid || '';
  sel.addEventListener('change', () => { r.pid = sel.value || null; r.gid = null; telaNotaRecebida({ ...history.state }); });
  const campo = (rot, chave, tipo = 'text', extra = {}) => el('label', { class: 'campo' }, el('span', { text: rot }),
    el('input', { type: tipo, value: r.dados[chave] || '', ...extra, oninput: e => { r.dados[chave] = e.target.value; } }));
  const gs = c ? semNota(c) : [];
  const escolha = c && el('div', { class: 'lista-marcar' },
    gs.map(g => el('label', { class: 'marcar' },
      el('input', { type: 'radio', name: 'pag-nota', checked: r.gid === g.id, onchange: () => { r.gid = g.id; } }),
      el('span', { text: `${dataCurta(g.data)} · R$ ${reais(valorNum(g.valor))}` }))),
    el('label', { class: 'marcar' },
      el('input', { type: 'radio', name: 'pag-nota', checked: r.gid === '', onchange: () => { r.gid = ''; } }),
      el('span', { text: gs.length ? 'Nenhum destes (só guardar a nota)' : 'Sem pagamento aberto: só guardar a nota' })));
  mostrar(
    cabecalho('Nota fiscal recebida', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      cartao('Arquivo', 'arquivo', el('p', { class: 'suave', text: `${r.arq.nome}, ${tamanhoLegivel(r.arq.bytes.length)}` }),
        el('p', { class: r.dados.lido ? 'suave pequeno' : 'faixa', text: r.dados.lido ? (ehXml(r.arq) ? 'Dados lidos do XML da nota.' : 'Dados lidos do PDF. Confira antes de guardar.') : 'Não consegui ler os dados deste arquivo. Preencha abaixo.' }),
        r.eid && el('button', { type: 'button', class: 'link', text: 'Na verdade é um comprovante de pagamento', onclick: () => { notaRasc = null; ir({ tela: 'pagar', eid: r.eid, comoComprovante: true }, false); } })),
      cartao('Dados da nota', 'nota', el('div', { class: 'grade duas' },
        campo('Número', 'numero', 'text', { inputmode: 'numeric' }), campo('Data de emissão', 'data', 'date'),
        campo('Valor (R$)', 'valor', 'text', { inputmode: 'decimal' }), campo('CPF do tomador', 'cpf', 'text', { inputmode: 'numeric' }))),
      cartao('De quem é', 'pessoa', sel),
      c && cartao('Qual pagamento esta nota cobre', 'moeda', escolha)),
    el('button', { type: 'button', class: 'fab estendido', disabled: !c, onclick: concluirNota }, icone('arquivo'), el('span', { text: 'Guardar nota' })));
}
async function concluirNota() {
  const r = notaRasc;
  const c = cadastroDe(r.pid);
  if (!c) return;
  r.dados.valor = String(valorNum(r.dados.valor) || '');
  const g = r.gid ? pagamentos.find(x => x.id === r.gid) : null;
  const d = await guardarNota(c, g, r.arq, r.dados);
  if (!d) return;
  if (r.eid) { await Cofre.apagarEntrada(r.eid); entradaIds = entradaIds.filter(i => i !== r.eid); }
  notaRasc = null;
  indicarStatus('Nota guardada');
  const enviar = await dialogo({ titulo: 'Nota guardada', texto: `A nota ficou guardada junto do pagamento de ${c.nome}. Quer enviá-la agora pelo WhatsApp?`,
    botoes: [{ rotulo: 'Agora não', valor: null }, { rotulo: `Enviar para ${primeiroNome(c.nome)}`, valor: true, estilo: 'primario' }] });
  if (enviar) await enviarNotaWhatsApp(c, d, g);
  if (entradaIds.length) { ir({ tela: 'pagar', eid: entradaIds[0] }, false); return; }
  ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }, false);
}
// Pagamentos de quem recebe nota e ainda estão sem ela (últimos três meses).
function cartaoSemNota() {
  const limite = somarMeses(hojeISO().slice(0, 7), -2) + '-01';
  const lista = [];
  for (const c of cadastros) if (c.nf && !c.arquivado) for (const g of semNota(c)) if (g.data >= limite) lista.push([c, g]);
  if (!lista.length) return null;
  lista.sort((a, b) => a[1].data.localeCompare(b[1].data));
  const total = lista.reduce((t, [, g]) => t + valorNum(g.valor), 0);
  return el('section', { class: 'cartao agenda sem-nota' },
    el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('arquivo')), el('span', { text: `Sem nota fiscal (${lista.length}) · R$ ${reais(total)}` })),
    lista.slice(0, 6).map(([c, g]) => el('div', { class: 'agenda-linha' },
      el('span', { class: 'agenda-hora', text: dataCurta(g.data).slice(0, 5) }),
      el('button', { type: 'button', class: 'agenda-nome', onclick: () => ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }) }, avatar(c), el('span', { text: c.nome })),
      el('button', { type: 'button', class: 'chip acao', text: 'Emitir', onclick: () => abrirNotaFiscal(c, g) }))),
    lista.length > 6 && el('button', { type: 'button', class: 'link', text: 'Ver todas no mês', onclick: () => { filtroMes = 'nota'; ir({ tela: 'mes' }); } }));
}

// ---------- Documentos e cadastro ----------
function abaDocumentosAdm(c) {
  const lista = docsDe(c.id, 'emitido').filter(d => d.adm);
  return el('div', { class: 'pilha' },
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => novaDeclaracao(c) }, icone('assinar'), el('span', { text: 'Declaração de comparecimento' })),
      el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => escolherRecibo(c) }, icone('moeda'), el('span', { text: 'Recibo' })),
      // Versão 55: a declaração de reembolso tem diagnóstico; por sigilo, só aparece no aparelho do Rodrigo.
      modo === 'dono' && el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => novaDeclaracao(c, { modelo: 'reembolso' }) }, icone('assinar'), el('span', { text: 'Declaração de reembolso' }))),
    modo === 'adm' && !assinatura && el('p', { class: 'faixa', text: 'Os documentos saem sem a imagem da assinatura, para Rodrigo assinar à mão ou pelo gov.br.' }),
    lista.length ? lista.map(d => itemDocumento(c, d))
      : el('div', { class: 'cartao vazio-cartao' }, el('span', { class: 'ic-bolha grande' }, icone('assinar')),
        el('p', { text: 'Declarações de comparecimento e recibos emitidos para este paciente ficam aqui.' })));
}

function abaCadastro(c) {
  const salvar = () => { salvarCadastro(c); copiarParaFicha(c); };
  const campo = (rotulo, chave, extra = {}, largo = false) => el('label', { class: 'campo' + (largo ? ' largo' : '') }, el('span', { text: rotulo }),
    el('input', { type: 'text', value: c[chave] || '', ...extra, oninput: e => {
      if (chave === 'nome' && !e.target.value.trim()) return;
      c[chave] = chave === 'nome' ? e.target.value.trim() : e.target.value;
      if (chave === 'nome') { document.getElementById('titulo-tela').textContent = c.nome; document.getElementById('nome-hero').textContent = c.nome; }
      salvar();
    } }));
  return el('div', { class: 'pilha' },
    cartao('Dados para agenda e cobrança', 'pessoa',
      el('div', { class: 'grade' },
        campo('Nome', 'nome', {}, true),
        campo('Celular (WhatsApp)', 'telefone', { type: 'tel', inputmode: 'tel' }),
        campo('Nome na lista da semana', 'nomeLista', { placeholder: 'Ex.: Ana Paula 1 (se vazio, usa o nome)' }),
        campo('CPF', 'cpf', { inputmode: 'numeric' }),
        campo('Data de nascimento', 'nascimento', { type: 'date' }),
        el('div', { class: 'campo' }, el('span', { text: 'Valor da sessão' }),
          el('button', { type: 'button', class: 'secundario com-icone', onclick: () => alterarValorSessao(c) }, icone('moeda'),
            el('span', { text: valorNum(valorNaData(c)) ? `R$ ${reais(valorNum(valorNaData(c)))} · Alterar` : 'Definir valor' }))))),
    cartao('Contato', 'telefone',
      el('div', { class: 'grade' },
        campo('Telefone 2', 'telefone2', { type: 'tel', inputmode: 'tel' }),
        campo('E-mail', 'email', { type: 'email' }, true),
        campo('Pix ou conta para estorno', 'pix', {}, true))),
    cartao('Forma de pagamento', 'calendario',
      (() => { const sel = el('select', { 'aria-label': 'Modo de pagamento' }, el('option', { value: '', text: 'Não definido' }), Object.entries(MODOS_PAG).map(([k, v]) => el('option', { value: k, text: v })));
        sel.value = c.modoPagamento || ''; sel.addEventListener('change', () => { c.modoPagamento = sel.value; salvar(); }); return sel; })(),
      el('div', { class: 'grade duas' },
        campo('Dia do pagamento', 'diaPagamento', { inputmode: 'numeric', placeholder: 'Ex.: 10' }),
        campo('Valor mensal (R$)', 'valorMensal', { inputmode: 'decimal' }))),
    cartao('Recibo e quem paga', 'moeda',
      // Versão 57: nem todo paciente pede recibo; os marcados aqui entram na lista "Recibos" dos pagamentos.
      (() => {
        const cxRecibo = el('input', { type: 'checkbox', checked: !!(c.recibo || c.nf), onchange: e => { c.recibo = e.target.checked; if (!c.recibo) { c.nf = false; cxNf.checked = false; } salvar(); } });
        const cxNf = el('input', { type: 'checkbox', checked: !!c.nf, onchange: e => { c.nf = e.target.checked; if (c.nf) { c.recibo = true; cxRecibo.checked = true; } salvar(); } });
        return [el('label', { class: 'marcar' }, cxRecibo, el('span', { text: 'Este paciente pede recibo' })),
          el('label', { class: 'marcar' }, cxNf, el('span', { text: 'Prefere nota fiscal (site do governo)' }))];
      })(),
      el('div', { class: 'grade' },
        campo('Pago por (se não for o paciente)', 'pagador', { placeholder: 'Nome do responsável' }),
        campo('CPF de quem paga', 'cpfPagador', { inputmode: 'numeric' }))),
    cartaoHorarios(c),
    modo === 'adm' && el('button', { type: 'button', class: 'secundario', text: c.arquivado ? 'Desarquivar' : 'Arquivar paciente', onclick: async () => {
      await arquivarCadastro(c.id, !c.arquivado); history.back();
    } }),
    modo === 'dono' && el('p', { class: 'suave pequeno', text: 'Nome, CPF, celular e nascimento são os mesmos da ficha clínica: mudar aqui muda lá.' }));
}

// ---------- Configurações ----------
function secaoAdministrativo(linha, secao) {
  return secao('Área administrativa',
    linha('cadeado', 'Senha do administrativo', temSenhaAdmCache ? 'Criada. Abre agenda, pagamentos, mensagens e declarações, sem acesso às fichas.' : 'Ainda não criada.',
      el('div', { class: 'botoes-mini' },
        temSenhaAdmCache && el('button', { type: 'button', class: 'secundario compacto perigo-texto', text: 'Remover', onclick: removerSenhaAdm }),
        el('button', { type: 'button', class: 'secundario compacto', text: temSenhaAdmCache ? 'Trocar' : 'Criar', onclick: criarSenhaAdm }))),
    linha('assinar', 'Assinatura nos documentos do administrativo',
      perfil.assinaturaNoAdm ? 'Ativada: declarações e recibos do administrativo saem com a imagem do seu carimbo e assinatura.' : 'Desativada: saem sem a imagem, para você assinar depois.',
      el('button', { type: 'button', class: 'secundario compacto', text: perfil.assinaturaNoAdm ? 'Desativar' : 'Ativar', onclick: alternarAssinaturaAdm })),
    linha('arquivo', 'Site da nota fiscal', perfil.nfUrl || 'Não definido.', el('button', { type: 'button', class: 'secundario compacto', text: 'Editar', onclick: editarNota })),
    linha('retomar', 'Google Drive', 'Lê as listas de pacientes, presença e pagamentos do Drive.', el('button', { type: 'button', class: 'secundario compacto', text: 'Abrir', onclick: () => ir({ tela: 'drive' }) })),
    linha('calendario', 'Feriados e dias sem atendimento', 'Feriados do ano, férias e recessos. Aviso 5 dias antes.', el('button', { type: 'button', class: 'secundario compacto', text: 'Abrir', onclick: () => ir({ tela: 'feriados' }) })),
    linha('repetir', 'Sincronizar com o administrativo pelo Drive', driveCfg().pastaSync ? 'Pasta definida. Um toque envia e recebe.' : 'Defina a pasta compartilhada em Google Drive.',
      el('button', { type: 'button', class: 'primario compacto', text: 'Sincronizar', onclick: sincronizarDrive })),
    linhaAvisos(linha),
    linha('retomar', 'Enviar dados ao administrativo', 'Gera um arquivo cifrado com agenda, cadastros e pagamentos, sem nada clínico, para o aparelho do administrativo.',
      el('button', { type: 'button', class: 'secundario compacto', text: 'Enviar', onclick: exportarAdm })),
    linha('clipe', 'Receber dados do administrativo', 'Traz os pagamentos e a agenda que ele registrou.',
      el('button', { type: 'button', class: 'secundario compacto', text: 'Receber', onclick: importarAdm })),
    linha('cadeado', 'Senha dos arquivos de troca', senhaTroca ? 'Definida e guardada neste aparelho. O administrativo digita a mesma senha uma vez, no celular dele.' : 'Ainda não definida. Crie aqui antes de enviar os dados ao administrativo.',
      el('button', { type: 'button', class: 'secundario compacto', text: senhaTroca ? 'Trocar' : 'Criar', onclick: definirSenhaTroca })));
}
let temSenhaAdmCache = false;
const telaConfigOriginal = telaConfig;
telaConfig = async function () { temSenhaAdmCache = await Cofre.temSenhaAdm(); return telaConfigOriginal(); }; // eslint-disable-line no-func-assign

async function criarSenhaAdm() {
  const r = await dialogo({
    titulo: temSenhaAdmCache ? 'Trocar senha do administrativo' : 'Criar senha do administrativo',
    texto: 'Precisa ser diferente da sua senha mestra. Quem tiver esta senha vê agenda, pagamentos, mensagens e declarações, mas não as fichas e sessões.',
    campos: [{ rotulo: 'Senha do administrativo', tipo: 'password', autocomplete: 'new-password' }, { rotulo: 'Repita a senha', tipo: 'password', autocomplete: 'new-password' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }]
  });
  if (!r) return;
  const [s1, s2] = r;
  if (s1.length < 8) return aviso('Senha não criada', 'Use pelo menos 8 caracteres.');
  if (s1 !== s2) return aviso('Senha não criada', 'As duas senhas estão diferentes.');
  if (await Cofre.confereSenhaMestra(s1)) return aviso('Senha não criada', 'Esta é a sua senha mestra. Escolha outra para o administrativo.');
  await Cofre.definirSenhaAdm(s1);
  await aviso('Senha do administrativo salva', 'Na abertura do app, quem digitar esta senha entra só na área administrativa.');
  telaConfig();
}
async function removerSenhaAdm() {
  const ok = await dialogo({ titulo: 'Remover a senha do administrativo?', texto: 'Neste aparelho, só a senha mestra passa a abrir o app. Os dados administrativos continuam guardados.', botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Remover', valor: true, estilo: 'perigo' }] });
  if (!ok) return;
  await Cofre.removerSenhaAdm();
  telaConfig();
}
async function alternarAssinaturaAdm() {
  if (!perfil.assinaturaNoAdm) {
    if (!assinatura) return aviso('Falta a imagem', 'Cadastre primeiro o carimbo e a assinatura em Dados profissionais.');
    const ok = await dialogo({
      titulo: 'Liberar sua assinatura para o administrativo?',
      texto: 'A imagem do carimbo e da assinatura vai para a área administrativa e, pelo arquivo de envio, para o aparelho do administrativo. Ele poderá emitir declarações e recibos assinados em seu nome sem que você veja antes.',
      botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Liberar', valor: true, estilo: 'primario' }]
    });
    if (!ok) return;
  }
  perfil.assinaturaNoAdm = !perfil.assinaturaNoAdm;
  salvarPerfil(); await salvarAgora();
  await atualizarCopiaAssinatura();
  if (!perfil.assinaturaNoAdm) await aviso('Assinatura retirada', 'Neste aparelho, já foi. No aparelho do administrativo, ela é apagada quando ele receber o próximo arquivo que você enviar.');
  telaConfig();
}
async function editarNota() {
  const r = await dialogo({
    titulo: 'Nota fiscal',
    texto: 'Endereço do site onde a nota é emitida e o texto padrão da descrição. No texto, {datas} vira as datas dos atendimentos pagos e {mes}, o mês.',
    campos: [{ rotulo: 'Endereço do site (https://…)' }, { rotulo: 'Descrição padrão do serviço' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }]
  });
  if (!r) return;
  const [url, desc] = r;
  if (url.trim()) {
    if (!/^https:\/\/\S+$/.test(url.trim())) return aviso('Endereço não salvo', 'O endereço precisa começar com https://');
    perfil.nfUrl = url.trim();
  }
  if (desc.trim()) perfil.nfDescricao = desc.trim();
  salvarPerfil(); await salvarAgora();
  render(history.state);
}

async function telaConfigAdm() {
  const persistente = await navigator.storage?.persisted?.().catch(() => false);
  const temClin = await Cofre.temClinica();
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
        linha('cadeado', 'Senha do administrativo', null, el('button', { type: 'button', class: 'secundario compacto', text: 'Trocar', onclick: trocarSenhaAdmAtual })),
        temClin && linha('pessoa', 'Área clínica', 'Só com a senha mestra do Rodrigo.', el('button', { type: 'button', class: 'secundario compacto', text: 'Entrar', onclick: entrarNaClinica }))),
      secao('Aparência', linhaAparencia(linha)),
      secao('Troca de dados com o outro aparelho',
        linha('repetir', 'Sincronizar pelo Drive', driveCfg().pastaSync ? 'Pasta definida. Um toque envia e recebe.' : 'Defina a pasta compartilhada em Google Drive.',
          el('button', { type: 'button', class: 'primario compacto', text: 'Sincronizar', onclick: sincronizarDrive })),
        linhaAvisos(linha),
        linha('retomar', 'Enviar dados', 'Gera um arquivo cifrado com a agenda, os cadastros e os pagamentos. Serve também de cópia de segurança.',
          el('button', { type: 'button', class: 'primario compacto', text: 'Enviar', onclick: exportarAdm })),
        linha('clipe', 'Receber dados', 'Abre o arquivo enviado pelo outro aparelho e junta com o que já está aqui.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Receber', onclick: importarAdm })),
        senhaTroca && linha('cadeado', 'Senha dos arquivos lembrada', 'Envio e recebimento em um toque.',
          el('button', { type: 'button', class: 'secundario compacto', text: 'Esquecer', onclick: esquecerSenhaTroca }))),
      secao('Documentos e nota fiscal',
        linha('assinar', 'Dados profissionais', perfil.nome ? `${perfil.nome}${perfil.crp ? ', CRP ' + perfil.crp : ''}. ${assinatura ? 'Com assinatura.' : 'Documentos saem sem assinatura.'}` : 'Ainda não recebidos do aparelho do Rodrigo.', null),
        linha('arquivo', 'Site da nota fiscal', perfil.nfUrl || 'Não definido.', el('button', { type: 'button', class: 'secundario compacto', text: 'Editar', onclick: editarNota })),
        linha('retomar', 'Google Drive', 'Lê as listas de pacientes, presença e pagamentos do Drive.', el('button', { type: 'button', class: 'secundario compacto', text: 'Abrir', onclick: () => ir({ tela: 'drive' }) })),
        linha('calendario', 'Feriados e dias sem atendimento', 'Feriados do ano, férias e recessos. Aviso 5 dias antes.', el('button', { type: 'button', class: 'secundario compacto', text: 'Abrir', onclick: () => ir({ tela: 'feriados' }) }))),
      secao('Armazenamento',
        linha('nota', 'Proteção contra limpeza automática',
          persistente ? 'Ativa: o Android não apaga estes dados para liberar espaço.' : 'Inativa: o Android pode apagar os dados se faltar espaço.',
          !persistente && el('button', { type: 'button', class: 'secundario compacto', text: 'Ativar', onclick: async () => { await navigator.storage?.persist?.(); telaConfigAdm(); } }))),
      el('p', { class: 'suave pequeno centro', text: `Consultório, ${VERSAO}, área administrativa. O app só se conecta ao Google Drive, e só quando você toca em "Atualizar do Drive".` })));
}
async function trocarSenhaAdmAtual() {
  const r = await dialogo({
    titulo: 'Trocar senha do administrativo',
    campos: [{ rotulo: 'Senha atual', tipo: 'password', autocomplete: 'current-password' }, { rotulo: 'Nova senha', tipo: 'password', autocomplete: 'new-password' }, { rotulo: 'Repita a nova senha', tipo: 'password', autocomplete: 'new-password' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Trocar', valor: true, estilo: 'primario' }]
  });
  if (!r) return;
  const [atual, nova, repete] = r;
  if (nova.length < 8) return aviso('Senha não trocada', 'Use pelo menos 8 caracteres.');
  if (nova !== repete) return aviso('Senha não trocada', 'As duas novas senhas estão diferentes.');
  if (await Cofre.temClinica() && await Cofre.confereSenhaMestra(nova)) return aviso('Senha não trocada', 'Escolha uma senha diferente da senha mestra.');
  try { await Cofre.trocarSenhaAdm(atual, nova); await aviso('Senha trocada', 'Use a nova senha a partir de agora.'); }
  catch { await aviso('Senha não trocada', 'A senha atual está incorreta.'); }
}

// ---------- Troca de arquivo entre os aparelhos ----------
const FORA_DA_TROCA = new Set(['x:entradapriv', 'x:senhatroca', 'x:migrado7', 'c:chaveadm', 'c:senhabackup']);
async function registrosAdm(paraBackup) {
  await salvarAgora();
  const r = {};
  cadastros.forEach(c => { r[chaveCad(c)] = c; });
  atendimentos.forEach(a => { r[chaveAt(a)] = a; });
  pagamentos.forEach(g => { r[chavePag(g)] = g; });
  lembretesAdm.forEach(l => { r[chaveLem(l)] = l; });
  for (const [k, o] of lapides) r[k] = o;
  r['x:perfil'] = perfil.atualizadoEm ? perfil : { ...perfil, atualizadoEm: '2000-01-01T00:00:00.000Z' }; // vai sempre (sem data, não passa por cima do outro lado)
  for (const d of documentos.filter(x => x.adm)) {
    r[chaveDoc(d)] = d;
    const cont = await Cofre.ler(chaveConteudo(d));
    if (cont) r[chaveConteudo(d)] = cont;
  }
  const copia = await Cofre.ler('x:assinatura');
  if (copia && (paraBackup || perfil.assinaturaNoAdm)) r['x:assinatura'] = copia;
  return r;
}
const CAMPOS_PROFISSIONAIS = ['nome', 'titulo', 'crp', 'clinica', 'cnpj', 'cidade', 'endereco', 'telefone', 'email', 'logo', 'nfUrl', 'nfDescricao', 'assinaturaNoAdm', 'whatsAdm', 'whatsDono'];
async function mesclarRegistros(registros, filtro) {
  let novos = 0, atualizados = 0, mantidos = 0;
  const conteudo = k => k.startsWith('a:') || k.startsWith('x:f:');
  const entradas = Object.entries(registros).map(([k, o]) => [k === 'c:perfil' ? 'x:perfil' : k, o])
    .filter(([k]) => !FORA_DA_TROCA.has(k) && filtro(k))
    .sort(([a], [b]) => (conteudo(a) ? 0 : 1) - (conteudo(b) ? 0 : 1)); // arquivos antes das descrições
  for (const [k, o] of entradas) {
    let atual = null;
    try { atual = await Cofre.ler(k); } catch { continue; }
    if (!atual) { await Cofre.salvar(k, o); novos++; }
    else if (k === 'x:perfil') {
      // Versão 51: o perfil é juntado campo a campo. Os dados profissionais (nome, CRP, logo, endereço…) valem os do aparelho do Rodrigo;
      // nos demais campos vale o mais recente, e campo vazio nunca apaga campo preenchido.
      const novo = (o.atualizadoEm || '') > (atual.atualizadoEm || '');
      const [maisNovo, maisVelho] = novo ? [o, atual] : [atual, o];
      const junto = { ...maisNovo };
      for (const [campo, v] of Object.entries(maisVelho)) if ((junto[campo] === undefined || junto[campo] === '' || junto[campo] === null) && v !== '' && v != null) junto[campo] = v;
      const doRodrigo = modo === 'dono' ? atual : o;
      for (const campo of CAMPOS_PROFISSIONAIS) if (doRodrigo[campo] !== undefined && doRodrigo[campo] !== '' && doRodrigo[campo] !== null) junto[campo] = doRodrigo[campo];
      if (JSON.stringify(junto) !== JSON.stringify(atual)) { await Cofre.salvar(k, junto); atualizados++; } else mantidos++;
    }
    else if (!conteudo(k) && (o.atualizadoEm || '') > (atual.atualizadoEm || '')) { await Cofre.salvar(k, o); atualizados++; }
    else mantidos++;
  }
  return { novos, atualizados, mantidos };
}

async function senhaDosArquivos(texto) {
  if (senhaTroca) return { senha: senhaTroca, nova: false };
  const r = await dialogo({
    titulo: 'Senha dos arquivos de troca', texto,
    campos: [{ rotulo: 'Senha dos arquivos', tipo: 'password', autocomplete: 'off' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Continuar', valor: true, estilo: 'primario' }]
  });
  if (!r) return null;
  if (r.length < 8) { await aviso('Senha curta', 'Use pelo menos 8 caracteres.'); return null; }
  return { senha: r, nova: true };
}
async function oferecerLembrarSenha(s) {
  if (!s.nova) return;
  const ok = await dialogo({ titulo: 'Lembrar esta senha?', texto: 'Ela fica guardada cifrada neste aparelho, e as próximas trocas ficam a um toque. Use a mesma senha nos dois aparelhos.', botoes: [{ rotulo: 'Não', valor: null }, { rotulo: 'Lembrar', valor: true, estilo: 'primario' }] });
  if (!ok) return;
  senhaTroca = s.senha;
  await Cofre.salvar('x:senhatroca', { tipoRegistro: 'senhatroca', senha: s.senha, atualizadoEm: agoraISO() });
}
// Versão 38: criar ou trocar a senha dos arquivos direto em Configurações, já guardada neste aparelho.
async function definirSenhaTroca() {
  const r = await dialogo({ titulo: senhaTroca ? 'Trocar a senha dos arquivos' : 'Criar a senha dos arquivos',
    texto: 'Ela protege o arquivo que vai para o celular do administrativo e a sincronização pelo Drive. Ele digita a mesma senha uma vez, no celular dele. Anote-a.',
    campos: [{ rotulo: 'Nova senha (8 ou mais caracteres)', tipo: 'password', autocomplete: 'off' }, { rotulo: 'Repita a senha', tipo: 'password', autocomplete: 'off' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }] });
  if (!r) return;
  const [a, b] = r;
  if ((a || '').length < 8) return aviso('Senha curta', 'Use pelo menos 8 caracteres.');
  if (a !== b) return aviso('As senhas não conferem', 'Digite a mesma senha nos dois campos.');
  senhaTroca = a;
  await Cofre.salvar('x:senhatroca', { tipoRegistro: 'senhatroca', senha: a, atualizadoEm: agoraISO() });
  await salvarAgora();
  await aviso('Senha salva', 'Agora toque em "Enviar dados ao administrativo" e mande o arquivo para ele. No celular dele, a mesma senha é pedida uma única vez.');
  render(history.state);
}
async function esquecerSenhaTroca() {
  await Cofre.apagar('x:senhatroca');
  senhaTroca = null;
  render(history.state);
}

async function entregarArquivo(arquivo, titulo) {
  const destino = await dialogo({
    titulo: 'Arquivo pronto e cifrado',
    texto: 'Mande pelo WhatsApp ou pelo Drive para o outro aparelho. Sem a senha, o arquivo é ilegível.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Baixar', valor: 'baixar' }, { rotulo: 'Enviar', valor: 'compartilhar', estilo: 'primario' }]
  });
  if (destino === 'compartilhar') {
    if (navigator.canShare?.({ files: [arquivo] })) {
      ignorarOcultacao = true;
      try { await navigator.share({ files: [arquivo], title: titulo }); return true; }
      catch (e) { if (e.name !== 'AbortError') await aviso('Não foi possível enviar', 'Use "Baixar" e mande o arquivo pelo app do WhatsApp ou do Drive.'); }
      finally { ignorarOcultacao = false; }
    } else await aviso('Envio indisponível', 'Use "Baixar" e mande o arquivo pelo app do WhatsApp ou do Drive.');
  } else if (destino === 'baixar') {
    const url = URL.createObjectURL(arquivo);
    const a = el('a', { href: url, download: arquivo.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }
  return false;
}
async function exportarAdm() {
  const s = await senhaDosArquivos('Escolha uma senha para os arquivos trocados entre os dois aparelhos. O outro aparelho vai pedir a mesma senha.');
  if (!s) return;
  const registros = await registrosAdm(false);
  const texto = await Cofre.cifrarPacote(s.senha, { formato: 'consultorio-adm', versao: 1, de: modo, criadoEm: agoraISO(), registros });
  const arquivo = new File([texto], `consultorio-administrativo-${hojeISO()}.cifrado.txt`, { type: 'text/plain' });
  if (await entregarArquivo(arquivo, 'Dados do administrativo')) await oferecerLembrarSenha(s);
  if (Cofre.aberto()) render(history.state);
}
async function importarAdm() {
  const [arquivo] = await escolherArquivos({ accept: ACEITA_PACOTE }); // aceita qualquer arquivo, mas abre o seletor de documentos (sem filtro, o Android abria só fotos e vídeos)
  if (!arquivo) return;
  const s = await senhaDosArquivos(arquivo.name);
  if (!s) return;
  let pacote;
  try { pacote = await Cofre.decifrarPacote(s.senha, await textoDoPacote(arquivo)); }
  catch (e) { return aviso('Não foi possível abrir', e.message === 'senha-incorreta' ? 'Senha incorreta.' : 'Este arquivo não é do Consultório.'); }
  if (pacote.formato !== 'consultorio-adm') return aviso('Arquivo diferente', 'Este é um backup completo. Aqui entra só o arquivo gerado em "Enviar dados ao administrativo".');
  await salvarAgora();
  const r = await mesclarRegistros(pacote.registros || {}, k => k.startsWith('x:'));
  if (modo === 'adm' && pacote.registros?.['x:perfil'] && !pacote.registros['x:perfil'].assinaturaNoAdm) await Cofre.apagar('x:assinatura');
  await recarregarTudo();
  await oferecerLembrarSenha(s);
  await aviso('Dados recebidos', `${r.novos} registros novos, ${r.atualizados} atualizados e ${r.mantidos} já estavam em dia.`);
  render(history.state);
}

// ---------- Primeiro uso num aparelho do administrativo ----------
function telaCriacaoAdm() {
  const s1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Senha do administrativo', 'aria-label': 'Senha do administrativo' });
  const s2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha', 'aria-label': 'Repita a senha' });
  const msg = el('p', { class: 'erro-msg', role: 'alert' });
  const botao = el('button', { type: 'button', class: 'primario', text: 'Começar' });
  botao.addEventListener('click', async () => {
    msg.textContent = '';
    if (s1.value.length < 8) { msg.textContent = 'Use pelo menos 8 caracteres.'; return; }
    if (s1.value !== s2.value) { msg.textContent = 'As duas senhas estão diferentes.'; return; }
    botao.disabled = true; botao.textContent = 'Preparando…';
    await Cofre.criarSoAdm(s1.value);
    s1.value = s2.value = '';
    try { await navigator.storage?.persist?.(); } catch { }
    await entrarAdm();
  });
  mostrar(porta(
    el('p', { class: 'suave centro', text: 'Neste aparelho fica só a parte administrativa: agenda, pagamentos, mensagens e declarações. Fichas e sessões nunca vêm para cá.' }),
    s1, s2, msg, botao,
    el('p', { class: 'suave pequeno centro', text: 'Depois, para trazer os pacientes: Configurações → Receber dados, com o arquivo enviado pelo aparelho do Rodrigo.' }),
    el('button', { type: 'button', class: 'link centro', text: 'Voltar', onclick: telaCriacao })));
  s1.focus();
}

// =====================================================================
// Google Drive: lê as listas da clínica (informações dos pacientes, lista de presença,
// pagamentos mensais) direto do Drive, só para leitura. A conexão vai do aparelho ao Google;
// nada passa por outro servidor. As mesmas listas podem vir de um arquivo escolhido à mão.
// =====================================================================
const FONTES_DRIVE = {
  pacientes: { nome: 'Informações dos pacientes', dica: 'Planilha com nome, nascimento, CPF, telefones e valores (a do Google Forms)', tipo: 'tabela' },
  presenca: { nome: 'Lista de presença', dica: 'O documento com as consultas da semana (✅ ❌ ⭕ 💸 💵 💰)', tipo: 'texto' },
  pagamentos: { nome: 'Pagamentos mensais', dica: 'Planilha com o nome e o dia de pagamento de cada paciente', tipo: 'tabela' }
};
const MODOS_PAG = { sessao: 'Por sessão', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' };
let tokenGoogle = null;   // só na memória, some ao bloquear
let importacaoDrive = null;
const driveCfg = () => (perfil.drive ||= { clientId: '', fontes: {} });

// ---------- Leitura dos formatos ----------
const norm = s => semAcento(s || '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const soDigitos = s => (s || '').replace(/\D/g, '');
function formatarCpf(v) {
  const d = soDigitos(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (v || '').trim();
}
function dataNascimento(v) {
  v = (v || '').trim();
  if (!v) return '';
  const serie = /^\d{5}(\.\d+)?$/.test(v) && dataDeCelula(v);
  if (serie) return serie;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let d, m, a;
  if (iso) [a, m, d] = [+iso[1], +iso[2], +iso[3]];
  else {
    const ext = semAcento(v).match(/(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s+)?(\d{2,4})/);
    const num = v.replace(/\s/g, '').match(/^(\d{1,2})[./\-]+(\d{1,2})[./\-]+(\d{2,4})$/);
    const junto = v.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (ext) [d, m, a] = [+ext[1], MESES[ext[2]], +ext[3]];
    else if (num) [d, m, a] = [+num[1], +num[2], +num[3]];
    else if (junto) [d, m, a] = [+junto[1], +junto[2], +junto[3]];
    else return '';
    if (a < 100) a += a > (new Date().getFullYear() % 100) ? 1900 : 2000;
  }
  const dt = new Date(a, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d || a < 1900 || dt > new Date()) return '';
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function valorDeTexto(v) {
  const t = (v || '').replace(/[R$\s]/g, '');
  if (!/\d/.test(t)) return '';
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 && n < 100000 ? reais(n) : '';
}
function modoDeTexto(v) {
  const t = norm(v);
  return /quinz/.test(t) ? 'quinzenal' : /mens/.test(t) ? 'mensal' : /seman/.test(t) ? 'semanal' : /sess|avuls|consulta/.test(t) ? 'sessao' : '';
}

// Planilha "Informações dos pacientes" (respostas do Google Forms).
function lerInformacoes(linhas) {
  const hi = linhas.slice(0, 8).findIndex(r => r.some(c => /^nome/.test(norm(c))) && r.some(c => /cpf|nascimento/.test(norm(c))));
  if (hi < 0) throw new Error('Não encontrei a linha de títulos (Nome completo, CPF…).');
  const cab = linhas[hi].map(norm);
  const col = re => cab.findIndex(c => re.test(c));
  const C = {
    nome: col(/^nome/), nascimento: col(/nascimento/), cpf: col(/^cpf/), pix: col(/pix|estorno/), email: col(/^e ?mail/),
    telefone: col(/^tele\w* ?1$|^telefone$|^celular/), telefone2: col(/^tele\w* ?2/), modo: col(/modalidade|^atend/),
    valor: col(/valor de consu|valor da consu|valor da sess/), valorMensal: col(/valor mensal/)
  };
  const porChave = new Map();
  for (const r of linhas.slice(hi + 1)) {
    const v = k => C[k] >= 0 ? (r[C[k]] || '').trim() : '';
    const nome = v('nome').replace(/\s+/g, ' ');
    if (!/\p{L}{2}/u.test(nome) || /^nome/i.test(nome)) continue;
    const apelidoParen = (nome.match(/\(([^)]+)\)/) || [])[1];
    const rec = {
      nome: nome.replace(/\s*\([^)]*\)\s*/g, ' ').trim().replace(/\b(\p{L})(\p{L}*)/gu, (x, a, b) => nome === nome.toUpperCase() ? a + b.toLowerCase() : x),
      nascimento: dataNascimento(v('nascimento')), cpf: soDigitos(v('cpf')).length >= 10 ? formatarCpf(v('cpf')) : '',
      pix: v('pix'), email: /@/.test(v('email')) ? v('email').replace(/\s/g, '') : '', telefone: v('telefone'), telefone2: v('telefone2'),
      modo: modoDeTexto(v('modo')), valor: valorDeTexto(v('valor')), valorMensal: valorDeTexto(v('valorMensal')), apelidos: apelidoParen ? [apelidoParen] : []
    };
    const chave = soDigitos(rec.cpf).length === 11 ? 'cpf' + soDigitos(rec.cpf) : 'nome' + norm(rec.nome);
    const outraChave = 'nome' + norm(rec.nome);
    const antigo = porChave.get(chave) || porChave.get(outraChave);
    if (antigo) { for (const [k, x] of Object.entries(rec)) if (k === 'apelidos') antigo.apelidos.push(...x); else if (x) antigo[k] = x; }
    else { porChave.set(chave, rec); porChave.set(outraChave, rec); }
  }
  return [...new Set(porChave.values())];
}

// Documento "Lista de presença", no formato das mensagens da semana.
const NAO_PACIENTE = /\b(mestrado|almoco|orientador\w*|professor\w*|musculacao|academia|funcional|jump|gap|heylocal|aula|step|ferias|feriado)\b/;
function lerPresenca(texto) {
  const hoje = hojeISO(), anoAtual = Number(hoje.slice(0, 4));
  let semana = null, dia = null;
  const itens = [];
  for (const bruto of texto.split(/\r?\n|(?=✔️)/)) {
    const l = bruto.trim();
    if (!l) continue;
    const s = l.match(/consultas\s+de\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
    if (s) { const a = +s[3] < 100 ? 2000 + +s[3] : +s[3]; semana = { mes: +s[2], ano: a }; continue; }
    const d = semAcento(l).match(/(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (d) {
      const [dd, mm] = [+d[2], +d[3]];
      let ano = d[4] ? (+d[4] < 100 ? 2000 + +d[4] : +d[4]) : semana ? (mm < semana.mes - 6 ? semana.ano + 1 : semana.ano) : anoAtual;
      let ymd = `${ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      if (!d[4] && !semana && ymd > somarDias(hoje, 60)) ymd = `${ano - 1}${ymd.slice(4)}`;
      dia = ymd;
      continue;
    }
    const e = l.match(/^(?:✔️|✔)?\s*(\d{1,2})\s*h\s*(\d{2})?\s*[-–]\s*(.*)$/);
    if (!e || !dia) continue;
    const resto = e[3];
    // 📅 = horário de paciente sem forma de pagamento definida (usado nos arquivos de agenda montados à parte).
    if (!/[💸💵💰✅❌⭕❓⁉💱📅]|\b1x\b/i.test(resto)) continue;
    const nomeBruto = resto.split(/\s*[-–]\s*|[💸💵💰✅❌⭕❓⁉💱🟡🔴🟢📲📅]/u)[0];
    const tokens = nomeBruto.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t && (/\p{L}/u.test(t) || /^\d$/.test(t)));
    const apelido = tokens.filter(t => !/^\d$/.test(t) || tokens.length > 1).join(' ');
    if (!/\p{L}{2}/u.test(apelido) || NAO_PACIENTE.test(norm(apelido))) continue;
    const marcas = [...resto.matchAll(/✅|❌|⭕|💱/g)].map(x => x[0]);
    const ultima = marcas[marcas.length - 1];
    const status = ultima === '✅' ? 'realizada' : ultima === '⭕' ? 'falta' : ultima === '❌' ? 'cancelada' : ultima === '💱' ? 'remarcada' : null;
    const modo = /💸/u.test(resto) ? 'mensal' : /💵/u.test(resto) ? 'semanal' : /💰/u.test(resto) ? 'sessao' : /\b1x\b/i.test(resto) ? 'avulso' : '';
    itens.push({ apelido, data: dia, hora: `${String(+e[1]).padStart(2, '0')}:${e[2] || '00'}`, status, modo });
  }
  return itens;
}

// Planilha "Pagamentos mensais": nome e dia do pagamento (só o primeiro bloco, o do ano mais recente).
function lerPagamentosMensais(linhas) {
  const hi = linhas.findIndex(r => /^nome/.test(norm(r[0])) || r.some(c => /^nome$/.test(norm(c))));
  if (hi < 0) throw new Error('Não encontrei a coluna NOME.');
  const cab = linhas[hi].map(norm);
  const cNome = cab.findIndex(c => /^nome/.test(c));
  const cDia = cab.findIndex(c => /^dt\b|^dia|^pagamento|vencim/.test(c));
  const cModo = cab.findIndex(c => /^modo/.test(c));
  const res = [];
  for (const r of linhas.slice(hi + 1)) {
    if (r.some(c => /pagamentos mensais|^nome\b/i.test(norm(c)))) break;
    const nome = (r[cNome] || '').replace(/[.,;:]+\s*$/, '').replace(/[.,;:]+$/, '').trim();
    if (!/\p{L}{2}/u.test(nome) || /^[❌🔴🟡🟢]/u.test(nome)) continue;
    const bruto = cDia >= 0 ? (r[cDia] || '') : '';
    const quinz = /15\s*\/\s*15|¹⁵\/¹⁵|quinzen/i.test(bruto) || /quinzen/i.test(r.join(' '));
    const dia = quinz ? 15 : Number((bruto.match(/\d{1,2}/) || [])[0]) || 0;
    res.push({ apelido: nome, dia: dia >= 1 && dia <= 31 ? dia : 0, modo: quinz ? 'quinzenal' : 'mensal', antecipado: cModo >= 0 ? /antecip/i.test(r[cModo] || '') : null });
  }
  return res;
}

// ---------- Apelidos: "Itala", "Ana Paula 1" → paciente do cadastro ----------
const apelidos = () => (perfil.apelidos ||= {});
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
function sugerirCadastro(apelido, candidatos) {
  const ts = norm(apelido).split(' ').filter(t => !/^\d+$/.test(t));
  if (!ts.length) return null;
  const bate = (t, nomeTs) => nomeTs.some(n => n === t || (t.length >= 4 && n.startsWith(t)) || (t.length >= 5 && distancia(t, n) <= 1));
  const achados = candidatos.filter(c => { const nomeTs = norm([c.nome, ...(c.apelidos || [])].join(' ')).split(' '); return ts.every(t => bate(t, nomeTs)); });
  return achados.length === 1 ? achados[0].id : null;
}

// ---------- Conexão com o Google ----------
function carregarGoogle() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (carregarGoogle.p) return carregarGoogle.p;
  carregarGoogle.p = new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => ok(); s.onerror = () => { carregarGoogle.p = null; erro(new Error('sem-internet')); };
    document.head.append(s);
  });
  return carregarGoogle.p;
}
function pedirTokenGoogle(escopo = 'https://www.googleapis.com/auth/drive.readonly') {
  // Precisa ser chamado direto no toque do botão, para o Android não bloquear a janela do Google.
  // A sincronização pede o escopo de escrita; ele também permite ler as listas.
  const ESCRITA = 'https://www.googleapis.com/auth/drive';
  return new Promise((ok, erro) => {
    if (tokenGoogle && tokenGoogle.expira > Date.now() + 60000 && (tokenGoogle.escopo === escopo || tokenGoogle.escopo === ESCRITA)) return ok(tokenGoogle.valor);
    if (!window.google?.accounts?.oauth2) return erro(new Error('carregando'));
    const cliente = google.accounts.oauth2.initTokenClient({
      client_id: driveCfg().clientId.trim(),
      scope: escopo,
      callback: r => { if (r.error || !r.access_token) return erro(new Error(r.error || 'recusado')); tokenGoogle = { valor: r.access_token, expira: Date.now() + (Number(r.expires_in) || 3600) * 1000, escopo }; ok(r.access_token); },
      error_callback: e => erro(new Error(e?.type || 'cancelado'))
    });
    liberarSaidaTemporaria();
    cliente.requestAccessToken({ prompt: tokenGoogle ? '' : undefined });
  });
}
const idDoLink = link => ((link || '').match(/\/d\/([\w-]{20,})/) || (link || '').match(/[?&]id=([\w-]{20,})/) || (link || '').match(/^([\w-]{25,})$/) || [])[1] || null;
async function baixarDoDrive(id, token) {
  const h = { Authorization: 'Bearer ' + token };
  const api = 'https://www.googleapis.com/drive/v3/files/' + id;
  const rm = await fetch(api + '?fields=name,mimeType&supportsAllDrives=true', { headers: h });
  if (!rm.ok) throw new Error(rm.status === 404 ? 'nao-encontrado' : rm.status === 401 || rm.status === 403 ? 'sem-permissao' : 'falha');
  const meta = await rm.json();
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let url = api + '?alt=media&supportsAllDrives=true', nome = meta.name, tipo = meta.mimeType;
  if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') { url = api + '/export?mimeType=' + encodeURIComponent(XLSX); nome += '.xlsx'; tipo = XLSX; }
  else if (meta.mimeType === 'application/vnd.google-apps.document') { url = api + '/export?mimeType=text%2Fplain'; nome += '.txt'; tipo = 'text/plain'; }
  const r = await fetch(url, { headers: h });
  if (!r.ok) throw new Error('falha');
  return new File([await r.arrayBuffer()], nome, { type: tipo });
}
async function lerFonte(chave, arquivo) {
  const n = arquivo.name.toLowerCase();
  if (n.endsWith('.pdf') || arquivo.type === 'application/pdf') throw new Error('Arquivo em PDF: use a planilha ou o documento original.');
  if (FONTES_DRIVE[chave].tipo === 'texto') return lerPresenca(await extrairTexto(arquivo.name.includes('.') ? arquivo : new File([arquivo], arquivo.name + '.txt')));
  const linhas = n.endsWith('.xlsx') ? await lerXlsx(await arquivo.arrayBuffer()) : lerTabelaTexto(await arquivo.text());
  return chave === 'pacientes' ? lerInformacoes(linhas) : lerPagamentosMensais(linhas);
}

async function atualizarDoDrive() {
  const cfg = driveCfg();
  const fontes = Object.keys(FONTES_DRIVE).filter(k => idDoLink(cfg.fontes[k]));
  if (!cfg.clientId || !fontes.length) { ir({ tela: 'drive' }); return; }
  let token;
  try { token = await pedirTokenGoogle(); }
  catch (e) {
    return aviso('Não foi possível entrar no Google', e.message === 'carregando' ? 'A conexão com o Google ainda estava carregando. Toque de novo em "Atualizar do Drive".'
      : e.message === 'popup_closed' || e.message === 'cancelado' ? 'A janela do Google foi fechada antes de terminar.'
        : 'Confira a internet e a chave de conexão em Configurações → Google Drive.');
  }
  indicarStatus('Lendo o Drive…');
  const dados = {}, erros = [];
  for (const k of fontes) {
    try { dados[k] = await lerFonte(k, await baixarDoDrive(idDoLink(cfg.fontes[k]), token)); }
    catch (e) {
      erros.push(`${FONTES_DRIVE[k].nome}: ${e.message === 'nao-encontrado' ? 'arquivo não encontrado (confira o link)' : e.message === 'sem-permissao' ? 'sem permissão para abrir' : e.message === 'falha' ? 'não foi possível baixar' : e.message}`);
      if (e.message === 'sem-permissao') tokenGoogle = null;
    }
  }
  indicarStatus('');
  prepararImportacao(dados, erros);
}
async function importarArquivoManual(chave) {
  const [f] = await escolherArquivos({ accept: FONTES_DRIVE[chave].tipo === 'texto' ? '.txt,.docx,.odt,text/plain' : '.xlsx,.csv,.tsv,.txt' });
  if (!f) return;
  try { prepararImportacao({ [chave]: await lerFonte(chave, f) }, []); }
  catch (e) { aviso('Não foi possível ler', e.message === 'desconhecido' ? 'Formato não reconhecido.' : e.message); }
}

// ---------- Conferência antes de gravar ----------
function prepararImportacao(dados, erros) {
  const novos = [], completados = [];
  const candidatos = cadastros.map(c => ({ id: c.id, nome: c.nome, apelidos: [] }));
  for (const r of dados.pacientes || []) {
    let c = cadastros.find(x => (soDigitos(r.cpf).length === 11 && soDigitos(x.cpf) === soDigitos(r.cpf)) || norm(x.nome) === norm(r.nome));
    // Versão 28: paciente criado antes só com o apelido da lista (cadastro provisório) é completado pela ficha do Forms, sem duplicar.
    if (!c) {
      const prov = cadastros.filter(x => x.provisorio && !soDigitos(x.cpf) && !completados.some(k => k.c === x)
        && sugerirCadastro(x.nomeLista || x.nome, [{ id: 'ficha', nome: r.nome, apelidos: r.apelidos }]) === 'ficha');
      if (prov.length === 1) c = prov[0];
    }
    if (c) completados.push({ c, r });
    else { const id = crypto.randomUUID(); novos.push({ id, r }); candidatos.push({ id, nome: r.nome, apelidos: r.apelidos, novo: true }); }
  }
  for (const { c, r } of completados) { const k = candidatos.find(x => x.id === c.id); k.apelidos = r.apelidos; }
  const mapa = apelidos();
  const nomes = new Map();
  for (const i of [...(dados.presenca || []), ...(dados.pagamentos || [])]) {
    const k = norm(i.apelido);
    if (!nomes.has(k)) nomes.set(k, { apelido: i.apelido, n: 0 });
    nomes.get(k).n++;
  }
  const escolhas = {};
  for (const [k, { apelido }] of nomes) {
    const salvo = mapa[k];
    escolhas[k] = salvo && (salvo === 'ignorar' || candidatos.some(c => c.id === salvo)) ? salvo : (sugerirCadastro(apelido, candidatos) || '');
  }
  const datas = (dados.presenca || []).map(i => i.data).sort();
  importacaoDrive = { dados, erros, novos, completados, candidatos, nomes, escolhas, jaSalvos: new Set([...nomes.keys()].filter(k => mapa[k])),
    controleDesde: hojeISO().slice(0, 8) + '01', arquivarInativos: false, de: datas[0], ate: datas[datas.length - 1] };
  ir({ tela: 'driveImportar' });
}

function telaImportarDrive() {
  const m = importacaoDrive;
  if (!m) { history.back(); return; }
  const opcoes = [...m.candidatos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const linhaApelido = k => {
    const { apelido, n } = m.nomes.get(k);
    const sel = el('select', { 'aria-label': 'Paciente para ' + apelido },
      el('option', { value: '', text: 'Escolha…' }), el('option', { value: 'novo', text: '+ Novo paciente (provisório: completa quando preencher o Forms)' }), el('option', { value: 'ignorar', text: 'Não é paciente / ignorar' }),
      opcoes.map(c => el('option', { value: c.id, text: c.nome + (c.novo ? ' (novo)' : '') })));
    sel.value = m.escolhas[k] || '';
    sel.addEventListener('change', () => { m.escolhas[k] = sel.value; resumo(); });
    return el('div', { class: 'coluna-map' + (m.escolhas[k] === 'ignorar' ? ' ignorado' : '') },
      el('div', { class: 'coluna-info' }, el('strong', { text: apelido }), el('small', { class: 'suave', text: `${n} ${n === 1 ? 'vez' : 'vezes'} na lista` })), sel);
  };
  const pendentes = [...m.nomes.keys()].filter(k => !m.jaSalvos.has(k)).sort((a, b) => (m.escolhas[a] ? 1 : 0) - (m.escolhas[b] ? 1 : 0) || a.localeCompare(b));
  const ligados = [...m.nomes.keys()].filter(k => m.jaSalvos.has(k));
  const caixaResumo = el('div', { class: 'pilha-pequena' });
  const resumo = () => {
    const faltam = [...m.nomes.keys()].filter(k => !m.escolhas[k]).length;
    const at = (m.dados.presenca || []).filter(i => i.status !== 'cancelada' && m.escolhas[norm(i.apelido)] && m.escolhas[norm(i.apelido)] !== 'ignorar').length;
    caixaResumo.replaceChildren(...[
      faltam ? el('p', { class: 'faixa', text: `${faltam} ${faltam === 1 ? 'nome ainda sem paciente escolhido: ele fica' : 'nomes ainda sem paciente escolhido: eles ficam'} de fora desta vez.` }) : null,
      m.dados.presenca && el('p', { class: 'suave pequeno', text: `${at} atendimentos serão conferidos${m.de ? `, de ${dataCurta(m.de)} a ${dataCurta(m.ate)}` : ''}. Os que já estão no app não são duplicados.` })].filter(Boolean));
  };
  resumo();
  mostrar(
    cabecalho('Conferir antes de importar', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      m.erros.length > 0 && el('div', { class: 'faixa' }, m.erros.map(e => el('p', { text: e }))),
      m.dados.pacientes && cartao('Informações dos pacientes', 'pessoa',
        el('p', { text: `${m.novos.length} ${m.novos.length === 1 ? 'paciente novo' : 'pacientes novos'} e ${m.completados.length} já ${m.completados.length === 1 ? 'cadastrado' : 'cadastrados'}.` }),
        el('p', { class: 'suave pequeno', text: 'Nos já cadastrados, o app só preenche o que está vazio: o que foi digitado no app não é trocado.' }),
        m.novos.length > 0 && el('details', {}, el('summary', { class: 'link', text: 'Ver os novos' }), el('p', { class: 'suave pequeno', text: listaNatural(m.novos.map(x => x.r.nome)) + '.' }))),
      m.nomes.size > 0 && cartao('Nomes usados nas listas', 'tag',
        el('p', { class: 'suave pequeno', text: 'As listas usam apelidos. Confira a quem cada um corresponde; o app lembra na próxima vez.' }),
        pendentes.map(linhaApelido),
        ligados.length > 0 && el('details', {}, el('summary', { class: 'link', text: `Rever ${ligados.length} já ligados antes` }), ligados.map(linhaApelido))),
      m.dados.presenca && cartao('Atendimentos', 'calendario',
        el('label', { class: 'campo' }, el('span', { text: 'Controlar pagamentos a partir de' }),
          el('input', { type: 'date', value: m.controleDesde, onchange: e => { if (e.target.value) m.controleDesde = e.target.value; } })),
        el('p', { class: 'suave pequeno', text: 'Atendimentos antes desta data entram só como histórico, sem cobrança. A lista de presença não diz se já foi pago; os pagamentos entram pelo registro de pagamento.' }),
        el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: m.arquivarInativos, onchange: e => { m.arquivarInativos = e.target.checked; } }),
          el('span', { text: 'Arquivar quem não aparece na lista nos últimos 60 dias' }))),
      caixaResumo),
    el('button', { type: 'button', class: 'fab estendido', onclick: concluirImportacaoDrive }, icone('mais'), el('span', { text: 'Importar' })));
}

async function concluirImportacaoDrive() {
  const m = importacaoDrive;
  const agora = agoraISO();
  const mapa = apelidos();
  const idsNovos = new Map();
  let criados = 0, completos = 0, atNovos = 0, atAtualizados = 0, horariosDef = 0, arquivados = 0, modos = 0, reativados = 0;
  const preencher = (c, r) => {
    let mudou = false;
    if (c.provisorio && r.nome) { if (!c.nomeLista) c.nomeLista = c.nome; c.nome = r.nome; c.provisorio = false; mudou = true; }
    for (const k of ['cpf', 'nascimento', 'email', 'telefone', 'telefone2', 'pix', 'valor', 'valorMensal']) if (r[k] && !c[k]) { c[k] = r[k]; mudou = true; }
    if (r.modo && !c.modoPagamento) { c.modoPagamento = r.modo; mudou = true; }
    return mudou;
  };
  for (const { id, r } of m.novos) {
    const c = novoCadastro({ id, nome: r.nome });
    preencher(c, r); cadastros.push(c); salvarCadastro(c); criados++;
  }
  for (const { c, r } of m.completados) if (preencher(c, r)) { salvarCadastro(c); completos++; }
  const alvo = k => {
    const e = m.escolhas[k];
    if (!e || e === 'ignorar') return null;
    if (e === 'novo') {
      if (!idsNovos.has(k)) { const ap = m.nomes.get(k).apelido; const c = novoCadastro({ nome: ap, nomeLista: ap, provisorio: true }); cadastros.push(c); salvarCadastro(c); idsNovos.set(k, c); criados++; }
      return idsNovos.get(k);
    }
    return cadastroDe(e);
  };
  for (const k of m.nomes.keys()) if (m.escolhas[k]) mapa[k] = m.escolhas[k] === 'novo' ? (alvo(k)?.id || '') : m.escolhas[k];
  // O nome curto usado pelo administrativo vira o "Nome na lista da semana", se ainda estiver vazio.
  for (const k of m.nomes.keys()) { const c = alvo(k); if (c && !c.nomeLista && norm(c.nome) !== k) { c.nomeLista = m.nomes.get(k).apelido; salvarCadastro(c); } }
  for (const { id, r } of m.novos) for (const ap of r.apelidos) mapa[norm(ap)] ||= id;
  for (const { c, r } of m.completados) for (const ap of r.apelidos) mapa[norm(ap)] ||= c.id;
  // Presença
  const itens = m.dados.presenca || [];
  const hoje = hojeISO();
  for (const i of itens) {
    const c = alvo(norm(i.apelido));
    if (!c || i.status === 'cancelada' || (!i.status && i.data < hoje)) continue;
    if (i.modo && i.modo !== 'avulso' && !c.modoPagamento) { c.modoPagamento = i.modo; salvarCadastro(c); modos++; }
    const a = atendimentos.find(x => x.pid === c.id && x.data === i.data && (x.hora || '') === i.hora) || atendimentos.find(x => x.pid === c.id && x.data === i.data && !x.hora);
    if (a) {
      if (!a.presenca && i.status) { a.presenca = i.status; if (!a.pagamento && i.data >= m.controleDesde) a.pagamento = pagamentoInicial(i.status); ajustarPagamentoAoStatus(a); salvarAt(a); atAtualizados++; }
      continue;
    }
    const n = { id: crypto.randomUUID(), pid: c.id, data: i.data, hora: i.hora, presenca: i.status, origem: 'lista de presença',
      pagamento: i.data >= m.controleDesde ? pagamentoInicial(i.status) : null, valor: '', criadoEm: agora, atualizadoEm: agora };
    atendimentos.push(n); ajustarPagamentoAoStatus(n); salvarAt(n); atNovos++;
  }
  // Horários fixos a partir da semana mais recente da lista
  if (itens.length) {
    const ultima = itens.map(i => i.data).sort().pop();
    const inicio = somarDias(ultima, -6);
    const porPaciente = new Map();
    for (const i of itens) {
      if (i.data < inicio || i.status === 'cancelada' || i.modo === 'avulso') continue;
      const c = alvo(norm(i.apelido));
      if (c && i.modo && !c.modoPagamento) { c.modoPagamento = i.modo; salvarCadastro(c); modos++; }
      if (!c || horariosDe(c).length) continue;
      const lista = porPaciente.get(c) || [];
      const dia = paraData(i.data).getDay();
      if (!lista.some(h => h.dia === dia && h.hora === i.hora)) lista.push({ dia, hora: i.hora });
      porPaciente.set(c, lista);
    }
    for (const [c, hs] of porPaciente) { c.horarios = hs; salvarCadastro(c); horariosDef++; }
    // Versão 34: quem aparece na lista importada está em atendimento: volta a ficar ativo se estava arquivado.
    const naLista = new Set();
    for (const i of itens) { const c = alvo(norm(i.apelido)); if (c) naLista.add(c.id); }
    for (const id of naLista) { const c = cadastroDe(id); if (c?.arquivado) { c.arquivado = false; salvarCadastro(c); reativados++; const p = pacientes.find(x => x.id === id); if (p?.arquivado) { p.arquivado = false; agendarSalvar('p:' + p.id, p); } } }
    if (m.arquivarInativos) {
      const limite = somarDias(hoje, -60);
      const ativos = new Set([...atendimentos.filter(a => a.data >= limite).map(a => a.pid), ...naLista, ...cadastros.filter(c => (c.horarios || []).length).map(c => c.id)]);
      for (const c of cadastros) if (!c.arquivado && !ativos.has(c.id)) { c.arquivado = true; salvarCadastro(c); arquivados++; }
    }
  }
  // Pagamentos mensais: dia e modo
  for (const i of m.dados.pagamentos || []) {
    const c = alvo(norm(i.apelido));
    if (!c) continue;
    let mudou = false;
    // A lista de pagamentos mensais manda no modo, mas só na primeira vez: depois vale o que for editado no app.
    if (i.dia && !c.diaPagamento) { c.diaPagamento = i.dia; c.modoPagamento = i.modo; mudou = true; }
    else if (!c.modoPagamento) { c.modoPagamento = i.modo; mudou = true; }
    if (mudou) { salvarCadastro(c); modos++; }
  }
  const cfg = driveCfg(); cfg.ultimaAtualizacao = agora;
  salvarPerfil();
  await salvarAgora();
  if (modo === 'dono') { await sincronizarCadastros(); await sincronizarAtendimentos(); await salvarAgora(); }
  importacaoDrive = null;
  await aviso('Importação concluída', [
    `${criados} ${criados === 1 ? 'paciente novo' : 'pacientes novos'}, ${completos} completados.`,
    itens.length ? `${atNovos} atendimentos novos, ${atAtualizados} atualizados, horários fixos definidos para ${horariosDef}.` : '',
    reativados ? `${reativados} ${reativados === 1 ? 'paciente arquivado voltou' : 'pacientes arquivados voltaram'} para os ativos.` : '',
    arquivados ? `${arquivados} sem atendimento nos últimos 60 dias foram arquivados (dá para desarquivar).` : '',
    modos ? `Modo ou dia de pagamento definido em ${modos} cadastros.` : ''].filter(Boolean).join(' '));
  history.replaceState({ tela: 'lista' }, ''); render(history.state);
}

// ---------- Tela de configuração do Drive ----------
async function editarChaveGoogle() {
  const r = await dialogo({
    titulo: 'Chave de conexão (ID do cliente)', texto: 'O texto que termina em .apps.googleusercontent.com, criado no Google Cloud.',
    campos: [{ rotulo: '….apps.googleusercontent.com' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }]
  });
  if (r === null) return;
  if (r.trim() && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(r.trim())) return aviso('Chave não salva', 'Ela precisa terminar em .apps.googleusercontent.com.');
  driveCfg().clientId = r.trim(); tokenGoogle = null; salvarPerfil(); await salvarAgora(); render(history.state);
}
async function editarFonte(k) {
  const r = await dialogo({
    titulo: FONTES_DRIVE[k].nome, texto: 'Cole o link do arquivo. No Drive: toque nos três pontinhos do arquivo → Compartilhar → Copiar link. O acesso pode continuar "Restrito".',
    campos: [{ rotulo: 'https://docs.google.com/…' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }]
  });
  if (r === null) return;
  if (r.trim() && !idDoLink(r.trim())) return aviso('Link não reconhecido', 'Copie o link pelo botão Compartilhar do Drive.');
  driveCfg().fontes[k] = r.trim(); salvarPerfil(); await salvarAgora(); render(history.state);
}
function telaDrive() {
  const cfg = driveCfg();
  carregarGoogle().catch(() => { });
  const linha = (ic, titulo, detalhe, ...controles) => el('div', { class: 'linha-config' }, el('span', { class: 'ic-bolha' }, icone(ic)),
    el('div', { class: 'linha-texto' }, el('p', { text: titulo }), detalhe && el('small', { text: detalhe })), el('div', { class: 'botoes-mini' }, ...controles));
  const pronto = cfg.clientId && Object.values(cfg.fontes || {}).some(idDoLink);
  mostrar(
    cabecalho('Google Drive', { voltar: true, status: true }),
    el('div', { class: 'conteudo pilha' },
      el('button', { type: 'button', class: 'primario com-icone centralizado', disabled: !pronto, onclick: atualizarDoDrive }, icone('retomar'), el('span', { text: 'Atualizar do Drive' })),
      el('p', { class: 'suave pequeno centro', text: cfg.ultimaAtualizacao ? `Última atualização: ${dataBR(cfg.ultimaAtualizacao)}.` : 'Nenhuma atualização ainda.' }),
      el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: 'Arquivos' }),
        Object.entries(FONTES_DRIVE).map(([k, f]) => linha(k === 'presenca' ? 'calendario' : k === 'pacientes' ? 'pessoa' : 'moeda', f.nome,
          idDoLink(cfg.fontes[k]) ? 'Link definido.' : f.dica,
          el('button', { type: 'button', class: 'secundario compacto', text: idDoLink(cfg.fontes[k]) ? 'Trocar' : 'Colar link', onclick: () => editarFonte(k) }),
          el('button', { type: 'button', class: 'secundario compacto', text: 'Arquivo', title: 'Ler de um arquivo escolhido à mão', onclick: () => importarArquivoManual(k) })))),
      el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: 'Sincronização com o outro aparelho' }),
        linha('repetir', 'Pasta compartilhada', cfg.pastaSync ? 'Pasta definida.' : 'Crie uma pasta no Drive, compartilhe com a conta Google do outro aparelho e cole o link aqui.',
          el('button', { type: 'button', class: 'secundario compacto', text: cfg.pastaSync ? 'Trocar' : 'Colar link', onclick: editarPastaSync })),
        el('button', { type: 'button', class: 'primario com-icone centralizado', disabled: !(cfg.clientId && cfg.pastaSync), onclick: sincronizarDrive }, icone('repetir'), el('span', { text: 'Sincronizar agora' })),
        el('p', { class: 'suave pequeno', text: (() => { let u = null; try { u = localStorage.getItem('consultorio-ultima-sync'); } catch { } return u ? `Última sincronização neste aparelho: ${dataBR(u)}, ${new Date(u).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : 'Nenhuma sincronização ainda neste aparelho.'; })() })),
      el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: 'Conexão' }),
        linha('cadeado', 'Chave de conexão do Google', cfg.clientId ? 'Definida.' : 'Falta criar no Google Cloud (uma vez só).',
          el('button', { type: 'button', class: 'secundario compacto', text: cfg.clientId ? 'Trocar' : 'Colar', onclick: editarChaveGoogle }))),
      el('p', { class: 'suave pequeno', text: 'O app só lê estes arquivos, nunca altera nem apaga nada no Drive. A leitura vai direto do aparelho ao Google, sem passar por nenhum outro servidor, e o acesso vale só enquanto o app está aberto.' })));
}

// ---------- Pagamentos vencidos ----------
function vencidos() {
  const hoje = hojeISO(), ym = hoje.slice(0, 7), dia = Number(hoje.slice(8));
  return cadastros.filter(c => !c.arquivado && (c.modoPagamento === 'mensal' || c.modoPagamento === 'quinzenal') && c.diaPagamento && dia > Number(c.diaPagamento)
    && !pagamentos.some(g => g.pid === c.id && g.data.slice(0, 7) === ym))
    .sort((a, b) => Number(a.diaPagamento) - Number(b.diaPagamento));
}
function cartaoVencidos() {
  const vs = vencidos();
  if (!vs.length) return null;
  const cobrar = c => {
    const modelos = [...MODELOS_MSG, ...(perfil.modelos || [])];
    rascunhoMsg[c.id] = { modelo: Math.max(0, modelos.findIndex(x => x.nome === 'Pagamento')), data: '', hora: '', texto: null };
    ir({ tela: 'adm', id: c.id, aba: 'mensagem' });
  };
  return el('section', { class: 'cartao agenda vencidos' },
    el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('moeda')), el('span', { text: `Pagamento do mês em aberto (${vs.length})` })),
    vs.slice(0, 8).map(c => el('div', { class: 'agenda-linha' },
      el('span', { class: 'agenda-hora', text: 'dia ' + c.diaPagamento }),
      el('button', { type: 'button', class: 'agenda-nome', onclick: () => ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }) }, avatar(c), el('span', { text: c.nome })),
      el('button', { type: 'button', class: 'chip acao', text: 'Cobrar', onclick: () => cobrar(c) }))),
    vs.length > 8 && el('button', { type: 'button', class: 'link', text: 'Ver todos no mês', onclick: () => ir({ tela: 'mes' }) }));
}

// ---------- Início ----------
(async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.SEM_SW) navigator.serviceWorker.register('sw.js').catch(() => { });
  Object.assign(config, await Cofre.lerConfig());
  if (await Cofre.existe()) telaBloqueio();
  else telaCriacao();
})();

// =====================================================================
// Versão 11: agenda com séries (até 30 sessões), sessões avulsas, cancelar e remarcar um dia,
// feriados calculados no próprio aparelho (sem internet) e aviso 5 dias antes.
// Os horários ficam no cadastro administrativo: horarios[] = { dia, hora, inicio?, sessoes?, freq?, fim? }.
// Horário sem "inicio" é um horário fixo sem data final (como nas versões anteriores).
// =====================================================================
const DIAS_AVISO_FERIADO = 5;
const MAX_SESSOES_SERIE = 30;
const DIAS_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaDaSemana = ymd => paraData(ymd).getDay();
const dataComDia = ymd => `${DIAS[diaDaSemana(ymd)]}, ${dataCurta(ymd).slice(0, 5)}`;

function pascoa(ano) { // algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const feriadosCache = new Map();
function feriadosDoAno(ano) {
  if (feriadosCache.has(ano)) return feriadosCache.get(ano);
  const p = pascoa(ano);
  const fixo = (md, id, nome, tipo, padrao = true) => ({ id, data: `${ano}-${md}`, nome, tipo, padrao });
  const movel = (n, id, nome, tipo, padrao = true) => ({ id, data: somarDias(p, n), nome, tipo, padrao });
  const lista = [
    fixo('01-01', 'ano-novo', 'Confraternização Universal', 'Nacional'),
    fixo('01-20', 'sao-sebastiao', 'São Sebastião', 'Municipal (Rio)'),
    movel(-48, 'carnaval-seg', 'Carnaval (segunda-feira)', 'Ponto facultativo'),
    movel(-47, 'carnaval-ter', 'Carnaval (terça-feira)', 'Ponto facultativo'),
    movel(-46, 'cinzas', 'Quarta-feira de Cinzas', 'Ponto facultativo', false),
    movel(-2, 'sexta-santa', 'Sexta-feira Santa', 'Nacional'),
    fixo('04-21', 'tiradentes', 'Tiradentes', 'Nacional'),
    fixo('04-23', 'sao-jorge', 'São Jorge', 'Estadual (RJ)'),
    fixo('05-01', 'trabalho', 'Dia do Trabalho', 'Nacional'),
    movel(60, 'corpus-christi', 'Corpus Christi', 'Municipal (Rio)'),
    fixo('09-07', 'independencia', 'Independência do Brasil', 'Nacional'),
    fixo('10-12', 'aparecida', 'Nossa Senhora Aparecida', 'Nacional'),
    fixo('11-02', 'finados', 'Finados', 'Nacional'),
    fixo('11-15', 'republica', 'Proclamação da República', 'Nacional'),
    fixo('11-20', 'consciencia-negra', 'Zumbi e Consciência Negra', 'Nacional'),
    fixo('12-25', 'natal', 'Natal', 'Nacional')
  ].sort((x, y) => x.data.localeCompare(y.data));
  feriadosCache.set(ano, lista);
  return lista;
}
const cfgAgenda = () => {
  const a = (perfil.agenda ||= {});
  a.feriados ||= {}; a.folgas ||= []; a.avisados ||= {};
  return a;
};
const feriadoAtivo = fr => { const v = cfgAgenda().feriados[fr.id]; return v === undefined ? fr.padrao : !!v; };
function diaSemAtendimento(ymd) {
  const fr = feriadosDoAno(Number(ymd.slice(0, 4))).find(x => x.data === ymd && feriadoAtivo(x));
  if (fr) return { nome: fr.nome, feriado: true };
  const fo = cfgAgenda().folgas.find(f => f.de && ymd >= f.de && ymd <= (f.ate || f.de));
  return fo ? { nome: fo.nome || 'Sem atendimento', feriado: false } : null;
}
function primeiroDiaNaSemana(desde, dia) {
  let d = desde;
  for (let i = 0; i < 7 && diaDaSemana(d) !== Number(dia); i++) d = somarDias(d, 1);
  return d;
}
const cancelado = (c, data, hora) => (c.excecoes || []).some(x => x.data === data && (x.hora || '') === (hora || ''));

// Todas as datas de uma série com início. A sessão que cai em feriado ou folga não conta:
// a série se estende para manter o número de sessões.
function datasSerie(c, h, hi) {
  const out = [];
  if (!h.inicio) return out;
  const passo = 7 * (Number(h.freq) === 2 ? 2 : 1), total = Math.max(1, Number(h.sessoes) || 1);
  let d = primeiroDiaNaSemana(h.inicio, h.dia), n = 0, guarda = 0;
  while (n < total && guarda++ < 300) {
    if (h.fim && d >= h.fim) break;
    const sem = diaSemAtendimento(d);
    out.push({ c, data: d, hora: h.hora || '', hi, feriado: sem?.nome || null, cancelada: cancelado(c, d, h.hora) });
    if (!sem) n++;
    d = somarDias(d, passo);
  }
  return out;
}
// Ocorrências (séries, horários fixos e avulsas) de um paciente num período, em ordem.
function ocorrenciasNoPeriodo(c, de, ate) {
  const out = [];
  horariosDe(c).forEach((h, hi) => {
    if (h.inicio) { for (const o of datasSerie(c, h, hi)) if (o.data >= de && o.data <= ate) out.push(o); return; }
    if (h.dia === undefined || h.dia === '') return;
    for (let d = primeiroDiaNaSemana(de, h.dia); d <= ate; d = somarDias(d, 7)) {
      if (h.fim && d >= h.fim) break;
      out.push({ c, data: d, hora: h.hora || '', hi, fixo: true, feriado: diaSemAtendimento(d)?.nome || null, cancelada: cancelado(c, d, h.hora) });
    }
  });
  for (const a of c.avulsos || []) if (a.data >= de && a.data <= ate)
    out.push({ c, data: a.data, hora: a.hora || '', avulsa: a.id, feriadoAviso: diaSemAtendimento(a.data)?.nome || null, cancelada: cancelado(c, a.data, a.hora) });
  return out.sort((x, y) => x.data.localeCompare(y.data) || x.hora.localeCompare(y.hora));
}
const temAgenda = c => horariosDe(c).length > 0 || (c.avulsos || []).length > 0;

function agendaDoDia(ymd, comDesmarcadas = false) {
  const itens = [];
  for (const c of cadastros) {
    if (c.arquivado) continue;
    for (const o of ocorrenciasNoPeriodo(c, ymd, ymd)) if (!o.feriado && (!o.cancelada || (comDesmarcadas && atDaOcorrencia(c, ymd, o.hora)?.presenca))) itens.push({ c, hora: o.hora, o });
  }
  return itens.sort((a, b) => a.hora.localeCompare(b.hora) || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
}

// Resumo de uma série para o perfil do paciente.
function resumoSerie(c, h, hi) {
  const freq = Number(h.freq) === 2 ? 'a cada 15 dias' : 'toda semana';
  const base = `${DIAS[h.dia]}, ${horaCurta(h.hora) || 'sem horário'}`;
  if (!h.inicio) return { texto: `${base}, ${freq === 'toda semana' ? 'toda semana' : freq}, sem data final${h.fim ? ` (encerrado em ${dataCurta(h.fim)})` : ''}`, restantes: null };
  const lista = datasSerie(c, h, hi).filter(o => !o.feriado);
  const hoje = hojeISO();
  const futuras = lista.filter(o => o.data >= hoje && !o.cancelada);
  const ultima = lista[lista.length - 1]?.data;
  return {
    texto: `${base}, ${freq}. ${futuras.length} de ${lista.length} ${lista.length === 1 ? 'sessão restante' : 'sessões restantes'}${ultima ? `, até ${dataCurta(ultima)}` : ''}.`,
    restantes: futuras.length, ultima
  };
}

// ---------- Avisos: feriado nos próximos 5 dias e séries terminando ----------
function feriadosProximos() {
  const hoje = hojeISO(), cfg = cfgAgenda(), res = [];
  for (let n = 0; n <= DIAS_AVISO_FERIADO; n++) {
    const d = somarDias(hoje, n), sem = diaSemAtendimento(d);
    if (!sem || cfg.avisados[d]) continue;
    const afetados = [];
    for (const c of cadastros) {
      if (c.arquivado) continue;
      const o = ocorrenciasNoPeriodo(c, d, d).find(x => (x.feriado || x.feriadoAviso) && !x.cancelada);
      if (o) afetados.push({ c, o });
    }
    if (afetados.length) res.push({ data: d, nome: sem.nome, afetados });
  }
  return res;
}
function seriesTerminando() {
  const res = [];
  for (const c of cadastros) {
    if (c.arquivado) continue;
    horariosDe(c).forEach((h, hi) => {
      if (!h.inicio || h.fim || h.renovacaoDispensada) return;
      const r = resumoSerie(c, h, hi);
      if (r.restantes !== null && r.restantes > 0 && r.restantes <= 2) res.push({ c, h, hi, r });
    });
  }
  return res;
}
const temAvisoAgenda = () => feriadosProximos().length > 0 || seriesTerminando().length > 0 || combinarPendentes().length > 0;

function mensagemFeriado(c, data, nome) {
  const prox = ocorrenciasNoPeriodo(c, somarDias(data, 1), somarDias(data, 45)).find(o => !o.feriado && !o.cancelada);
  const quando = `${DIAS_LONGO[diaDaSemana(data)]}, ${dataCurta(data).slice(0, 5)}`;
  return `Olá, ${primeiroNome(c.nome)}! Passando para avisar que ${quando}, é feriado (${nome}) e não teremos sessão.` +
    (prox ? ` Nos vemos ${DIAS_LONGO[diaDaSemana(prox.data)]}, ${dataCurta(prox.data).slice(0, 5)}${prox.hora ? `, às ${horaCurta(prox.hora)}` : ''}.` : '');
}
async function avisarFeriado(f) {
  const itens = f.afetados.map(({ c }) => {
    const n = numeroWhats(c.telefone);
    const b = el('button', { type: 'button', class: 'secundario com-icone', disabled: !n }, icone('mensagem'), el('span', { text: n ? `Avisar ${c.nome}` : `${c.nome}: sem celular no cadastro` }));
    if (n) b.addEventListener('click', () => { b.classList.add('marcado'); b.lastChild.textContent = `Aberto: ${c.nome}`; abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(mensagemFeriado(c, f.data, f.nome))}`); });
    return b;
  });
  const r = await janela(`Avisar sobre ${dataComDia(f.data)}`,
    [el('p', { class: 'suave pequeno', text: 'Cada botão abre o WhatsApp com a mensagem pronta. Depois de enviar, volte para o app.' }), el('div', { class: 'pilha-pequena' }, itens)],
    [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Pronto, todos avisados', valor: true, estilo: 'primario' }]);
  if (r) marcarAvisado(f.data);
}
function marcarAvisado(data) {
  cfgAgenda().avisados[data] = true;
  salvarPerfil(); render(history.state);
}
async function renovarSerie(c, h) {
  const r = await dialogo({ titulo: `Renovar a série de ${primeiroNome(c.nome)}`, texto: `Quantas sessões a mais? (1 a ${MAX_SESSOES_SERIE})`,
    campos: [{ rotulo: 'Número de sessões', tipo: 'number' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Renovar', valor: true, estilo: 'primario' }] });
  const n = Math.round(Number(r));
  if (!r || !n || n < 1) return;
  h.sessoes = (Number(h.sessoes) || 0) + Math.min(n, MAX_SESSOES_SERIE);
  delete h.renovacaoDispensada;
  salvarCadastro(c); render(history.state);
}
function dispensarRenovacao(c, h) { h.renovacaoDispensada = true; salvarCadastro(c); render(history.state); }

// Faixas de aviso no alto da tela inicial.
function cartaoAvisosAgenda() {
  const fs = feriadosProximos(), ss = seriesTerminando(), cs = combinarPendentes();
  if (!fs.length && !ss.length && !cs.length) return null;
  const forte = 'border-left:5px solid #c62828';
  return el('div', { class: 'pilha-pequena' },
    fs.map(f => el('div', { class: 'faixa', style: forte, role: 'alert' },
      el('p', {}, el('strong', { text: `⚠️ ${dataComDia(f.data)}: ${f.nome}` })),
      el('p', { text: `${f.afetados.length} ${f.afetados.length === 1 ? 'paciente seria atendido' : 'pacientes seriam atendidos'} nesse dia: ${listaNatural(f.afetados.map(a => a.c.nome))}. As sessões dessas séries passam para o fim.` }),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'primario compacto', text: 'Avisar pelo WhatsApp', onclick: () => avisarFeriado(f) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Ok, já avisei', onclick: () => marcarAvisado(f.data) })))),
    ss.map(({ c, h, r }) => el('div', { class: 'faixa' },
      el('p', {}, el('strong', { text: `Série de ${c.nome} terminando` })),
      el('p', { text: `${r.restantes === 1 ? 'Falta 1 sessão' : `Faltam ${r.restantes} sessões`} (${DIAS[h.dia]}, ${horaCurta(h.hora)}), a última em ${dataCurta(r.ultima)}.` }),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'primario compacto', text: 'Renovar', onclick: () => renovarSerie(c, h) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Não renovar', onclick: () => dispensarRenovacao(c, h) })))),
    cs.map(x => el('div', { class: 'faixa', style: 'border-left:5px solid #1565c0' },
      el('p', {}, el('strong', { text: x.titulo })),
      el('p', { text: x.texto }),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'primario compacto', text: x.mes ? 'Marcar os dias' : 'Marcar horários', onclick: () => { agendamentoRasc = null; ir({ tela: 'agendar', id: x.c.id }); } }),
        numeroWhats(x.c.telefone) && el('button', { type: 'button', class: 'secundario compacto', text: 'WhatsApp', onclick: () => abrirExterno(`https://wa.me/${numeroWhats(x.c.telefone)}`) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Já combinei', onclick: () => { (x.c.combinado ||= {})[x.chave] = true; salvarCadastro(x.c); render(history.state); } })))));
}
// Ícone da agenda no cabeçalho, com ponto vermelho quando há aviso pendente.
function botaoAgenda() {
  const b = botaoIcone('Agenda', 'calendario', () => ir({ tela: 'agenda' }));
  if (temAvisoAgenda()) {
    b.style.position = 'relative';
    b.append(el('span', { 'aria-label': 'Aviso pendente', style: 'position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;background:#d32f2f;border:2px solid #fff' }));
  }
  return b;
}

// ---------- Tela da agenda (semana) ----------
const segundaDaSemana = ymd => somarDias(ymd, -((diaDaSemana(ymd) + 6) % 7));
function telaAgenda(inicio) {
  const seg = segundaDaSemana(inicio || hojeISO()), hoje = hojeISO(), dom = somarDias(seg, 6);
  const ocs = cadastros.filter(c => !c.arquivado).flatMap(c => ocorrenciasNoPeriodo(c, seg, dom));
  const fmt = d => paraData(d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const dias = [0, 1, 2, 3, 4, 5, 6].map(i => somarDias(seg, i));
  const blocos = dias.map(d => {
    const sem = diaSemAtendimento(d);
    const doDia = ocs.filter(o => o.data === d).sort((a, b) => a.hora.localeCompare(b.hora) || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
    if (diaDaSemana(d) === 0 && !doDia.length && !sem) return null;
    return el('section', { class: 'cartao' + (d === hoje ? ' destaque' : '') },
      el('button', { type: 'button', class: 'cartao-titulo dia-botao', 'aria-label': `Opções de ${DIAS[diaDaSemana(d)]}, ${dataCurta(d).slice(0, 5)}`, onclick: () => acoesDiaAgenda(d) },
        el('span', { class: 'ic-bolha' }, icone('calendario')),
        el('span', { text: `${DIAS[diaDaSemana(d)]}, ${dataCurta(d).slice(0, 5)}${d === hoje ? ' (hoje)' : ''}` }),
        el('span', { class: 'dia-mais', 'aria-hidden': 'true', text: '+' })),
      sem && el('p', { class: 'faixa', text: `${sem.feriado ? 'Feriado' : 'Sem atendimento'}: ${sem.nome}` }),
      doDia.length ? doDia.map(o => {
        const riscado = o.feriado || o.cancelada;
        const etiqueta = o.cancelada ? 'Cancelada' : o.feriado ? 'Feriado: vai para o fim da série' : o.avulsa ? (freqDe(o.c).startsWith('variavel') ? 'Combinado' : 'Avulsa') : o.fixo ? 'Horário fixo' : 'Série';
        return el('button', { type: 'button', class: 'pag-linha linha-botao', onclick: () => acoesOcorrencia(o) },
          el('span', { class: 'pag-info' },
            el('strong', { style: riscado ? 'text-decoration:line-through;opacity:.6' : null, text: `${horaCurta(o.hora) || '—'}  ${o.c.nome}` }),
            el('span', { class: 'suave', text: etiqueta + (o.feriadoAviso ? ` · atenção: ${o.feriadoAviso}` : '') + (!riscado && estadoConfirmacao(o.c, o.data, o.hora) ? ' · ' + ROTULO_CONF[estadoConfirmacao(o.c, o.data, o.hora)] : '') })));
      }) : el('button', { type: 'button', class: 'link', text: 'Nenhum atendimento. Toque para agendar neste dia.', onclick: () => acoesDiaAgenda(d) }));
  });
  mostrar(
    cabecalho('Agenda', { voltar: true, sub: `${fmt(seg)} a ${fmt(dom)}`, acoes: [botaoIcone('Feriados e dias sem atendimento', 'ajustes', () => ir({ tela: 'feriados' }))] }),
    el('div', { class: 'conteudo pilha' },
      cartaoAvisosAgenda(),
      segmentoEscolha({ semana: 'Semana', lista: 'Lista', mes: 'Mês' }, 'semana', k => { if (k === 'mes') ir({ tela: 'agendaMes', ym: seg.slice(0, 7) }, false); if (k === 'lista') ir({ tela: 'listaSemana', semana: seg }, false); }),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'secundario compacto', text: '‹ Semana anterior', onclick: () => ir({ tela: 'agenda', semana: somarDias(seg, -7) }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Hoje', onclick: () => ir({ tela: 'agenda' }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Próxima ›', onclick: () => ir({ tela: 'agenda', semana: somarDias(seg, 7) }, false) })),
      ...blocos,
      el('button', { type: 'button', class: 'link', text: 'Feriados e dias sem atendimento', onclick: () => ir({ tela: 'feriados' }) })),
    el('button', { type: 'button', class: 'fab estendido', onclick: () => { agendamentoRasc = null; ir({ tela: 'agendar' }); } }, icone('mais'), el('span', { text: 'Novo agendamento' })));
}

async function acoesOcorrencia(o) {
  const c = o.c, h = o.hi !== undefined ? horariosDe(c)[o.hi] : null;
  const botoes = [{ rotulo: 'Fechar', valor: null }];
  if (o.cancelada) botoes.push({ rotulo: 'Desfazer cancelamento', valor: 'desfazer' });
  else if (!o.feriado) {
    botoes.push({ rotulo: 'Remarcar este dia', valor: 'remarcar' });
    botoes.push({ rotulo: o.avulsa ? 'Excluir este agendamento' : 'Cancelar este dia', valor: o.avulsa ? 'excluir' : 'cancelar' });
  }
  if (h) botoes.push({ rotulo: 'Encerrar a série a partir daqui', valor: 'encerrar' });
  botoes.push({ rotulo: 'Abrir paciente', valor: 'abrir', estilo: 'primario' });
  const info = o.avulsa ? 'Sessão avulsa.' : h ? resumoSerie(c, h, o.hi).texto : '';
  const r = await janela(c.nome, [el('p', { text: `${dataComDia(o.data)}${o.hora ? ', ' + horaCurta(o.hora) : ''}` }), info && el('p', { class: 'suave pequeno', text: info }),
    o.feriado && el('p', { class: 'faixa', text: `${o.feriado}: não haverá sessão, e ela passa para o fim da série.` })], botoes);
  if (!r) return;
  if (r === 'abrir') return ir(modo === 'dono' ? { tela: 'ficha', id: c.id, aba: 'retomar' } : { tela: 'adm', id: c.id, aba: 'atendimentos' });
  if (r === 'cancelar') { (c.excecoes ||= []).push({ data: o.data, hora: o.hora }); }
  if (r === 'desfazer') { c.excecoes = (c.excecoes || []).filter(x => !(x.data === o.data && (x.hora || '') === (o.hora || ''))); }
  if (r === 'excluir') { c.avulsos = (c.avulsos || []).filter(a => a.id !== o.avulsa); }
  if (r === 'encerrar') {
    const ok = await dialogo({ titulo: 'Encerrar a série?', texto: `As sessões de ${primeiroNome(c.nome)} deixam de aparecer a partir de ${dataCurta(o.data)}, inclusive. As anteriores ficam como estão.`,
      botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Encerrar', valor: true, estilo: 'perigo' }] });
    if (!ok) return;
    h.fim = o.data;
  }
  if (r === 'remarcar') {
    const v = await dialogo({ titulo: 'Remarcar este dia', texto: `Nova data e horário para a sessão de ${dataComDia(o.data)}.`,
      campos: [{ rotulo: 'Nova data', tipo: 'date' }, { rotulo: 'Novo horário', tipo: 'time' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Remarcar', valor: true, estilo: 'primario' }] });
    if (!v || !v[0]) return;
    if (o.avulsa) c.avulsos = (c.avulsos || []).filter(a => a.id !== o.avulsa);
    else (c.excecoes ||= []).push({ data: o.data, hora: o.hora });
    (c.avulsos ||= []).push({ id: crypto.randomUUID(), data: v[0], hora: v[1] || o.hora, remarcadaDe: o.data });
  }
  salvarCadastro(c); render(history.state);
}

// ---------- Novo agendamento ----------
let agendamentoRasc = null;
function telaAgendar(pid) {
  const r = agendamentoRasc ||= { pid: pid || '', data: hojeISO(), hora: '', repetir: 'semanal', sessoes: String(MAX_SESSOES_SERIE), extras: [] };
  if (pid && !r.pid) r.pid = pid;
  r.extras ||= [];
  if (!r.ajustado && r.pid) { // o padrão segue a frequência do paciente
    const f = freqDe(cadastroDe(r.pid) || {});
    r.repetir = f === 'quinzenal' ? 'quinzenal' : f.startsWith('variavel') ? 'varios' : 'semanal';
    r.ajustado = true;
  }
  const ativos = cadastros.filter(c => !c.arquivado).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const previa = el('p', { class: 'suave' });
  const desenharPrevia = () => {
    const c = cadastroDe(r.pid);
    if (!c || !r.data) { previa.textContent = 'Escolha o paciente e a data.'; return; }
    const conf = conflitosDoRascunho(r);
    const aviso = conf.length ? ` ⚠️ Horário ocupado: ${conf.slice(0, 3).map(o => `${dataCurta(o.data).slice(0, 5)} ${horaCurta(o.hora)} (${o.c.nome})`).join('; ')}${conf.length > 3 ? ` e mais ${conf.length - 3}` : ''}.` : '';
    if (r.repetir === 'nao' || r.repetir === 'varios') {
      const ds = datasDoRascunho(r);
      previa.textContent = (ds.length === 1 ? `Sessão em ${dataComDia(ds[0].data)}${ds[0].hora ? ', ' + horaCurta(ds[0].hora) : ''}.` : `${ds.length} sessões: ${ds.map(d => dataCurta(d.data).slice(0, 5) + (d.hora ? ' ' + horaCurta(d.hora) : '')).join(', ')}.`) +
        ds.filter(d => diaSemAtendimento(d.data)).map(d => ` Atenção: ${dataCurta(d.data).slice(0, 5)} é ${diaSemAtendimento(d.data).nome}.`).join('') + aviso;
      return;
    }
    const n = Math.min(MAX_SESSOES_SERIE, Math.max(1, Math.round(Number(r.sessoes)) || 1));
    const h = { dia: diaDaSemana(r.data), hora: r.hora, inicio: r.data, sessoes: n, freq: r.repetir === 'quinzenal' ? 2 : 1 };
    const lista = datasSerie(c, h, -1), puladas = lista.filter(o => o.feriado);
    const ultima = lista.filter(o => !o.feriado).pop()?.data;
    previa.textContent = `${n} ${n === 1 ? 'sessão' : 'sessões'}, ${DIAS[h.dia].toLowerCase()}${r.hora ? ' às ' + horaCurta(r.hora) : ''}, ${h.freq === 2 ? 'a cada 15 dias' : 'toda semana'}, de ${dataCurta(r.data)} até ${ultima ? dataCurta(ultima) : '—'}.` +
      (puladas.length ? ` ${puladas.length === 1 ? 'Um feriado foi pulado' : `${puladas.length} feriados foram pulados`} (${puladas.map(o => dataCurta(o.data).slice(0, 5)).join(', ')}); a série foi estendida.` : '') + aviso;
  };
  const sel = el('select', { 'aria-label': 'Paciente' }, el('option', { value: '', text: 'Escolha o paciente' }),
    el('option', { value: '__novo', text: '+ Paciente que não está na lista (escrever o nome)' }), ativos.map(c => el('option', { value: c.id, text: c.nome })));
  sel.value = r.pid;
  sel.addEventListener('change', async () => {
    if (sel.value === '__novo') {
      const c = await pacienteRapido();
      sel.value = r.pid;
      if (!c) return;
      r.pid = c.id; r.ajustado = false; telaAgendar(); return;
    }
    r.pid = sel.value; r.ajustado = false; telaAgendar();
  });
  const campoSessoes = el('label', { class: 'campo', hidden: r.repetir === 'nao' || r.repetir === 'varios' }, el('span', { text: `Número de sessões (1 a ${MAX_SESSOES_SERIE})` }),
    el('input', { type: 'number', min: '1', max: String(MAX_SESSOES_SERIE), inputmode: 'numeric', value: r.sessoes, oninput: e => { r.sessoes = e.target.value; desenharPrevia(); } }));
  const listaExtras = el('div', { class: 'pilha-pequena', hidden: r.repetir !== 'varios' });
  const desenharExtras = () => listaExtras.replaceChildren(
    ...r.extras.map((x, i) => el('div', { class: 'grade duas' },
      el('label', { class: 'campo' }, el('span', { text: `Dia ${i + 2}` }), el('input', { type: 'date', value: x.data, onchange: e => { x.data = e.target.value; desenharPrevia(); } })),
      el('label', { class: 'campo' }, el('span', { text: 'Horário' }), el('input', { type: 'time', value: x.hora, onchange: e => { x.hora = e.target.value; desenharPrevia(); } })))),
    el('button', { type: 'button', class: 'link com-icone', onclick: () => { const ult = r.extras[r.extras.length - 1] || { data: r.data, hora: r.hora }; r.extras.push({ data: ult.data ? somarDias(ult.data, 7) : '', hora: ult.hora || r.hora }); desenharExtras(); desenharPrevia(); } }, icone('mais'), el('span', { text: 'Adicionar outro dia' })),
    r.extras.length ? el('button', { type: 'button', class: 'link', text: 'Remover o último dia', onclick: () => { r.extras.pop(); desenharExtras(); desenharPrevia(); } }) : null);
  desenharExtras();
  const repetir = segmentoEscolha({ nao: 'Uma vez', varios: 'Vários dias', semanal: 'Semanal', quinzenal: 'Quinzenal' }, r.repetir, k => { r.repetir = k; campoSessoes.hidden = k === 'nao' || k === 'varios'; listaExtras.hidden = k !== 'varios'; desenharPrevia(); }, 'quatro');
  mostrar(
    cabecalho('Novo agendamento', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      cartao('Paciente', 'pessoa', el('label', { class: 'campo' }, el('span', { text: 'Paciente' }), sel),
        !ativos.length && el('p', { class: 'suave pequeno', text: 'Cadastre o paciente primeiro, pelo botão + da tela inicial.' })),
      cartao('Quando', 'calendario', el('div', { class: 'grade duas' },
        el('label', { class: 'campo' }, el('span', { text: 'Primeira sessão' }), el('input', { type: 'date', value: r.data, onchange: e => { r.data = e.target.value; desenharPrevia(); } })),
        el('label', { class: 'campo' }, el('span', { text: 'Horário' }), el('input', { type: 'time', value: r.hora, onchange: e => { r.hora = e.target.value; desenharPrevia(); } })))),
      cartao('Repetir', 'retomar', repetir, campoSessoes, listaExtras),
      cartao('Resumo', 'texto', previa)),
    el('button', { type: 'button', class: 'fab estendido', onclick: salvarAgendamento }, icone('calendario'), el('span', { text: 'Agendar' })));
  desenharPrevia();
}
async function salvarAgendamento() {
  const r = agendamentoRasc, c = r && cadastroDe(r.pid);
  if (!c) return aviso('Falta o paciente', 'Escolha o paciente.');
  if (!r.data) return aviso('Falta a data', 'Escolha a data da primeira sessão.');
  if (!r.hora) return aviso('Falta o horário', 'Escolha o horário da sessão.');
  const conf = conflitosDoRascunho(r);
  if (conf.length) {
    const ok = await dialogo({ titulo: 'Horário ocupado', texto: conf.slice(0, 6).map(o => `${dataComDia(o.data)}, ${horaCurta(o.hora)}: ${o.c.nome}`).join('\n') + (conf.length > 6 ? `\n… e mais ${conf.length - 6}.` : ''),
      botoes: [{ rotulo: 'Voltar', valor: null }, { rotulo: 'Agendar mesmo assim', valor: true, estilo: 'primario' }] });
    if (!ok) return;
  }
  if (r.repetir === 'nao' || r.repetir === 'varios') {
    for (const d of datasDoRascunho(r)) (c.avulsos ||= []).push({ id: crypto.randomUUID(), data: d.data, hora: d.hora });
  }
  else {
    const n = Math.min(MAX_SESSOES_SERIE, Math.max(1, Math.round(Number(r.sessoes)) || 1));
    (c.horarios ||= []).push({ dia: diaDaSemana(r.data), hora: r.hora, inicio: r.data, sessoes: n, freq: r.repetir === 'quinzenal' ? 2 : 1 });
  }
  salvarCadastro(c); await salvarAgora();
  agendamentoRasc = null;
  history.back();
}

// ---------- Feriados e dias sem atendimento ----------
function telaFeriados(ano) {
  ano = Number(ano) || Number(hojeISO().slice(0, 4));
  const cfg = cfgAgenda();
  const lista = feriadosDoAno(ano).map(fr => el('label', { class: 'marcar largo' },
    el('input', { type: 'checkbox', checked: feriadoAtivo(fr), onchange: e => { cfg.feriados[fr.id] = e.target.checked; salvarPerfil(); } }),
    el('span', { text: `${dataCurta(fr.data).slice(0, 5)} (${diaSemana(fr.data)}) · ${fr.nome} · ${fr.tipo}` })));
  const nova = { de: '', ate: '', nome: '' };
  const folgas = cfg.folgas.slice().sort((a, b) => (a.de || '').localeCompare(b.de || '')).map(f => el('div', { class: 'pag-linha' },
    el('span', { class: 'pag-info' }, el('strong', { text: f.nome || 'Sem atendimento' }),
      el('span', { class: 'suave', text: f.ate && f.ate !== f.de ? `${dataCurta(f.de)} a ${dataCurta(f.ate)}` : dataCurta(f.de) })),
    botaoIcone('Remover', 'lixeira', () => { cfg.folgas = cfg.folgas.filter(x => x !== f); salvarPerfil(); telaFeriados(ano); })));
  mostrar(
    cabecalho('Feriados e dias sem atendimento', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'secundario compacto', text: `‹ ${ano - 1}`, onclick: () => telaFeriados(ano - 1) }),
        el('strong', { text: String(ano) }),
        el('button', { type: 'button', class: 'secundario compacto', text: `${ano + 1} ›`, onclick: () => telaFeriados(ano + 1) })),
      cartao(`Feriados de ${ano}`, 'calendario',
        el('p', { class: 'suave pequeno', text: 'Marcados: não há sessão, e a sessão da série passa para o fim. As datas são calculadas no próprio aparelho. Para conferir, as fontes oficiais são a portaria anual do governo federal e o decreto da Prefeitura do Rio.' }),
        el('div', { class: 'grade' }, lista)),
      cartao('Suas datas (férias, recesso, congressos)', 'pessoa',
        folgas.length ? folgas : el('p', { class: 'suave pequeno', text: 'Nenhuma data cadastrada.' }),
        el('div', { class: 'grade duas' },
          el('label', { class: 'campo' }, el('span', { text: 'De' }), el('input', { type: 'date', onchange: e => { nova.de = e.target.value; } })),
          el('label', { class: 'campo' }, el('span', { text: 'Até (opcional)' }), el('input', { type: 'date', onchange: e => { nova.ate = e.target.value; } }))),
        el('label', { class: 'campo' }, el('span', { text: 'Descrição' }), el('input', { type: 'text', placeholder: 'Ex.: férias', oninput: e => { nova.nome = e.target.value; } })),
        el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => {
          if (!nova.de) return aviso('Falta a data', 'Escolha ao menos a data inicial.');
          cfg.folgas.push({ id: crypto.randomUUID(), de: nova.de, ate: nova.ate && nova.ate >= nova.de ? nova.ate : nova.de, nome: nova.nome.trim() });
          salvarPerfil(); telaFeriados(ano);
        } }, icone('mais'), el('span', { text: 'Adicionar' }))),
      el('p', { class: 'suave pequeno', text: `O aviso aparece na tela inicial ${DIAS_AVISO_FERIADO} dias antes de cada feriado ou data sem atendimento em que haja pacientes agendados.` })));
}

// ---------- Versão 12: enviar a nota fiscal ao paciente pelo WhatsApp ----------
// O Android exige escolher o contato quando se envia um arquivo; a mensagem vai junto e também fica copiada.
function mensagemNota(c, d, g) {
  const numero = (g?.nf?.numero || '').trim();
  const ref = g?.data ? nomeMes(g.data.slice(0, 7)).toLowerCase() : '';
  return `Olá, ${primeiroNome(c.nome)}! Segue a nota fiscal${numero ? ' nº ' + numero : ''}${ref ? ` referente às sessões de ${ref}` : ''}. Qualquer dúvida, estou à disposição.`;
}
async function enviarNotaWhatsApp(c, d, g) {
  const texto = mensagemNota(c, d, g);
  try { await navigator.clipboard?.writeText(texto); } catch { }
  const ok = await dialogo({ titulo: `Enviar para ${c.nome}`,
    texto: `Vai abrir a lista de compartilhamento: escolha o WhatsApp e depois ${primeiroNome(c.nome)}. A mensagem vai junto; se não aparecer, é só colar, porque ela já está copiada.`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Abrir WhatsApp', valor: true, estilo: 'primario' }] });
  if (!ok) return;
  let bytes;
  try { bytes = await lerConteudo(d); } catch { return aviso('Arquivo não encontrado', 'Não consegui abrir a nota guardada.'); }
  const arquivo = new File([bytes], d.nome || 'nota-fiscal.pdf', { type: d.mime || 'application/pdf' });
  const dados = { files: [arquivo], text: texto, title: d.descricao || 'Nota fiscal' };
  const podeComTexto = navigator.canShare?.(dados);
  if (podeComTexto || navigator.canShare?.({ files: [arquivo] })) {
    liberarSaidaTemporaria();
    try { await navigator.share(podeComTexto ? dados : { files: [arquivo], title: dados.title }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await salvarNoAparelho(d, bytes);
  const n = numeroWhats(c.telefone);
  if (n) abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(texto)}`);
  aviso('Nota salva no aparelho', 'Não deu para anexar direto. A nota foi salva nos Downloads: no WhatsApp, toque no clipe e anexe o arquivo.');
}

// ---------- Versão 13: agenda do mês ----------
function telaAgendaMes(ym) {
  ym = ym || hojeISO().slice(0, 7);
  const hoje = hojeISO(), primeiro = ym + '-01';
  const inicio = segundaDaSemana(primeiro);
  const ultimoDoMes = somarDias(somarMeses(ym, 1) + '-01', -1);
  const fim = somarDias(segundaDaSemana(ultimoDoMes), 6);
  const ocs = cadastros.filter(c => !c.arquivado).flatMap(c => ocorrenciasNoPeriodo(c, inicio, fim));
  const validas = d => ocs.filter(o => o.data === d && !o.feriado && !o.cancelada).sort((a, b) => a.hora.localeCompare(b.hora) || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
  let totalMes = 0, feriadosMes = 0;
  const celulas = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
    const doMes = d.slice(0, 7) === ym, sem = diaSemAtendimento(d), lista = validas(d);
    if (doMes) { totalMes += lista.length; if (sem) feriadosMes++; }
    const estilo = ['min-height:58px', 'padding:4px 5px', 'border-radius:10px', 'text-align:left', 'display:flex', 'flex-direction:column', 'gap:2px',
      'border:' + (d === hoje ? '2px solid currentColor' : '1px solid rgba(128,128,128,.25)'),
      'background:' + (sem ? 'rgba(198,40,40,.12)' : 'transparent'), doMes ? '' : 'opacity:.35'].filter(Boolean).join(';');
    celulas.push(el('button', { type: 'button', style: estilo, 'aria-label': `${dataComDia(d)}: ${sem ? sem.nome + '. ' : ''}${lista.length} ${lista.length === 1 ? 'sessão' : 'sessões'}`,
      onclick: () => abrirDiaDoMes(d, lista, sem) },
      el('span', { style: 'font-weight:600', text: String(Number(d.slice(8))) }),
      lista.length ? el('span', { style: 'font-size:.8em;font-weight:700', text: `${lista.length} ${lista.length === 1 ? 'sessão' : 'sessões'}` }) : null,
      sem ? el('span', { style: 'font-size:.7em;line-height:1.1', text: sem.nome }) : null));
  }
  const cab = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(t => el('span', { class: 'suave pequeno', style: 'text-align:center', text: t }));
  mostrar(
    cabecalho('Agenda', { voltar: true, sub: nomeMes(ym), acoes: [botaoIcone('Feriados e dias sem atendimento', 'ajustes', () => ir({ tela: 'feriados' }))] }),
    el('div', { class: 'conteudo pilha' },
      cartaoAvisosAgenda(),
      segmentoEscolha({ semana: 'Semana', lista: 'Lista', mes: 'Mês' }, 'mes', k => { if (k === 'semana') ir({ tela: 'agenda', semana: ym === hoje.slice(0, 7) ? hoje : primeiro }, false); if (k === 'lista') ir({ tela: 'listaSemana', semana: ym === hoje.slice(0, 7) ? hoje : primeiro }, false); }),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'secundario compacto', text: '‹ Mês anterior', onclick: () => ir({ tela: 'agendaMes', ym: somarMeses(ym, -1) }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Este mês', onclick: () => ir({ tela: 'agendaMes' }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Próximo ›', onclick: () => ir({ tela: 'agendaMes', ym: somarMeses(ym, 1) }, false) })),
      el('p', { class: 'suave pequeno', text: `${totalMes} ${totalMes === 1 ? 'sessão agendada' : 'sessões agendadas'} em ${nomeMes(ym).toLowerCase()}${feriadosMes ? ` · ${feriadosMes} ${feriadosMes === 1 ? 'dia sem atendimento' : 'dias sem atendimento'}` : ''}. Toque num dia para ver os horários.` }),
      el('div', { style: 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px' }, cab, celulas)),
    el('button', { type: 'button', class: 'fab estendido', onclick: () => { agendamentoRasc = null; ir({ tela: 'agendar' }); } }, icone('mais'), el('span', { text: 'Novo agendamento' })));
}
async function abrirDiaDoMes(d, lista, sem) {
  const botoes = lista.map((o, i) => ({ rotulo: `${horaCurta(o.hora) || '—'}  ${o.c.nome}`, valor: String(i) }));
  botoes.push({ rotulo: 'Ver a semana', valor: 'semana' }, { rotulo: 'Fechar', valor: null, estilo: 'primario' });
  const r = await janela(dataComDia(d), [
    sem && el('p', { class: 'faixa', text: `${sem.feriado ? 'Feriado' : 'Sem atendimento'}: ${sem.nome}` }),
    el('p', { class: 'suave pequeno', text: lista.length ? 'Toque num horário para cancelar, remarcar ou abrir o paciente.' : 'Nenhuma sessão neste dia.' })], botoes);
  if (r === 'semana') return ir({ tela: 'agenda', semana: d });
  if (r !== null && r !== undefined && lista[Number(r)]) acoesOcorrencia(lista[Number(r)]);
}

// ---------- Versão 15: sincronizar pelo Google Drive (botão nos dois aparelhos) ----------
// Cada aparelho guarda na pasta compartilhada um arquivo seu, cifrado com a senha dos arquivos,
// só com a parte administrativa (registros "x:"). Ao sincronizar: lê o do outro, junta, e grava o seu.
const ARQ_SYNC = { dono: 'consultorio-sync-principal.cifrado.txt', adm: 'consultorio-sync-administrativo.cifrado.txt' };
const idDaPasta = link => ((link || '').match(/folders\/([\w-]{20,})/) || [])[1] || idDoLink(link);
function botaoSincronizar() {
  if (!driveCfg().pastaSync || !driveCfg().clientId) return null;
  carregarGoogle().catch(() => { });
  const b = botaoIcone(tokenSyncValido() && senhaTroca ? 'Sincronizar agora (já sincroniza sozinho)' : 'Sincronizar com o outro aparelho: toque para ligar a sincronização automática', 'repetir', () => sincronizarDrive());
  if (!(tokenSyncValido() && senhaTroca)) {
    b.style.position = 'relative';
    b.append(el('span', { 'aria-hidden': 'true', style: 'position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;background:#e0a526;border:2px solid #fff' }));
  }
  setTimeout(sincronizarSozinho, 800);
  return b;
}
async function editarPastaSync() {
  const r = await dialogo({
    titulo: 'Pasta de sincronização', texto: 'No Drive: crie uma pasta (ex.: "Consultório – sincronização"), toque nos três pontinhos → Compartilhar → adicione a conta Google do outro aparelho como Editor → Copiar link. Cole aqui. Use a mesma pasta nos dois aparelhos.',
    campos: [{ rotulo: 'https://drive.google.com/drive/folders/…' }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }]
  });
  if (r === null) return;
  if (r.trim() && !idDaPasta(r.trim())) return aviso('Link não reconhecido', 'Copie o link da pasta pelo botão Compartilhar do Drive.');
  driveCfg().pastaSync = r.trim(); salvarPerfil(); await salvarAgora(); render(history.state);
}
async function driveApi(url, token, opcoes = {}) {
  const r = await fetch(url, { ...opcoes, headers: { Authorization: 'Bearer ' + token, ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(r.status === 404 ? 'nao-encontrado' : r.status === 401 || r.status === 403 ? 'sem-permissao' : 'falha');
  return r;
}
let sincronizando = false;
// Versão 35: depois do primeiro toque no 🔁 em cada sessão, a sincronização roda sozinha
// (ao abrir uma tela, a cada 2 minutos e ao voltar para o app), sem janelas, enquanto a autorização do Google valer (1 hora).
const ESCOPO_ESCRITA = 'https://www.googleapis.com/auth/drive';
const tokenSyncValido = () => !!(tokenGoogle && tokenGoogle.escopo === ESCOPO_ESCRITA && tokenGoogle.expira > Date.now() + 60000);
let ultimaSyncAuto = 0;
async function sincronizarSozinho() {
  if (sincronizando || !Cofre.aberto() || !senhaTroca || !tokenSyncValido()) return; // versão 60: também com o app minimizado, enquanto o Android deixar
  if (!driveCfg().pastaSync || !driveCfg().clientId || Date.now() - ultimaSyncAuto < 60000) return;
  ultimaSyncAuto = Date.now();
  await sincronizarDrive({ silencioso: true });
}
setInterval(sincronizarSozinho, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(sincronizarSozinho, 1500); });
async function sincronizarDrive(opcoes = {}) {
  const silencioso = opcoes.silencioso === true;
  if (sincronizando) return;
  const cfg = driveCfg(), pasta = idDaPasta(cfg.pastaSync);
  if (!cfg.clientId) return silencioso ? null : aviso('Falta a chave do Google', 'Em Configurações → Google Drive, cole a chave de conexão (ID do cliente).');
  if (!pasta) return silencioso ? null : aviso('Falta a pasta', 'Em Configurações → Google Drive, cole o link da pasta compartilhada.');
  const s = silencioso ? (senhaTroca ? { senha: senhaTroca, nova: false } : null) : await senhaDosArquivos('A senha dos arquivos, a mesma nos dois aparelhos. Ela cifra tudo antes de ir para o Drive.');
  if (!s) return;
  let token;
  if (silencioso) { if (!tokenSyncValido()) return; token = tokenGoogle.valor; }
  else {
    try { await carregarGoogle(); token = await pedirTokenGoogle(ESCOPO_ESCRITA); }
    catch (e) { return aviso('Sem conexão com o Google', e.message === 'sem-internet' ? 'Verifique a internet e tente de novo.' : 'O acesso ao Google não foi concedido. Toque em Sincronizar de novo e entre na conta.'); }
  }
  sincronizando = true; indicarStatus('Sincronizando…');
  let mudou = false;
  try {
    const eu = modo === 'dono' ? 'dono' : 'adm', outro = eu === 'dono' ? 'adm' : 'dono';
    const q = encodeURIComponent(`'${pasta}' in parents and trashed = false`);
    const lista = await (await driveApi(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100`, token)).json();
    const achar = nome => (lista.files || []).find(f => f.name === nome);
    let r = { novos: 0, atualizados: 0, mantidos: 0 }, recebeu = false, outraSenha = false;
    const doOutro = achar(ARQ_SYNC[outro]);
    let pacote = null;
    if (doOutro) {
      const texto = await (await driveApi(`https://www.googleapis.com/drive/v3/files/${doOutro.id}?alt=media&supportsAllDrives=true`, token)).text();
      // Versão 52: arquivo do outro aparelho com outra senha (antigo, ou o outro ainda não sincronizou com a senha nova):
      // não trava; envia os dados deste aparelho e avisa.
      try { pacote = await Cofre.decifrarPacote(s.senha, texto); if (pacote.formato !== 'consultorio-adm') pacote = null; }
      catch (e) { if (e.message === 'senha-incorreta') outraSenha = true; else pacote = null; }
    }
    if (pacote) {
      await salvarAgora();
      const antes = fotoParaAvisos();
      r = await mesclarRegistros(pacote.registros || {}, k => k.startsWith('x:'));
      mudou = (r.novos || 0) + (r.atualizados || 0) > 0;
      if (modo === 'adm' && pacote.registros?.['x:perfil'] && !pacote.registros['x:perfil'].assinaturaNoAdm) await Cofre.apagar('x:assinatura');
      await recarregarTudo();
      recebeu = true;
      if (mudou) avisarNovidades(antes);
    }
    // Versão 66: quem preencheu o Google Forms entra (ou é atualizado) sozinho, a cada sincronização.
    let doForms = null;
    try { doForms = await autoImportarForms(token, !silencioso); } catch { doForms = null; }
    await salvarAgora();
    const registros = await registrosAdm(false);
    const conteudo = await Cofre.cifrarPacote(s.senha, { formato: 'consultorio-adm', versao: 1, de: modo, criadoEm: agoraISO(), registros });
    const meu = achar(ARQ_SYNC[eu]);
    if (meu) await driveApi(`https://www.googleapis.com/upload/drive/v3/files/${meu.id}?uploadType=media&supportsAllDrives=true`, token, { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: conteudo });
    else {
      const limite = 'consultorio' + Date.now();
      const corpo = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: ARQ_SYNC[eu], parents: [pasta], mimeType: 'text/plain' })}\r\n--${limite}\r\nContent-Type: text/plain\r\n\r\n${conteudo}\r\n--${limite}--`;
      await driveApi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', token, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + limite }, body: corpo });
    }
    try { localStorage.setItem('consultorio-ultima-sync', agoraISO()); } catch { } // fora do perfil, para não sobrescrever dados do outro aparelho
    if (doForms && (doForms.novos || doForms.atualizados)) {
      const t = [doForms.novos ? `${doForms.novos} ${doForms.novos === 1 ? 'paciente novo' : 'pacientes novos'} do formulário` : '', doForms.atualizados ? `${doForms.atualizados} ${doForms.atualizados === 1 ? 'cadastro atualizado' : 'cadastros atualizados'} pelo formulário` : ''].filter(Boolean).join(' · ');
      mostrarNotificacao('Consultório', t);
      mudou = true;
      if (silencioso) { indicarStatus(t); return; }
      await aviso('Formulário', t + (doForms.nomes.length ? ': ' + listaNatural(doForms.nomes) + '.' : '.'));
    }
    if (silencioso) { indicarStatus(outraSenha ? 'Enviado. O outro aparelho ainda usa outra senha.' : 'Sincronizado às ' + new Date().toTimeString().slice(0, 5)); return; }
    await oferecerLembrarSenha(s);
    if (!senhaTroca && s.senha) senhaTroca = s.senha;
    indicarStatus('Sincronizado. Agora sincroniza sozinho enquanto o app estiver aberto.');
    await aviso(outraSenha ? 'Seus dados foram enviados' : 'Sincronizado', outraSenha
      ? 'O arquivo do outro aparelho que está no Drive usa outra senha: é antigo, ou o outro aparelho ainda não sincronizou com a senha nova. Os seus dados foram enviados. Quando o outro aparelho tocar no 🔁 com a mesma senha, os dois ficam iguais.'
      : recebeu ? `Recebidos do outro aparelho: ${r.novos} novos, ${r.atualizados} atualizados. Os seus dados também foram enviados.`
        : 'Os seus dados foram enviados. O outro aparelho ainda não sincronizou nenhuma vez.');
  } catch (e) {
    console.warn('sincronização', e);
    indicarStatus('');
    if (silencioso) { if (e.message === 'sem-permissao') tokenGoogle = null; return; }
    if (e.message === 'sem-permissao') tokenGoogle = null;
    const msg = {
      'sem-permissao': 'A conta Google não tem acesso à pasta. Confira se a pasta foi compartilhada com esta conta como Editor.',
      'nao-encontrado': 'A pasta não foi encontrada. Confira o link em Configurações → Google Drive.',
      'senha-incorreta': 'A senha dos arquivos está diferente da usada no outro aparelho.',
      'arquivo-invalido': 'O arquivo do outro aparelho não pôde ser lido.'
    }[e.message] || 'Não foi possível sincronizar agora. Verifique a internet e tente de novo.';
    await aviso('Sincronização não concluída', msg);
  } finally {
    sincronizando = false;
    // Na sincronização automática, só redesenha a tela se chegou algo novo e a pessoa não está digitando.
    const digitando = document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (Cofre.aberto() && (!silencioso || (mudou && !digitando))) render(history.state);
  }
}

// ---------- Versão 16 (Etapa 1): frequência de cada paciente, avisos para combinar e horários bloqueados ----------
const FREQUENCIAS = { semanal: 'Semanal', quinzenal: 'Quinzenal', 'variavel-semana': 'Variável: combinado a cada semana', 'variavel-mes': 'Variável: dias do mês marcados no início do mês' };
const FREQ_DICA = {
  semanal: 'Mesmo dia e horário toda semana. Use "Agendar sessões" → Semanal.',
  quinzenal: 'Mesmo dia e horário a cada 15 dias. Use "Agendar sessões" → Quinzenal.',
  'variavel-semana': 'Os horários são combinados a cada semana. A partir de quinta-feira, o app avisa para combinar a semana seguinte. Use "Agendar sessões" → Vários dias.',
  'variavel-mes': 'Todos os dias do mês são marcados no início do mês. A partir do dia 25, o app avisa para combinar o mês seguinte. Os dias marcados ficam bloqueados na agenda.'
};
const freqDe = c => c.frequencia || (horariosDe(c).some(h => Number(h.freq) === 2) ? 'quinzenal' : 'semanal');
// Datas escolhidas no rascunho de agendamento ("Uma vez" ou "Vários dias").
function datasDoRascunho(r) {
  const ds = [{ data: r.data, hora: r.hora }];
  if (r.repetir === 'varios') for (const x of r.extras || []) if (x.data) ds.push({ data: x.data, hora: x.hora || r.hora });
  return ds.filter(d => d.data).sort((a, b) => a.data.localeCompare(b.data));
}
// Horário bloqueado: qualquer sessão válida de outro paciente no mesmo dia e hora.
function ocupadoEm(data, hora, exceto) {
  if (!hora) return [];
  return cadastros.filter(c => !c.arquivado && c.id !== exceto)
    .flatMap(c => ocorrenciasNoPeriodo(c, data, data)).filter(o => !o.feriado && !o.cancelada && o.hora === hora);
}
function conflitosDoRascunho(r) {
  if (!r.data || !r.hora) return [];
  let datas;
  if (r.repetir === 'nao' || r.repetir === 'varios') datas = datasDoRascunho(r);
  else {
    const n = Math.min(MAX_SESSOES_SERIE, Math.max(1, Math.round(Number(r.sessoes)) || 1));
    datas = datasSerie({ id: '_' }, { dia: diaDaSemana(r.data), hora: r.hora, inicio: r.data, sessoes: n, freq: r.repetir === 'quinzenal' ? 2 : 1 }, -1).filter(o => !o.feriado);
  }
  return datas.flatMap(d => ocupadoEm(d.data, d.hora || r.hora, r.pid));
}
// Avisos: "combinar os horários da próxima semana" (a partir de quinta) e "combinar os dias do próximo mês" (a partir do dia 25).
function semanaChave(ymd) { return 'S' + segundaDaSemana(ymd); }
function combinarPendentes() {
  const hoje = hojeISO(), dow = diaDaSemana(hoje), dia = Number(hoje.slice(8)), res = [];
  const proxSeg = somarDias(segundaDaSemana(hoje), 7), proxDom = somarDias(proxSeg, 6);
  const proxMes = somarMeses(hoje.slice(0, 7), 1), iniMes = proxMes + '-01', fimMes = somarDias(somarMeses(proxMes, 1) + '-01', -1);
  for (const c of cadastros) {
    if (c.arquivado) continue;
    const f = freqDe(c), feito = c.combinado || {};
    if (f === 'variavel-semana' && (dow >= 4 || dow === 0)) {
      const chave = semanaChave(proxSeg);
      if (!feito[chave] && !ocorrenciasNoPeriodo(c, proxSeg, proxDom).some(o => !o.feriado && !o.cancelada))
        res.push({ c, chave, titulo: `Combinar a próxima semana com ${c.nome}`, texto: `Semana de ${dataCurta(proxSeg).slice(0, 5)} a ${dataCurta(proxDom).slice(0, 5)}: ainda sem horário marcado.` });
    }
    if (f === 'variavel-mes' && dia >= 25) {
      const chave = 'M' + proxMes;
      if (!feito[chave] && !ocorrenciasNoPeriodo(c, iniMes, fimMes).some(o => !o.feriado && !o.cancelada))
        res.push({ c, chave, mes: true, titulo: `Combinar os dias de ${nomeMes(proxMes).toLowerCase()} com ${c.nome}`, texto: 'Marque todos os dias do próximo mês; eles ficam bloqueados na agenda.' });
    }
  }
  return res;
}

// ---------- Versão 17: painel de confirmações da semana ----------
// Situação guardada no cadastro (sincroniza com o outro aparelho): confirmacoes["aaaa-mm-dd hh:mm"] = { enviada, confirmada }.
const MSG_CONFIRMACAO_PADRAO = 'Olá, {nome}! Tudo bem? Podemos confirmar sua sessão de {dia}, {data}, às {hora}? Responda, por favor, para confirmar. Obrigado!';
const ROTULO_CONF = { enviada: '📨 mensagem enviada', confirmada: '✓ confirmada' };
const chaveConf = (data, hora) => `${data} ${hora || ''}`.trim();
function estadoConfirmacao(c, data, hora) {
  const x = (c.confirmacoes || {})[chaveConf(data, hora)];
  return x?.confirmada ? 'confirmada' : x?.enviada ? 'enviada' : '';
}
function marcarConfirmacao(c, data, hora, campo, valor = true) {
  const k = chaveConf(data, hora), cf = (c.confirmacoes ||= {});
  cf[k] = { ...(cf[k] || {}) };
  if (valor) cf[k][campo] = agoraISO(); else delete cf[k][campo];
  if (!cf[k].enviada && !cf[k].confirmada) delete cf[k];
  salvarCadastro(c);
}
function mensagemConfirmacao(c, data, hora) {
  return (perfil.msgConfirmacao || MSG_CONFIRMACAO_PADRAO)
    .replaceAll('{nome}', primeiroNome(c.nome)).replaceAll('{dia}', DIAS_LONGO[diaDaSemana(data)])
    .replaceAll('{data}', dataCurta(data).slice(0, 5)).replaceAll('{hora}', horaCurta(hora) || '');
}
function enviarConfirmacao(c, data, hora) {
  const n = numeroWhats(c.telefone);
  if (!n) return aviso('Sem celular', `Cadastre o celular de ${c.nome} (paciente → Cadastro).`);
  if (estadoConfirmacao(c, data, hora) !== 'confirmada') marcarConfirmacao(c, data, hora, 'enviada');
  abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(mensagemConfirmacao(c, data, hora))}`);
}
function botaoConfirmacoes() { return botaoIcone('Confirmações da semana', 'mensagem', () => ir({ tela: 'confirmacoes' })); }
async function editarMsgConfirmacao() {
  const r = await dialogo({ titulo: 'Mensagem de confirmação', texto: 'Use {nome}, {dia}, {data} e {hora}; o app troca pelos dados de cada paciente.',
    campos: [{ rotulo: 'Mensagem', valor: perfil.msgConfirmacao || MSG_CONFIRMACAO_PADRAO }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Padrão', valor: 'padrao' }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }] });
  if (r === null) return;
  perfil.msgConfirmacao = r === 'padrao' ? '' : String(r).trim();
  salvarPerfil(); render(history.state);
}
async function enviarDiaInteiro(dia, itens) {
  const pend = itens.filter(i => estadoConfirmacao(i.c, i.data, i.hora) !== 'confirmada');
  if (!pend.length) return aviso('Tudo confirmado', 'Todos deste dia já confirmaram.');
  const botoes = pend.map(i => {
    const n = numeroWhats(i.c.telefone);
    const b = el('button', { type: 'button', class: 'secundario com-icone', disabled: !n }, icone('mensagem'),
      el('span', { text: n ? `${horaCurta(i.hora)} · ${i.c.nome}` : `${i.c.nome}: sem celular` }));
    if (n) b.addEventListener('click', () => { enviarConfirmacao(i.c, i.data, i.hora); b.classList.add('marcado'); b.lastChild.textContent = `Aberto: ${i.c.nome}`; });
    return b;
  });
  await janela(`Confirmações de ${dataComDia(dia)}`, [el('p', { class: 'suave pequeno', text: 'Toque em cada paciente: o WhatsApp abre com a mensagem pronta. Envie e volte para o próximo.' }), el('div', { class: 'pilha-pequena' }, botoes)],
    [{ rotulo: 'Pronto', valor: true, estilo: 'primario' }]);
  render(history.state);
}
function telaConfirmacoes(inicio) {
  const hoje = hojeISO();
  const padrao = diaDaSemana(hoje) >= 5 || diaDaSemana(hoje) === 0 ? somarDias(segundaDaSemana(hoje), 7) : hoje; // de sexta em diante, já mostra a próxima semana
  const seg = segundaDaSemana(inicio || padrao), dom = somarDias(seg, 6);
  const ocs = cadastros.filter(c => !c.arquivado).flatMap(c => ocorrenciasNoPeriodo(c, seg, dom)).filter(o => !o.feriado && !o.cancelada);
  let total = 0, enviadas = 0, confirmadas = 0;
  const blocos = [0, 1, 2, 3, 4, 5, 6].map(i => somarDias(seg, i)).map(d => {
    const sem = diaSemAtendimento(d);
    const itens = ocs.filter(o => o.data === d).sort((a, b) => a.hora.localeCompare(b.hora) || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
    if (diaDaSemana(d) === 0 && !itens.length) return null;
    total += itens.length;
    const linhas = itens.map(o => {
      const st = estadoConfirmacao(o.c, o.data, o.hora); if (st === 'enviada') enviadas++; if (st === 'confirmada') confirmadas++;
      const n = numeroWhats(o.c.telefone);
      return el('div', { class: 'pag-linha' },
        el('span', { class: 'pag-info' }, el('strong', { text: `${horaCurta(o.hora) || '—'}  ${o.c.nome}` }),
          el('span', { class: 'suave', text: st ? ROTULO_CONF[st] : n ? 'Ainda não enviada' : 'Sem celular no cadastro' })),
        st !== 'confirmada' && n && el('button', { type: 'button', class: 'secundario compacto', text: st === 'enviada' ? 'Reenviar' : 'Enviar', onclick: () => { enviarConfirmacao(o.c, o.data, o.hora); render(history.state); } }),
        st === 'enviada' && el('button', { type: 'button', class: 'primario compacto', text: 'Confirmou', onclick: () => { marcarConfirmacao(o.c, o.data, o.hora, 'confirmada'); render(history.state); } }),
        st === 'confirmada' && el('button', { type: 'button', class: 'link', text: 'Desfazer', onclick: () => { marcarConfirmacao(o.c, o.data, o.hora, 'confirmada', false); render(history.state); } }));
    });
    return el('section', { class: 'cartao' + (d === hoje ? ' destaque' : '') },
      el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('calendario')),
        el('span', { text: `${DIAS[diaDaSemana(d)]}, ${dataCurta(d).slice(0, 5)}${d === hoje ? ' (hoje)' : ''}` })),
      sem && el('p', { class: 'faixa', text: `${sem.feriado ? 'Feriado' : 'Sem atendimento'}: ${sem.nome}` }),
      itens.length ? linhas : el('p', { class: 'suave pequeno', text: 'Nenhuma sessão.' }),
      itens.some(o => estadoConfirmacao(o.c, o.data, o.hora) !== 'confirmada') && el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => enviarDiaInteiro(d, itens) },
        icone('mensagem'), el('span', { text: `Enviar confirmações de ${DIAS[diaDaSemana(d)].toLowerCase()}` })));
  });
  const fmt = d => paraData(d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  mostrar(
    cabecalho('Confirmações da semana', { voltar: true, sub: `${fmt(seg)} a ${fmt(dom)}` }),
    el('div', { class: 'conteudo pilha' },
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'secundario compacto', text: '‹ Anterior', onclick: () => ir({ tela: 'confirmacoes', semana: somarDias(seg, -7) }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Esta semana', onclick: () => ir({ tela: 'confirmacoes', semana: hoje }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Próxima ›', onclick: () => ir({ tela: 'confirmacoes', semana: somarDias(seg, 7) }, false) })),
      el('p', { class: 'suave pequeno', text: `${total} ${total === 1 ? 'sessão' : 'sessões'} · ${confirmadas} ${confirmadas === 1 ? 'confirmada' : 'confirmadas'} · ${enviadas} aguardando resposta · ${total - confirmadas - enviadas} sem mensagem.` }),
      ocs.some(o => estadoConfirmacao(o.c, o.data, o.hora) !== 'confirmada') && el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => enviarSemanaInteira(seg, ocs) },
        icone('mensagem'), el('span', { text: 'Enviar confirmações da semana toda' })),
      ...blocos,
      el('button', { type: 'button', class: 'link', text: 'Editar o texto da mensagem', onclick: editarMsgConfirmacao })));
}

// ---------- Versão 18: enviar a semana toda (uma mensagem por paciente, com todas as sessões dele na semana) ----------
function mensagemSemana(c, lista) {
  if (lista.length === 1) return mensagemConfirmacao(c, lista[0].data, lista[0].hora);
  const partes = lista.map(o => `${DIAS_LONGO[diaDaSemana(o.data)]}, ${dataCurta(o.data).slice(0, 5)}${o.hora ? `, às ${horaCurta(o.hora)}` : ''}`);
  return `Olá, ${primeiroNome(c.nome)}! Tudo bem? Podemos confirmar suas sessões desta semana: ${listaNatural(partes)}? Responda, por favor, para confirmar. Obrigado!`;
}
async function enviarSemanaInteira(seg, ocs) {
  const porPaciente = new Map();
  for (const o of ocs) {
    if (estadoConfirmacao(o.c, o.data, o.hora) === 'confirmada') continue;
    if (!porPaciente.has(o.c.id)) porPaciente.set(o.c.id, { c: o.c, lista: [] });
    porPaciente.get(o.c.id).lista.push(o);
  }
  const grupos = [...porPaciente.values()].map(g => ({ ...g, lista: g.lista.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora)) }))
    .sort((a, b) => a.lista[0].data.localeCompare(b.lista[0].data) || a.lista[0].hora.localeCompare(b.lista[0].hora));
  if (!grupos.length) return aviso('Tudo confirmado', 'Todos os pacientes desta semana já confirmaram.');
  const botoes = grupos.map(g => {
    const n = numeroWhats(g.c.telefone);
    const quando = g.lista.map(o => `${DIAS[diaDaSemana(o.data)].slice(0, 3)} ${horaCurta(o.hora)}`).join(', ');
    const b = el('button', { type: 'button', class: 'secundario com-icone', disabled: !n }, icone('mensagem'),
      el('span', { text: n ? `${g.c.nome} · ${quando}` : `${g.c.nome}: sem celular` }));
    if (n) b.addEventListener('click', () => {
      for (const o of g.lista) marcarConfirmacao(g.c, o.data, o.hora, 'enviada');
      abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(mensagemSemana(g.c, g.lista))}`);
      b.classList.add('marcado'); b.lastChild.textContent = `Aberto: ${g.c.nome}`;
    });
    return b;
  });
  await janela(`Confirmações da semana (${grupos.length} ${grupos.length === 1 ? 'paciente' : 'pacientes'})`,
    [el('p', { class: 'suave pequeno', text: 'Uma mensagem por paciente, com todos os horários dele na semana. Toque no nome, envie no WhatsApp e volte para o próximo.' }), el('div', { class: 'pilha-pequena' }, botoes)],
    [{ rotulo: 'Pronto', valor: true, estilo: 'primario' }]);
  render(history.state);
}

// =====================================================================
// Versão 25: Lista da semana no formato do administrativo (o mesmo da "Lista de presença" do Drive),
// com a regra das 24 horas, o resumo semanal calculado e a mensagem pronta para o WhatsApp.
// =====================================================================
const GRADE_PADRAO = { 1: { de: 9, ate: 21 }, 2: { de: 9, ate: 21 }, 3: { de: 9, ate: 21 }, 4: { de: 9, ate: 21 }, 5: { de: 9, ate: 21 }, 6: { de: 9, ate: 14 } };
const gradeDia = dia => (cfgAgenda().grade || GRADE_PADRAO)[dia] || null;
const fixosSemPaciente = () => (cfgAgenda().fixos ||= []);      // { id, dia, de, ate, nome } — com nome: ⚠️ compromisso; sem nome: 🔴 sem atendimento
const bloqueiosDia = () => (cfgAgenda().bloqueiosDia ||= []);   // { data, h } — 🔴 só naquele dia
const CHIP_PRESENCA = { realizada: '✅ Veio', falta: '⭕ Faltou', tardia: '⭕ Desmarcou <24h', cancelada: '❌ Desmarcou', remarcada: '💱 Remarcada' };
const LEGENDA_LISTA = [
  ['📲', 'Mensagem de confirmação enviada'], ['🟢', 'Consulta confirmada'],
  ['💰', 'Paga por sessão'], ['💵', 'Pagamento semanal'], ['💸', 'Pagamento mensal'], ['1X', 'Sessão avulsa'],
  ['✅', 'Foi à consulta (cobra)'], ['❌', 'Desmarcou com 24h ou mais (não cobra)'], ['⭕', 'Faltou ou desmarcou com menos de 24h (cobra)'],
  ['💱', 'Reagendou (não cobra; vai para a nova data)'], ['🤝', 'Abonada pelo Rodrigo (não cobra)'],
  ['🟡', 'Horário vago'], ['🔴', 'Sem atendimento neste horário'], ['⚠️', 'Compromisso do Rodrigo'],
  ['🟩', '10 ou mais pacientes no dia (ótimo)'], ['🟨', 'Entre 7 e 9 pacientes (razoável)'], ['🟥', '6 ou menos pacientes (péssimo)']];
const EMOJI_MODO = { sessao: '💰', semanal: '💵', quinzenal: '💸', mensal: '💸' };
const nomeNaLista = c => (c.nomeLista || '').trim() || c.nome;
const horaInt = hora => hora ? Number(hora.slice(0, 2)) : -1;
const rotuloHora = hora => { const [h, m] = (hora || '').split(':'); return h ? `${Number(h)}h${m && m !== '00' ? m : ''}` : '—'; };
const corDoDia = n => n >= 10 ? '🟩' : n >= 7 ? '🟨' : '🟥';

function atDaOcorrencia(c, data, hora, criar = false) {
  let a = atendimentos.find(x => x.pid === c.id && x.data === data && (x.hora || '') === (hora || ''))
    || atendimentos.find(x => x.pid === c.id && x.data === data && !x.hora);
  if (!a && criar) {
    const agora = agoraISO();
    a = { id: crypto.randomUUID(), pid: c.id, data, hora: hora || '', presenca: null, pagamento: null, valor: valorPadrao(c, data), criadoEm: agora, atualizadoEm: agora };
    atendimentos.push(a);
  }
  return a;
}
function marcasDaOcorrencia(o) {
  const a = atDaOcorrencia(o.c, o.data, o.hora);
  const conf = estadoConfirmacao(o.c, o.data, o.hora);
  const pres = a?.presenca;
  let m = o.avulsa && !o.c.modoPagamento ? '1X ' : (EMOJI_MODO[o.c.modoPagamento] || '');
  if (pres === 'realizada') m += '✅';
  else if (pres === 'falta' || pres === 'tardia') m += '⭕';
  else if (pres === 'remarcada') m += '💱' + (a.remarcadaPara ? ' ' + dataCurta(a.remarcadaPara).slice(0, 5) : '');
  else if (pres === 'cancelada' || o.cancelada) m += '❌';
  else if (conf === 'confirmada') m += '🟢';
  else if (conf === 'enviada') m += '📲';
  if (a?.abonada) m += '🤝';
  return { texto: m.trim(), a, pres: pres || (o.cancelada ? 'cancelada' : null) };
}
// Monta a semana: dias (seg a sáb, e domingo se tiver sessão), cada um com as linhas hora a hora.
function montarSemana(seg) {
  const dom = somarDias(seg, 6);
  const ativos = cadastros.filter(c => !c.arquivado);
  const ocs = ativos.flatMap(c => ocorrenciasNoPeriodo(c, seg, dom)).filter(o => !o.feriado);
  const dias = [];
  const tot = { marcadas: 0, feitas: 0, naoVeio: 0, canceladas: 0, vagos: 0, confirmadas: 0 };
  for (let i = 0; i < 7; i++) {
    const d = somarDias(seg, i), dia = diaDaSemana(d), g = gradeDia(dia);
    const doDia = ocs.filter(o => o.data === d);
    if (!g && !doDia.length) continue;
    const sem = diaSemAtendimento(d);
    const linhas = [];
    let pacientes = 0;
    const vagos = [];
    const horas = new Set();
    if (g && !sem) for (let h = g.de; h <= g.ate; h++) horas.add(h);
    doDia.forEach(o => horas.add(horaInt(o.hora)));
    for (const h of [...horas].sort((a, b) => a - b)) {
      const naHora = doDia.filter(o => horaInt(o.hora) === h).sort((a, b) => a.hora.localeCompare(b.hora));
      const fixos = fixosSemPaciente().filter(f => Number(f.dia) === dia && h >= Number(f.de) && h <= Number(f.ate));
      const comp = fixos.find(f => (f.nome || '').trim());
      const bloq = fixos.some(f => !(f.nome || '').trim()) || bloqueiosDia().some(b => b.data === d && Number(b.h) === h);
      let ocupado = false;
      for (const o of naHora) {
        const mk = marcasDaOcorrencia(o);
        const saiu = ['cancelada', 'tardia', 'remarcada'].includes(mk.pres);
        if (!saiu) { ocupado = true; pacientes++; }
        if (mk.pres === 'cancelada') tot.canceladas++;
        else { tot.marcadas++; if (mk.pres === 'realizada') tot.feitas++; if (mk.pres === 'falta' || mk.pres === 'tardia') tot.naoVeio++; }
        if (estadoConfirmacao(o.c, o.data, o.hora) === 'confirmada') tot.confirmadas++;
        linhas.push({ tipo: 'paciente', h, o, mk, saiu, texto: `✔️ ${rotuloHora(o.hora)} - ${nomeNaLista(o.c)} - ${mk.texto}` });
      }
      if (comp) linhas.push({ tipo: 'compromisso', h, texto: `✔️ ${h}h - ⚠️ ${comp.nome.trim()} ⚠️` });
      else if (!ocupado && g && h >= g.de && h <= g.ate) {
        if (bloq) linhas.push({ tipo: 'bloqueado', h, d, texto: `✔️ ${h}h - 🔴🔴🔴🔴🔴 -` });
        else { linhas.push({ tipo: 'vago', h, d, texto: `✔️ ${h}h - 🟡🟡🟡🟡🟡 -` }); vagos.push(h); tot.vagos++; }
      }
    }
    dias.push({ d, dia, sem, linhas, pacientes, vagos });
  }
  const pacientesAtivos = ativos.filter(temAgenda).length;
  return { seg, sab: somarDias(seg, 5), dias, tot, pacientesAtivos };
}
const listaHoras = hs => !hs.length ? '❌' : hs.length === 1 ? `${String(hs[0]).padStart(2, '0')}h` : hs.slice(0, -1).map(h => String(h).padStart(2, '0')).join(', ') + ` e ${String(hs[hs.length - 1]).padStart(2, '0')}h`;
const ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function textoListaSemana(S, comLegenda = true) {
  const ddmmaa = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
  const fim = S.dias.length ? S.dias[S.dias.length - 1].d : S.sab;
  const t = [`*➡️CONSULTAS DE ${ddmmaa(S.seg)} A ${ddmmaa(fim)}*`, `*➡️Confirmação de consultas:* ${S.tot.confirmadas}`];
  if (comLegenda) t.push('', ...LEGENDA_LISTA.map(([e, s]) => `${e} ${s}`));
  t.push('', '', '*⚠️RESUMO SEMANAL:⚠️*',
    `*➡️Consultas marcadas:* ${S.tot.marcadas}`, `*➡️Pacientes ativos:* ${S.pacientesAtivos}`, `*➡️Consultas feitas:* ${S.tot.feitas}`,
    `*➡️Não veio ou desmarcou em cima da hora:* ${S.tot.naoVeio}`, `*➡️Consultas canceladas (24h ou mais):* ${S.tot.canceladas}`, `*➡️Horários vagos:* ${S.tot.vagos}`,
    ...S.dias.filter(x => !x.sem).map(x => `${ABREV[x.dia]}: ${listaHoras(x.vagos)}`));
  for (const x of S.dias) {
    t.push('', '', `*✅ ${DIAS[x.dia]}${x.dia >= 1 && x.dia <= 5 ? '-feira' : ''} - ${dataCurta(x.d).slice(0, 5)}:*`);
    if (x.sem) { t.push(`_${x.sem.feriado ? 'Feriado' : 'Sem atendimento'}: ${x.sem.nome}_`); continue; }
    t.push(`_${corDoDia(x.pacientes)} - ${String(x.pacientes).padStart(2, '0')} ${x.pacientes === 1 ? 'paciente' : 'pacientes'}_`);
    t.push(...x.linhas.map(l => l.texto));
  }
  return t.join('\n');
}

let listaComLegenda = true;
function telaListaSemana(inicio) {
  const hoje = hojeISO(), seg = segundaDaSemana(inicio || hoje);
  const S = montarSemana(seg);
  const fmt = d => paraData(d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const linhaEl = l => {
    const cls = 'lista-linha' + (l.saiu ? ' saiu' : '') + (l.tipo !== 'paciente' ? ' ' + l.tipo : '');
    const quando = l.tipo === 'paciente' ? () => acoesListaPaciente(l.o) : l.tipo === 'vago' ? () => acoesListaVago(l.d, l.h) : l.tipo === 'bloqueado' ? () => acoesListaBloqueado(l.d, l.h) : null;
    const linha = quando ? el('button', { type: 'button', class: cls, onclick: quando, text: l.texto }) : el('div', { class: cls, text: l.texto });
    const chip = l.tipo === 'paciente' ? chipPagamentoSessao(l.o.c, l.mk.a) : null;
    return chip ? el('div', { class: 'lista-linha-pag' }, linha, chip) : linha;
  };
  const cartaoResumo = el('section', { class: 'cartao' },
    el('h3', { class: 'secao-titulo', text: '⚠️ Resumo semanal' }),
    el('div', { class: 'lista-resumo' },
      ...[['Consultas marcadas', S.tot.marcadas], ['Pacientes ativos', S.pacientesAtivos], ['Consultas feitas', S.tot.feitas], ['Não veio ou desmarcou em cima da hora', S.tot.naoVeio],
        ['Canceladas (24h ou mais)', S.tot.canceladas], ['Horários vagos', S.tot.vagos], ['Confirmadas', S.tot.confirmadas]].map(([r, v]) => el('div', {}, el('span', { text: r }), el('strong', { text: String(v) })))),
    el('p', { class: 'suave pequeno', text: S.dias.filter(x => !x.sem).map(x => `${ABREV[x.dia]}: ${listaHoras(x.vagos)}`).join(' · ') }));
  const legenda = el('details', { class: 'cartao' }, el('summary', { text: 'Legenda dos símbolos' }),
    el('div', { class: 'lista-legenda' }, ...LEGENDA_LISTA.map(([e, s]) => el('div', {}, el('span', { class: 'lista-emoji', text: e }), el('span', { text: s })))));
  const blocos = S.dias.map(x => el('section', { class: 'cartao' + (x.d === hoje ? ' destaque' : '') },
    el('h3', { class: 'cartao-titulo' }, el('span', { text: `${x.sem ? '' : corDoDia(x.pacientes) + ' '}${DIAS[x.dia]}, ${dataCurta(x.d).slice(0, 5)}${x.d === hoje ? ' (hoje)' : ''}` })),
    x.sem ? el('p', { class: 'faixa', text: `${x.sem.feriado ? 'Feriado' : 'Sem atendimento'}: ${x.sem.nome}` })
      : [el('p', { class: 'suave pequeno', text: `${x.pacientes} ${x.pacientes === 1 ? 'paciente' : 'pacientes'} · vagos: ${listaHoras(x.vagos)}` }), el('div', { class: 'lista-dia' }, x.linhas.map(linhaEl))]));
  const chk = el('input', { type: 'checkbox', checked: listaComLegenda, onchange: e => { listaComLegenda = e.target.checked; } });
  mostrar(
    cabecalho('Lista da semana', { voltar: true, sub: `${fmt(seg)} a ${fmt(somarDias(seg, 5))}`, acoes: [botaoIcone('Expediente e compromissos', 'ajustes', () => ir({ tela: 'expediente' }))] }),
    el('div', { class: 'conteudo pilha' },
      segmentoEscolha({ semana: 'Semana', lista: 'Lista', mes: 'Mês' }, 'lista', k => { if (k === 'semana') ir({ tela: 'agenda', semana: seg }, false); if (k === 'mes') ir({ tela: 'agendaMes', ym: seg.slice(0, 7) }, false); }),
      el('div', { class: 'botoes-linha' },
        el('button', { type: 'button', class: 'secundario compacto', text: '‹ Anterior', onclick: () => ir({ tela: 'listaSemana', semana: somarDias(seg, -7) }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Esta semana', onclick: () => ir({ tela: 'listaSemana', semana: hoje }, false) }),
        el('button', { type: 'button', class: 'secundario compacto', text: 'Próxima ›', onclick: () => ir({ tela: 'listaSemana', semana: somarDias(seg, 7) }, false) })),
      el('button', { type: 'button', class: 'primario com-icone centralizado', onclick: () => enviarListaSemana(S) }, icone('mensagem'), el('span', { text: 'Enviar a lista pelo WhatsApp' })),
      el('label', { class: 'marcar' }, chk, el('span', { text: 'Incluir a legenda na mensagem' })),
      el('p', { class: 'suave pequeno', text: 'Toque numa linha para marcar: mensagem enviada, confirmou, veio, desmarcou, faltou ou reagendou. Toque num horário vago para agendar.' }),
      cartaoResumo, legenda, ...blocos));
}
async function enviarListaSemana(S) {
  const texto = textoListaSemana(S, listaComLegenda);
  try { await navigator.clipboard?.writeText(texto); } catch { }
  if (navigator.share) {
    ignorarOcultacao = true;
    try { await navigator.share({ text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } finally { ignorarOcultacao = false; }
  }
  abrirExterno('https://wa.me/?text=' + encodeURIComponent(texto));
}

// ---------- Ações numa linha de paciente ----------
async function acoesListaPaciente(o) {
  const c = o.c, mk = marcasDaOcorrencia(o), a = mk.a, conf = estadoConfirmacao(c, o.data, o.hora);
  const pago = a?.pagamento === 'pago';
  const situacao = mk.pres ? PRESENCA[mk.pres] + (a?.abonada ? ' · abonada' : '') + (a?.pagamento === 'areceber' ? ' · será cobrada' : a?.pagamento === 'pago' ? ' · paga' : a?.pagamento === 'naocobrar' ? ' · não cobrada' : '')
    : conf === 'confirmada' ? '🟢 Confirmou' : conf === 'enviada' ? '📲 Mensagem enviada' : 'Ainda sem marcação';
  const botoes = [{ rotulo: 'Fechar', valor: null }];
  if (a?.pagamento === 'areceber') botoes.push({ rotulo: valorDe(a) ? `✅ Pagou esta sessão (R$ ${reais(valorDe(a))})` : '✅ Pagou esta sessão', valor: 'pagar', estilo: 'primario' });
  if (!mk.pres) {
    if (conf !== 'enviada' && conf !== 'confirmada') botoes.push({ rotulo: '📲 Mensagem enviada', valor: 'enviada' });
    if (conf !== 'confirmada') botoes.push({ rotulo: '🟢 Confirmou', valor: 'confirmada' });
    botoes.push({ rotulo: '✅ Veio', valor: 'realizada', estilo: 'primario' }, { rotulo: '❌ Desmarcou', valor: 'desmarcou' }, { rotulo: '⭕ Faltou', valor: 'falta' }, { rotulo: '💱 Reagendar', valor: 'reagendar' });
  } else {
    if (modo === 'dono' && a && !pago && !a.abonada && a.pagamento === 'areceber') botoes.push({ rotulo: '🤝 Abonar (não cobrar)', valor: 'abonar' });
    if (modo === 'dono' && a?.abonada) botoes.push({ rotulo: 'Voltar a cobrar', valor: 'desabonar' });
    if (!pago) botoes.push({ rotulo: 'Desfazer a marcação', valor: 'desfazer' });
  }
  botoes.push({ rotulo: 'Abrir paciente', valor: 'abrir' });
  const r = await janela(nomeNaLista(c), [el('p', { text: `${dataComDia(o.data)}${o.hora ? ', ' + horaCurta(o.hora) : ''}` }), el('p', { class: 'suave', text: situacao }),
    a?.avisoEm && el('p', { class: 'suave pequeno', text: `Avisou em ${dataCurta(a.avisoEm.slice(0, 10))}, ${a.avisoEm.slice(11, 16)}.` }),
    pago && mk.pres && el('p', { class: 'suave pequeno', text: 'Já está paga: para mudar, desfaça o pagamento na aba Pagamentos.' })], botoes);
  if (!r) return;
  if (r === 'abrir') return ir(modo === 'dono' ? { tela: 'ficha', id: c.id, aba: 'retomar' } : { tela: 'adm', id: c.id, aba: 'atendimentos' });
  if (r === 'pagar') return pagarSessao(c, a);
  if (r === 'enviada' || r === 'confirmada') { marcarConfirmacao(c, o.data, o.hora, r); return render(history.state); }
  if (r === 'realizada' || r === 'falta') return definirPresencaLista(o, r);
  if (r === 'desmarcou') {
    const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const v = await dialogo({ titulo: 'Quando o paciente avisou?', texto: `Sessão: ${dataComDia(o.data)}${o.hora ? ', ' + horaCurta(o.hora) : ''}. Com 24 horas ou mais de antecedência, não cobra; com menos, cobra.`,
      campos: [{ rotulo: 'Data e hora do aviso', tipo: 'datetime-local', valor: agora }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Registrar', valor: true, estilo: 'primario' }] });
    if (!v) return;
    const sessao = new Date(`${o.data}T${o.hora || '00:00'}`), aviso_ = new Date(v);
    const horas = (sessao - aviso_) / 3600000;
    const tipo = horas >= 24 ? 'cancelada' : 'tardia';
    await definirPresencaLista(o, tipo, { avisoEm: v, liberar: true });
    return aviso(tipo === 'cancelada' ? '❌ Desmarcou a tempo' : '⭕ Desmarcou em cima da hora',
      tipo === 'cancelada' ? `Avisou com ${Math.floor(horas)} horas de antecedência: não será cobrada. O horário ficou livre.`
        : `Avisou com ${Math.max(0, Math.floor(horas))} ${Math.floor(horas) === 1 ? 'hora' : 'horas'} de antecedência (menos de 24h): a sessão será cobrada. O horário ficou livre para outro paciente.${modo === 'dono' ? ' Se quiser, toque de novo na linha e escolha "Abonar".' : ' Só o Rodrigo pode abonar.'}`);
  }
  if (r === 'reagendar') {
    const v = await dialogo({ titulo: 'Reagendar', texto: `Nova data e horário para a sessão de ${dataComDia(o.data)}.`,
      campos: [{ rotulo: 'Nova data', tipo: 'date' }, { rotulo: 'Novo horário', tipo: 'time', valor: o.hora }], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Reagendar', valor: true, estilo: 'primario' }] });
    if (!v || !v[0]) return;
    const nova = { id: crypto.randomUUID(), data: v[0], hora: v[1] || o.hora, remarcadaDe: o.data };
    (c.avulsos ||= []).push(nova);
    return definirPresencaLista(o, 'remarcada', { liberar: true, remarcadaPara: v[0], avulsoNovo: nova.id });
  }
  if (r === 'abonar' || r === 'desabonar') {
    a.abonada = r === 'abonar' ? { em: agoraISO() } : null;
    a.pagamento = r === 'abonar' ? 'naocobrar' : 'areceber'; a.pagamentoManual = r === 'abonar';
    if (a.pagamento === 'areceber') usarCredito(a);
    salvarAt(a); return render(history.state);
  }
  if (r === 'desfazer') {
    c.excecoes = (c.excecoes || []).filter(x => !(x.data === o.data && (x.hora || '') === (o.hora || '')));
    if (a?.avulsoNovo) c.avulsos = (c.avulsos || []).filter(x => x.id !== a.avulsoNovo);
    salvarCadastro(c);
    if (a) { a.presenca = null; a.pagamento = null; a.pagamentoManual = false; a.abonada = null; a.avisoEm = null; a.remarcadaPara = null; a.avulsoNovo = null; salvarAt(a); }
    return render(history.state);
  }
}
async function definirPresencaLista(o, presenca, extra = {}) {
  const c = o.c, a = atDaOcorrencia(c, o.data, o.hora, true);
  a.presenca = presenca;
  a.avisoEm = extra.avisoEm || null; a.remarcadaPara = extra.remarcadaPara || null; a.avulsoNovo = extra.avulsoNovo || null;
  if (a.pagamento !== 'pago') { a.pagamento = pagamentoInicial(presenca); a.pagamentoManual = false; a.abonada = null; if (a.pagamento === 'areceber') usarCredito(a); }
  salvarAt(a);
  if (extra.liberar && !(c.excecoes || []).some(x => x.data === o.data && (x.hora || '') === (o.hora || ''))) (c.excecoes ||= []).push({ data: o.data, hora: o.hora });
  salvarCadastro(c);
  render(history.state);
}
async function acoesListaVago(d, h) {
  const r = await janela(`${dataComDia(d)}, ${h}h`, [el('p', { class: 'suave', text: '🟡 Horário vago.' })],
    [{ rotulo: 'Fechar', valor: null }, { rotulo: '🔴 Sem atendimento neste dia', valor: 'bloquear' }, { rotulo: 'Agendar aqui', valor: 'agendar', estilo: 'primario' }]);
  if (r === 'bloquear') { bloqueiosDia().push({ data: d, h }); salvarPerfil(); render(history.state); }
  if (r === 'agendar') { agendamentoRasc = { pid: '', data: d, hora: `${String(h).padStart(2, '0')}:00`, repetir: 'nao', sessoes: String(MAX_SESSOES_SERIE), extras: [], ajustado: true }; ir({ tela: 'agendar' }); }
}
async function acoesListaBloqueado(d, h) {
  const doDia = bloqueiosDia().some(b => b.data === d && Number(b.h) === h);
  const r = await janela(`${dataComDia(d)}, ${h}h`, [el('p', { class: 'suave', text: doDia ? '🔴 Bloqueado só neste dia.' : '🔴 Sem atendimento toda semana neste horário (em Expediente e compromissos).' })],
    doDia ? [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Liberar este horário', valor: 'liberar', estilo: 'primario' }] : [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Abrir Expediente', valor: 'exp', estilo: 'primario' }]);
  if (r === 'liberar') { cfgAgenda().bloqueiosDia = bloqueiosDia().filter(b => !(b.data === d && Number(b.h) === h)); salvarPerfil(); render(history.state); }
  if (r === 'exp') ir({ tela: 'expediente' });
}

// ---------- Expediente e compromissos ----------
function telaExpediente() {
  const a = cfgAgenda();
  a.grade ||= JSON.parse(JSON.stringify(GRADE_PADRAO));
  const opcoesHora = () => Array.from({ length: 16 }, (_, i) => i + 7).map(h => el('option', { value: String(h), text: `${h}h` }));
  const selHora = (v, aoMudar) => { const s = el('select', {}, opcoesHora()); s.value = String(v); s.addEventListener('change', () => aoMudar(Number(s.value))); return s; };
  const dias = [1, 2, 3, 4, 5, 6, 0].map(dia => {
    const g = a.grade[dia];
    const chk = el('input', { type: 'checkbox', checked: !!g, onchange: e => { if (e.target.checked) a.grade[dia] = { de: 9, ate: dia === 6 ? 14 : 21 }; else delete a.grade[dia]; salvarPerfil(); render(history.state); } });
    return el('div', { class: 'linha-config' }, el('label', { class: 'marcar' }, chk, el('span', { text: DIAS[dia] })),
      g ? el('div', { class: 'botoes-mini' }, el('span', { class: 'suave pequeno', text: 'das' }), selHora(g.de, v => { g.de = v; salvarPerfil(); }), el('span', { class: 'suave pequeno', text: 'às' }), selHora(g.ate, v => { g.ate = v; salvarPerfil(); }))
        : el('span', { class: 'suave pequeno', text: 'Não atende' }));
  });
  const fixos = fixosSemPaciente().slice().sort((x, y) => ((x.dia || 7) - (y.dia || 7)) || x.de - y.de).map(f => el('div', { class: 'pag-linha' },
    el('span', { class: 'pag-info' }, el('strong', { text: `${(f.nome || '').trim() ? '⚠️ ' + f.nome : '🔴 Sem atendimento'}` }),
      el('span', { class: 'suave', text: `${DIAS[f.dia]}, ${f.de === f.ate ? `às ${f.de}h` : `das ${f.de}h às ${f.ate}h`}` })),
    el('button', { type: 'button', class: 'link perigo-texto', text: 'Excluir', onclick: () => { a.fixos = fixosSemPaciente().filter(x => x.id !== f.id); salvarPerfil(); render(history.state); } })));
  const novo = async tipo => {
    const sd = el('select', { 'aria-label': 'Dia' }, [1, 2, 3, 4, 5, 6, 0].map(d => el('option', { value: String(d), text: DIAS[d] })));
    const de = el('select', { 'aria-label': 'Das' }, opcoesHora()), ate = el('select', { 'aria-label': 'Até' }, opcoesHora());
    de.value = '12'; ate.value = '12';
    const nome = el('input', { type: 'text', placeholder: 'Ex.: Mestrado, Almoço, Orientadora', 'aria-label': 'Nome do compromisso' });
    const ok = await janela(tipo === 'comp' ? 'Novo compromisso fixo' : 'Novo horário sem atendimento', [
      el('label', { class: 'campo' }, el('span', { text: 'Dia da semana' }), sd),
      el('div', { class: 'grade duas' }, el('label', { class: 'campo' }, el('span', { text: 'Primeiro horário' }), de), el('label', { class: 'campo' }, el('span', { text: 'Último horário' }), ate)),
      tipo === 'comp' && el('label', { class: 'campo' }, el('span', { text: 'Nome' }), nome),
      el('p', { class: 'suave pequeno', text: 'Vale toda semana. Exemplo: Mestrado de 10h a 16h ocupa as linhas 10h, 11h, 12h, 13h, 14h, 15h e 16h.' })],
      [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }]);
    if (!ok) return;
    if (tipo === 'comp' && !nome.value.trim()) return aviso('Falta o nome', 'Escreva o nome do compromisso.');
    const [x, y] = [Number(de.value), Number(ate.value)].sort((p, q) => p - q);
    fixosSemPaciente().push({ id: crypto.randomUUID(), dia: Number(sd.value), de: x, ate: y, nome: tipo === 'comp' ? nome.value.trim() : '' });
    salvarPerfil(); render(history.state);
  };
  mostrar(
    cabecalho('Expediente e compromissos', { voltar: true }),
    el('div', { class: 'conteudo pilha' },
      el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: 'Horários de atendimento' }),
        el('p', { class: 'suave pequeno', text: 'As linhas da lista da semana vão do primeiro ao último horário de cada dia.' }), ...dias),
      el('section', { class: 'cartao' }, el('h3', { class: 'secao-titulo', text: 'Compromissos e horários fixos sem paciente' }),
        fixos.length ? fixos : el('p', { class: 'suave pequeno', text: 'Nenhum ainda.' }),
        el('div', { class: 'botoes-linha' },
          el('button', { type: 'button', class: 'secundario compacto', text: '+ ⚠️ Compromisso', onclick: () => novo('comp') }),
          el('button', { type: 'button', class: 'secundario compacto', text: '+ 🔴 Sem atendimento', onclick: () => novo('bloq') })))));
}

// Versão 27: tocar no dia da agenda abre as opções daquele dia.
async function acoesDiaAgenda(d) {
  const r = await janela(dataComDia(d), [el('p', { class: 'suave', text: 'O que deseja fazer neste dia?' })],
    [{ rotulo: 'Fechar', valor: null }, { rotulo: 'Ver na Lista da semana', valor: 'lista' }, { rotulo: 'Feriados e dias sem atendimento', valor: 'feriados' },
      { rotulo: '+ Agendar neste dia', valor: 'agendar', estilo: 'primario' }]);
  if (r === 'agendar') { agendamentoRasc = { pid: '', data: d, hora: '', repetir: 'semanal', sessoes: String(MAX_SESSOES_SERIE), extras: [], ajustado: true }; ir({ tela: 'agendar' }); }
  if (r === 'lista') ir({ tela: 'listaSemana', semana: d });
  if (r === 'feriados') ir({ tela: 'feriados' });
}

// Versão 31: cadastrar na hora, pelo nome, quem ainda não preencheu o Google Forms.
// Fica como cadastro provisório: quando a ficha do Forms chegar, "Atualizar do Drive" completa este mesmo cadastro.
async function pacienteRapido() {
  const v = await dialogo({ titulo: 'Paciente novo', texto: 'Escreva o nome como ele é chamado. Quando a ficha do Google Forms chegar, o cadastro é completado sem duplicar.',
    campos: [{ rotulo: 'Nome' }, { rotulo: 'Celular (WhatsApp), se tiver', tipo: 'tel' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Cadastrar', valor: true, estilo: 'primario' }] });
  if (!v || !(v[0] || '').trim()) return null;
  const nome = v[0].trim().replace(/\s+/g, ' ');
  const igual = cadastros.find(c => !c.arquivado && norm(c.nome) === norm(nome));
  if (igual) { await aviso('Já existe', `${igual.nome} já está cadastrado: foi escolhido na lista.`); return igual; }
  const c = await criarCadastro({ nome, nomeLista: nome, telefone: (v[1] || '').trim(), provisorio: true });
  if (modo === 'dono' && !pacientes.some(p => p.id === c.id)) {
    const agora = agoraISO();
    const p = { id: c.id, nome, criadoEm: agora, atualizadoEm: agora, arquivado: false,
      dados: { nascimento: '', cpf: '', telefone: c.telefone, contatoEmergencia: '', inicio: '', frequencia: '' }, demanda: '', temas: '', observacoes: '' };
    await Cofre.salvar('p:' + p.id, p);
    pacientes.push(p);
  }
  return c;
}

// =====================================================================
// Versão 43: pagamentos mais organizados — cartão claro na tela inicial e abas
// Resumo · Quem deve · Lista do mês (formato da "Lista de pagamentos") · Mensais (formato de "Pagamentos mensais").
// =====================================================================
function segmentoAbasMes(ym) {
  return segmentoEscolha(ABAS_MES, abaMes, k => { abaMes = k; telaMes(ym); }, 'quatro');
}
function devedores() {
  const ym = hojeISO().slice(0, 7);
  return cadastros.map(c => {
    const pend = atendimentosDe(c.id).filter(a => a.pagamento === 'areceber'); // marcou que veio (ou falta cobrada): já deve, mesmo que a data seja futura
    const total = pend.reduce((t, a) => t + valorDe(a), 0);
    const atraso = pend.filter(a => a.data.slice(0, 7) < ym).reduce((t, a) => t + valorDe(a), 0);
    return { c, pend, total, atraso, desde: pend.map(a => a.data).sort()[0] };
  }).filter(x => x.pend.length > 0).sort((a, b) => b.atraso - a.atraso || b.total - a.total); // aparece mesmo sem valor no cadastro
}
function cartaoPagamentosInicio(ym, tot) {
  const ds = devedores(), emAtraso = ds.filter(x => x.atraso > 0);
  const caixa = (rot, valor, extra, cls = '') => el('div', { class: 'pag-numero ' + cls }, el('small', { text: rot }), el('strong', { text: 'R$ ' + reais(valor) }), extra && el('span', { class: 'suave pequeno', text: extra }));
  return el('section', { class: 'cartao pagamentos-inicio' },
    el('button', { type: 'button', class: 'cartao-titulo dia-botao', onclick: () => { abaMes = 'resumo'; ir({ tela: 'mes' }); } },
      el('span', { class: 'ic-bolha' }, icone('moeda')), el('span', { text: `Pagamentos de ${nomeMes(ym).split(' ')[0].toLowerCase()}` }), el('span', { class: 'dia-mais', 'aria-hidden': 'true', text: '›' })),
    el('div', { class: 'pag-numeros' },
      caixa('Recebido no mês', tot.recebido, null, 'ok'),
      caixa('A receber neste mês', tot.aReceber, null),
      caixa('Em atraso (meses anteriores)', tot.anteriores, emAtraso.length ? `${emAtraso.length} ${emAtraso.length === 1 ? 'paciente' : 'pacientes'}` : 'ninguém', tot.anteriores > 0 ? 'alerta' : '')),
    el('div', { class: 'botoes-linha' },
      el('button', { type: 'button', class: 'secundario compacto', text: `Quem deve (${ds.length})`, onclick: () => { abaMes = 'devendo'; ir({ tela: 'mes' }); } }),
      el('button', { type: 'button', class: 'primario compacto', text: 'Fechamento', onclick: () => { abaMes = 'fechamento'; ir({ tela: 'mes' }); } }),
      el('button', { type: 'button', class: 'secundario compacto', text: 'Lista do mês', onclick: () => { abaMes = 'lista'; ir({ tela: 'mes' }); } }),
      el('button', { type: 'button', class: 'secundario compacto', text: 'Mensais', onclick: () => { abaMes = 'mensais'; ir({ tela: 'mes' }); } }),
      el('button', { type: 'button', class: 'secundario compacto', text: `Recibos (${cadastros.filter(pedeRecibo).length})`, onclick: () => { abaMes = 'recibos'; ir({ tela: 'mes' }); } })));
}
const MESES_CURTOS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const ddmm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
function telaMesAba(ym) {
  const nav = el('div', { class: 'navega' },
    el('button', { type: 'button', class: 'secundario compacto com-icone', onclick: () => ir({ tela: 'mes', ym: somarMeses(ym, -1) }, false) }, icone('voltar'), el('span', { text: 'Anterior' })),
    el('strong', { text: abaMes === 'mensais' ? 'Últimos 12 meses' : nomeMes(ym) }),
    el('button', { type: 'button', class: 'secundario compacto com-icone', disabled: ym >= hojeISO().slice(0, 7), onclick: () => ir({ tela: 'mes', ym: somarMeses(ym, 1) }, false) }, el('span', { text: 'Seguinte' }), icone('seguinte')));
  let corpo;
  if (abaMes === 'fechamento') corpo = corpoFechamento(ym);
  else if (abaMes === 'devendo') {
    const ds = devedores(), total = ds.reduce((t, x) => t + x.total, 0);
    corpo = [
      el('div', { class: 'cartao destaque total-clinica' }, el('small', { text: 'Total em aberto (sessões já realizadas ou cobradas)' }), el('strong', { text: 'R$ ' + reais(total) }),
        el('span', { text: `${ds.length} ${ds.length === 1 ? 'paciente' : 'pacientes'}` })),
      ds.length ? ds.map(x => el('button', { type: 'button', class: 'cartao paciente', onclick: () => ir({ tela: 'adm', id: x.c.id, aba: 'pagamentos' }) },
        avatar(x.c),
        el('span', { class: 'info' }, el('span', { class: 'nome', text: x.c.nome }),
          el('span', { class: 'meta' },
            x.atraso > 0 ? el('span', { class: 'selo areceber', text: `Em atraso R$ ${reais(x.atraso)}` }) : el('span', { class: 'selo parcial', text: 'Deste mês' }),
            el('span', { text: `${x.pend.length} ${x.pend.length === 1 ? 'sessão' : 'sessões'} desde ${ddmm(x.desde)}` }),
            )),
        el('strong', { class: 'valor-lista', text: x.total ? 'R$ ' + reais(x.total) : 'valor a definir' })))
        : el('div', { class: 'cartao vazio-cartao' }, el('span', { class: 'ic-bolha grande' }, icone('moeda')), el('p', { text: 'Ninguém devendo. 🎉' })),
      el('p', { class: 'suave pequeno', text: 'Toque no paciente para ver as sessões em aberto, registrar o pagamento ou mandar a mensagem de cobrança.' })];
  } else if (abaMes === 'recibos') {
    // Versão 57: só os pacientes que pedem recibo, com o que pagaram no mês e se o comprovante já saiu.
    const de = ym + '-01', ate = ym + '-' + String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate()).padStart(2, '0');
    const linhas = cadastros.filter(pedeRecibo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(c => {
      const gs = pagamentos.filter(g => g.pid === c.id && g.data.slice(0, 7) === ym);
      const pago = gs.reduce((t, g) => t + valorNum(g.valor), 0);
      const recibos = docsDe(c.id, 'emitido').filter(d => d.modelo === 'recibo' && (d.data || '').slice(0, 7) === ym);
      const notas = gs.filter(g => g.nf?.emitida);
      const feito = gs.length ? (c.nf ? notas.length === gs.length : recibos.length > 0 || notas.length === gs.length) : false;
      return { c, gs, pago, feito, recibos, notas };
    }).sort((a, b) => (b.gs.length && !b.feito) - (a.gs.length && !a.feito)); // quem tem recibo a emitir aparece primeiro
    const faltam = linhas.filter(x => x.gs.length && !x.feito).length;
    corpo = [
      el('div', { class: 'cartao destaque total-clinica' }, el('small', { text: 'Pacientes que pedem recibo' }), el('strong', { text: String(linhas.length) }),
        el('span', { text: faltam ? `${faltam} com recibo ou nota a emitir neste mês` : 'Nenhum comprovante pendente neste mês' })),
      linhas.length ? linhas.map(x => {
        const doc = (x.c.cpfPagador || x.c.cpf || '').trim();
        return el('div', { class: 'cartao pilha' },
          el('button', { type: 'button', class: 'cartao paciente', onclick: () => ir({ tela: 'adm', id: x.c.id, aba: 'documentos' }) },
            avatar(x.c),
            el('span', { class: 'info' }, el('span', { class: 'nome', text: x.c.nome }),
              el('span', { class: 'meta' },
                el('span', { class: 'selo ' + (x.c.nf ? 'nota' : 'parcial'), text: x.c.nf ? 'Nota fiscal' : 'Recibo' }),
                el('span', { text: (x.c.pagador ? `Pago por ${x.c.pagador}` : '') + (doc ? `${x.c.pagador ? ' · ' : ''}CPF ${doc}` : `${x.c.pagador ? ' · ' : ''}falta CPF`) }))),
            el('strong', { class: 'valor-lista', text: x.pago ? 'R$ ' + reais(x.pago) : '—' })),
          el('div', { class: 'linha-copiar' },
            el('span', { class: 'selo ' + (!x.gs.length ? '' : x.feito ? 'pago' : 'areceber'), text: !x.gs.length ? 'Sem pagamento no mês' : x.feito ? '✅ Emitido' : '⏳ A emitir' }),
            el('button', { type: 'button', class: x.gs.length && !x.feito ? 'primario compacto' : 'secundario compacto', text: 'Emitir', onclick: () => escolherRecibo(x.c, { soPagas: true, de, ate }) })));
      }) : el('div', { class: 'cartao vazio-cartao' }, el('span', { class: 'ic-bolha grande' }, icone('assinar')),
        el('p', { text: 'Nenhum paciente marcado. No cadastro do paciente, marque "Este paciente pede recibo".' })),
      el('p', { class: 'suave pequeno', text: 'Para entrar nesta lista: paciente → Cadastro → "Este paciente pede recibo". "Emitir" oferece o recibo do aplicativo ou a nota fiscal no site.' })];
  } else if (abaMes === 'lista') {
    const gs = pagamentos.filter(g => g.data.slice(0, 7) === ym).sort((a, b) => a.data.localeCompare(b.data));
    const total = gs.reduce((t, g) => t + valorNum(g.valor), 0);
    const consulta = g => {
      const c = cadastroDe(g.pid);
      const ats = atendimentos.filter(a => (g.atendimentos || []).includes(a.id)).map(a => a.data).sort();
      if (c && (c.modoPagamento === 'mensal' || c.modoPagamento === 'quinzenal') && ats.length > 2) return nomeMes(ats[0].slice(0, 7)).split(' ')[0].toLowerCase();
      return ats.length ? ats.map(ddmm).join(', ') : '—';
    };
    corpo = [
      el('div', { class: 'cartao destaque total-clinica' }, el('small', { text: `TOTAL de ${nomeMes(ym).toLowerCase()}` }), el('strong', { text: 'R$ ' + reais(total) }), el('span', { text: `${gs.length} ${gs.length === 1 ? 'pagamento' : 'pagamentos'}` })),
      el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela-pag' },
        el('thead', {}, el('tr', {}, ...['NOME', 'CONSULTA', 'VALOR', 'PAGAMENTO', 'NOTA'].map(t => el('th', { text: t })))),
        el('tbody', {}, gs.length ? gs.map(g => { const c = cadastroDe(g.pid);
          return el('tr', { onclick: () => c && dialogoPagamento(c, g) },
            el('td', { text: c ? (c.nomeLista || c.nome) : '—' }), el('td', { text: consulta(g) }), el('td', { class: 'num', text: reais(valorNum(g.valor)) }),
            el('td', { text: ddmm(g.data) }), el('td', { text: g.nf?.emitida ? (g.nf.numero ? 'nº ' + g.nf.numero : '✓') : (c?.nf ? 'pendente' : '—') }));
        }) : el('tr', {}, el('td', { colspan: '5', class: 'suave', text: 'Nenhum pagamento registrado neste mês.' }))))),
      el('p', { class: 'suave pequeno', text: 'É a "Lista de pagamentos" do mês, montada sozinha a partir dos pagamentos registrados. Toque numa linha para abrir o pagamento.' })];
  } else {
    const meses = Array.from({ length: 12 }, (_, i) => somarMeses(ym, -i));
    const mensais = cadastros.filter(c => !c.arquivado && (c.modoPagamento === 'mensal' || c.modoPagamento === 'quinzenal')).sort((a, b) => (Number(a.diaPagamento) || 99) - (Number(b.diaPagamento) || 99) || a.nome.localeCompare(b.nome, 'pt-BR'));
    // Olha as sessões de cada mês: todas pagas ✅, parte paga 🟡, nada pago 🔴 (no mês atual ainda ⏳).
    const marca = (c, m) => {
      const ats = atendimentosDe(c.id).filter(a => a.data.slice(0, 7) === m && (a.pagamento === 'areceber' || a.pagamento === 'pago'));
      if (!ats.length) return pagamentos.some(g => g.pid === c.id && g.data.slice(0, 7) === m) ? '✅' : '❌';
      const pagas = ats.filter(a => a.pagamento === 'pago').length;
      if (pagas === ats.length) return '✅';
      if (m >= hojeISO().slice(0, 7)) return '⏳';
      return pagas ? '🟡' : '🔴';
    };
    corpo = [
      el('div', { class: 'tabela-rolagem' }, el('table', { class: 'tabela-pag mensais' },
        el('thead', {}, el('tr', {}, el('th', { text: 'NOME' }), el('th', { text: 'DT' }), ...meses.map(m => el('th', { text: MESES_CURTOS[Number(m.slice(5)) - 1] })))),
        el('tbody', {}, mensais.length ? mensais.map(c => el('tr', { onclick: () => ir({ tela: 'adm', id: c.id, aba: 'pagamentos' }) },
          el('td', { text: c.nomeLista || c.nome }), el('td', { class: 'num', text: c.diaPagamento || '—' }), ...meses.map(m => el('td', { class: 'marca', text: marca(c, m) }))))
          : el('tr', {}, el('td', { colspan: String(meses.length + 2), class: 'suave', text: 'Nenhum paciente com pagamento mensal ou quinzenal.' }))))),
      el('div', { class: 'lista-legenda' }, ...[['✅', 'Pagou'], ['🟡', 'Pagou uma parte'], ['🔴', 'Em atraso'], ['⏳', 'Mês em andamento, ainda não pago'], ['❌', 'Sem sessões no mês']].map(([e, t]) => el('div', {}, el('span', { class: 'lista-emoji', text: e }), el('span', { text: t })))),
      el('p', { class: 'suave pequeno', text: 'É o quadro de "Pagamentos mensais", preenchido sozinho. DT é o dia combinado de pagamento (no cadastro do paciente).' })];
  }
  mostrar(cabecalho('Pagamentos', { voltar: true }),
    el('div', { class: 'conteudo pilha' }, segmentoAbasMes(ym), abaMes !== 'devendo' && abaMes !== 'fechamento' && nav, ...corpo),
    el('button', { type: 'button', class: 'fab estendido', onclick: () => { pagamentoRasc = null; ir({ tela: 'pagar' }); } }, icone('mais'), el('span', { text: 'Registrar pagamento' })));
}

// =====================================================================
// Versão 44: pagamento de cada sessão, direto onde a presença é marcada.
// Veio / faltou / desmarcou em cima da hora → a sessão fica "a receber" com o valor do cadastro;
// um toque em "Pagou" registra o pagamento daquela sessão (entra na Lista do mês e sai de "Quem deve").
// =====================================================================
function chipPagamentoSessao(c, a) {
  if (!a || !a.pagamento) return null;
  if (a.pagamento === 'pago') return el('span', { class: 'chip pago-chip', text: `✅ Pago R$ ${reais(valorDe(a))}` });
  if (a.pagamento === 'areceber') return el('button', { type: 'button', class: 'chip acao marcado', 'aria-label': `Pagamento da sessão de ${c.nome}`, text: valorDe(a) ? `⏳ A receber R$ ${reais(valorDe(a))}` : '⏳ A receber', onclick: e => { e.stopPropagation(); perguntarPagamento(c, a); } });
  return a.presenca ? el('span', { class: 'chip', text: a.abonada ? '🤝 Abonada' : 'Não cobra' }) : null;
}
// Versão 45: o toque pergunta primeiro se pagou; "Ainda não" deixa a sessão em "Quem deve" e guarda que foi conferida.
async function perguntarPagamento(c, a) {
  const r = await janela(`${c.nome}`, [el('p', { text: `Sessão de ${dataComDia(a.data)}${a.hora ? ', ' + horaCurta(a.hora) : ''}${valorDe(a) ? ' · R$ ' + reais(valorDe(a)) : ''}` }),
    el('p', { class: 'suave', text: a.conferidaEm ? `Conferido em ${dataCurta(a.conferidaEm)}: ainda não tinha pago.` : 'Está em "Quem deve" até o pagamento ser registrado.' })],
    [{ rotulo: 'Fechar', valor: null }, { rotulo: '✏️ Outro valor', valor: 'valor' }, { rotulo: 'Ainda não pagou', valor: 'nao' }, { rotulo: '✅ Pagou', valor: 'sim', estilo: 'primario' }]);
  if (r === 'sim') return pagarSessao(c, a);
  if (r === 'valor') return mudarValorSessao(c, a);
  if (r === 'nao') { a.conferidaEm = hojeISO(); salvarAt(a); indicarStatus('Continua em "Quem deve"'); render(history.state); }
}
// Versão 54: o valor da sessão não é fixo; muda só esta sessão, sem mexer no cadastro nem nas outras.
async function mudarValorSessao(c, a) {
  const r = await dialogo({ titulo: 'Valor desta sessão', texto: `${c.nome} · sessão de ${dataComDia(a.data)}${a.hora ? ', ' + horaCurta(a.hora) : ''}.`,
    campos: [{ rotulo: 'Valor (R$)', valor: valorDe(a) ? reais(valorDe(a)) : '' }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }] });
  if (!r) return;
  const v = valorNum(r);
  if (!v) return aviso('Falta o valor', 'Digite o valor desta sessão.');
  a.valor = String(v); salvarAt(a);
  indicarStatus(`Valor da sessão: R$ ${reais(v)}`);
  render(history.state);
  return perguntarPagamento(c, a);
}
async function pagarSessao(c, a) {
  const r = await dialogo({ titulo: 'Pagamento desta sessão', texto: `${c.nome} · sessão de ${dataComDia(a.data)}${a.hora ? ', ' + horaCurta(a.hora) : ''}.`,
    // O valor pode variar: vem sugerido do cadastro (se houver) e o administrativo digita o que foi pago.
    campos: [{ rotulo: 'Valor pago (R$)', valor: valorDe(a) ? reais(valorDe(a)) : '' }, { rotulo: 'Data do pagamento', tipo: 'date', valor: hojeISO() }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Registrar', valor: true, estilo: 'primario' }] });
  if (!r) return;
  const [valor, data] = r;
  if (!valorNum(valor)) return aviso('Falta o valor', 'Digite quanto foi pago.');
  if (valorNum(valor) !== valorDe(a)) { a.valor = String(valorNum(valor)); salvarAt(a); } // a sessão passa a valer o que foi pago
  const g = await registrarPagamento(c, { valor, data: data || hojeISO(), ids: [a.id] });
  indicarStatus('Pagamento registrado');
  render(history.state);
  // Versão 49: logo depois do pagamento, os dois jeitos de comprovar: recibo com texto próprio ou nota fiscal no Emissor Nacional (gov.br).
  const r2 = await janela('Pagamento registrado', [el('p', { text: `${c.nome} · R$ ${reais(valorNum(valor))}` }),
    el('p', { class: 'suave pequeno', text: 'Quer emitir o comprovante agora? Dá para fazer depois, no paciente → Pagamentos.' })],
    [{ rotulo: 'Agora não', valor: null }, { rotulo: '📄 Recibo', valor: 'recibo' }, { rotulo: '🏛️ Nota fiscal (gov.br)', valor: 'nota', estilo: c.nf ? 'primario' : undefined }]);
  if (r2 === 'recibo') novaDeclaracao(c, { modelo: 'recibo', soPagas: true, de: a.data.slice(0, 8) + '01', ate: a.data > hojeISO() ? a.data : hojeISO() });
  if (r2 === 'nota' && g) abrirNotaFiscal(c, g);
}


// =====================================================================
// Versão 58: lembretes para o administrativo.
// O Rodrigo escreve; o lembrete vai pela sincronização para a tela inicial do celular do assistente
// e, se ele quiser, também abre o WhatsApp do assistente com o texto pronto.
// Ficam fora da área clínica: o aviso pede para não escrever nada clínico.
// =====================================================================
// Versão 67: recados nos dois sentidos. l.para = 'adm' (do Rodrigo para o assistente) ou 'dono' (do assistente para o Rodrigo).
const paraMim = l => (l.para || 'adm') === (modo === 'adm' ? 'adm' : 'dono');
const lembretesAdmPendentes = () => lembretesAdm.filter(l => !l.feito && paraMim(l) && (l.desde || '') <= hojeISO())
  .sort((a, b) => (a.desde || '').localeCompare(b.desde || '') || (a.criadoEm || '').localeCompare(b.criadoEm || ''));
const enviadosPendentes = () => lembretesAdm.filter(l => !l.feito && !paraMim(l)).sort((a, b) => (a.criadoEm || '').localeCompare(b.criadoEm || ''));
const campoWhatsDestino = () => modo === 'adm' ? 'whatsDono' : 'whatsAdm';
const nomeDestino = () => modo === 'adm' ? 'o Rodrigo' : 'o assistente';
function numeroDestino() {
  const v = perfil[campoWhatsDestino()] || (modo === 'adm' ? perfil.telefone : '') || '';
  return numeroWhats(v) || null;
}
function textoLembreteAdm(l) {
  const c = l.pid ? cadastroDe(l.pid) : null;
  return `📌 ${(l.para || 'adm') === 'dono' ? 'Recado do administrativo' : 'Lembrete'}${c ? ' · ' + c.nome : ''}\n${l.texto}`;
}
async function enviarLembreteWhats(l) {
  const n = numeroDestino();
  if (!n) return aviso('Falta o número', `Coloque o WhatsApp de ${nomeDestino()} na janela do recado.`);
  abrirExterno(`https://wa.me/${n}?text=${encodeURIComponent(textoLembreteAdm(l))}`);
}
// Janela para escrever um recado ao outro lado (de um paciente ou geral).
async function novoLembreteAdm(pid = null, textoInicial = '', depois = null) {
  const c = pid ? cadastroDe(pid) : null;
  const doAdm = modo === 'adm';
  const texto = el('textarea', { rows: '3', placeholder: doAdm ? 'Ex.: a paciente pediu para trocar o horário de quinta' : c ? 'Ex.: confirmar o horário de quinta' : 'Ex.: comprar papel para a impressora' });
  texto.value = textoInicial || '';
  const cx = el('input', { type: 'checkbox', checked: true });
  const campoTel = campoWhatsDestino();
  const tel = el('input', { type: 'tel', inputmode: 'tel', value: perfil[campoTel] || (doAdm ? perfil.telefone || '' : ''), placeholder: '(21) 99999-9999' });
  const titulo = doAdm ? 'Recado para o Rodrigo' : 'Lembrete para o administrativo';
  const r = await janela(c ? `${titulo} · ${c.nome}` : titulo, [
    !doAdm && el('p', { class: 'faixa', text: 'O assistente vai ler este texto. Não escreva nada clínico.' }),
    el('label', { class: 'campo' }, el('span', { text: doAdm ? 'Recado' : 'Lembrete' }), texto),
    el('label', { class: 'marcar' }, cx, el('span', { text: `Enviar também pelo WhatsApp de ${nomeDestino()}` })),
    el('label', { class: 'campo' }, el('span', { text: `WhatsApp de ${nomeDestino()} (fica guardado)` }), tel),
    el('p', { class: 'suave pequeno', text: `Aparece na tela inicial de ${nomeDestino()} depois da sincronização (🔁), e lá ${doAdm ? 'ele' : 'ele'} marca "Feito".` })
  ], [{ rotulo: 'Cancelar', valor: null }, { rotulo: doAdm ? 'Enviar recado' : 'Enviar lembrete', valor: true, estilo: 'primario' }]);
  if (!r || !texto.value.trim()) return;
  if (tel.value.trim() !== (perfil[campoTel] || '') && numeroWhats(tel.value)) {
    perfil[campoTel] = tel.value.trim(); perfil.atualizadoEm = agoraISO(); await Cofre.salvar('x:perfil', perfil);
  }
  const agora = agoraISO();
  const l = { id: crypto.randomUUID(), tipoRegistro: 'lembrete', para: doAdm ? 'dono' : 'adm', pid: pid || null, texto: texto.value.trim(), desde: hojeISO(), feito: false, criadoEm: agora, atualizadoEm: agora };
  lembretesAdm.push(l); salvarLem(l);
  await salvarAgora();
  if (depois) depois();
  if (cx.checked) await enviarLembreteWhats(l);
  indicarStatus(doAdm ? 'Recado enviado ao Rodrigo.' : 'Lembrete enviado ao administrativo.');
  try { if (typeof sincronizarSozinho === 'function') sincronizarSozinho(); } catch { /* sincroniza na próxima vez */ }
  render(history.state);
}
function concluirLembreteAdm(l) {
  l.feito = true; l.feitoEm = agoraISO(); l.feitoPor = modo; salvarLem(l);
  render(history.state);
}
async function apagarLembreteAdm(l) {
  const ok = await dialogo({ titulo: 'Apagar?', texto: l.texto, botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Apagar', valor: true, estilo: 'perigo' }] });
  if (!ok) return;
  l.excluido = true; salvarLem(l);
  lembretesAdm = lembretesAdm.filter(x => x !== l);
  render(history.state);
}
// Cartão "Recados": o que chegou para mim (com Feito), o que mandei e ainda espera, e o que o outro lado concluiu nos últimos 3 dias.
function cartaoLembretesAdm(naTelaClinica = false) {
  const recebidos = lembretesAdmPendentes(), enviados = enviadosPendentes();
  const concluidos = lembretesAdm.filter(l => l.feito && !paraMim(l) && l.feitoEm && (Date.now() - new Date(l.feitoEm)) < 3 * 864e5);
  if (naTelaClinica && !recebidos.length && !enviados.length && !concluidos.length) return null;
  const outro = modo === 'adm' ? 'Rodrigo' : 'assistente';
  const nomePac = l => { const c = l.pid ? cadastroDe(l.pid) : null; return c && el('strong', { text: c.nome }); };
  const linhaRecebido = l => el('div', { class: 'pag-linha' },
    el('span', { class: 'pag-info' }, nomePac(l), el('span', { text: l.texto }),
      el('span', { class: 'suave pequeno', text: `${modo === 'adm' ? 'Do Rodrigo' : 'Do assistente'} · ${dataCurta((l.criadoEm || '').slice(0, 10) || hojeISO())}` })),
    el('button', { type: 'button', class: 'secundario compacto', text: 'Feito', onclick: () => concluirLembreteAdm(l) }));
  const linhaEnviado = l => el('div', { class: 'pag-linha' },
    el('span', { class: 'pag-info' }, nomePac(l), el('span', { text: l.texto }), el('span', { class: 'suave pequeno', text: `⏳ Aguardando o ${outro}` })),
    botaoIcone('Mandar de novo pelo WhatsApp', 'mensagem', () => enviarLembreteWhats(l)),
    botaoIcone('Apagar', 'lixeira', () => apagarLembreteAdm(l)));
  const linhaConcluido = l => el('div', { class: 'pag-linha' },
    el('span', { class: 'pag-info' }, el('span', { class: 'suave', text: `✅ ${l.texto}` }), el('span', { class: 'suave pequeno', text: `Feito pelo ${outro}` })),
    botaoIcone('Apagar', 'lixeira', () => apagarLembreteAdm(l)));
  const sub = t => el('p', { class: 'suave pequeno', text: t });
  return el('section', { class: 'cartao lembretes-adm' },
    el('h3', { class: 'cartao-titulo' }, el('span', { class: 'ic-bolha' }, icone('sino')),
      el('span', { text: `Recados ${modo === 'adm' ? 'com o Rodrigo' : 'com o administrativo'}${recebidos.length ? ` (${recebidos.length} para você)` : ''}` })),
    recebidos.length > 0 && sub(modo === 'adm' ? 'Do Rodrigo para você' : 'Do assistente para você'), ...recebidos.map(linhaRecebido),
    enviados.length > 0 && sub('Você mandou'), ...enviados.map(linhaEnviado),
    ...concluidos.map(linhaConcluido),
    !recebidos.length && !enviados.length && !concluidos.length && sub('Nenhum recado agora.'),
    el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => novoLembreteAdm() }, icone('mais'),
      el('span', { text: modo === 'adm' ? 'Novo recado para o Rodrigo' : 'Novo lembrete para o administrativo' })));
}


// =====================================================================
// Versão 60: avisos no celular (notificações) quando a sincronização traz novidade do outro aparelho.
// Funcionam com o app aberto ou minimizado (enquanto o Android não o congela). O aviso não mostra nomes nem conteúdo:
// diz só o que chegou; o detalhe fica dentro do app, atrás da senha. Com tudo fechado, o WhatsApp faz esse papel.
// =====================================================================
function fotoParaAvisos() {
  return { lemPend: new Set(lembretesAdm.filter(l => !l.feito).map(l => l.id)), lemFeito: new Set(lembretesAdm.filter(l => l.feito).map(l => l.id)),
    pags: new Set(pagamentos.map(g => g.id)), ats: new Map(atendimentos.map(a => [a.id, a.presenca || ''])) };
}
function avisarNovidades(antes) {
  const partes = [];
  if (modo === 'adm') {
    const novos = lembretesAdm.filter(l => !l.feito && paraMim(l) && !antes.lemPend.has(l.id) && !antes.lemFeito.has(l.id)).length;
    if (novos) partes.push(novos === 1 ? '1 lembrete novo do Rodrigo' : `${novos} lembretes novos do Rodrigo`);
    const feitosR = lembretesAdm.filter(l => l.feito && !paraMim(l) && !antes.lemFeito.has(l.id)).length;
    if (feitosR) partes.push(feitosR === 1 ? '1 recado visto pelo Rodrigo' : `${feitosR} recados vistos pelo Rodrigo`);
    const pres = atendimentos.filter(a => a.presenca && antes.ats.has(a.id) && antes.ats.get(a.id) !== a.presenca).length;
    if (pres) partes.push(pres === 1 ? '1 presença marcada' : `${pres} presenças marcadas`);
  } else {
    const recados = lembretesAdm.filter(l => !l.feito && paraMim(l) && !antes.lemPend.has(l.id) && !antes.lemFeito.has(l.id)).length;
    if (recados) partes.push(recados === 1 ? '1 recado do assistente' : `${recados} recados do assistente`);
    const feitos = lembretesAdm.filter(l => l.feito && l.feitoPor === 'adm' && !paraMim(l) && !antes.lemFeito.has(l.id)).length;
    if (feitos) partes.push(feitos === 1 ? '1 lembrete feito pelo assistente' : `${feitos} lembretes feitos pelo assistente`);
    const pags = pagamentos.filter(g => !antes.pags.has(g.id)).length;
    if (pags) partes.push(pags === 1 ? '1 pagamento registrado' : `${pags} pagamentos registrados`);
  }
  if (!partes.length) return;
  const texto = partes.join(' · ');
  indicarStatus('Novidade: ' + texto);
  mostrarNotificacao('Consultório', texto);
}
const avisosLigados = () => !!config.avisos && 'Notification' in window && Notification.permission === 'granted';
async function mostrarNotificacao(titulo, corpo) {
  if (!avisosLigados()) return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const op = { body: corpo, tag: 'consultorio-novidade', renotify: true, icon: 'icone-192.png', badge: 'icone-192.png', vibrate: [200, 100, 200] };
    if (reg?.showNotification) await reg.showNotification(titulo, op); else new Notification(titulo, op);
  } catch { /* sem aviso: a novidade continua no app */ }
}
async function alternarAvisos() {
  if (avisosLigados()) { config.avisos = false; await Cofre.salvarConfig(config); return render(history.state); }
  if (!('Notification' in window)) return aviso('Sem avisos', 'Este navegador não permite avisos. Abra o Consultório pelo ícone instalado na tela inicial.');
  const p = await Notification.requestPermission();
  if (p !== 'granted') return aviso('Avisos bloqueados', 'O Android não deu permissão. Para liberar: Configurações do Android → Apps → Consultório (ou Chrome) → Notificações → Permitir. Depois toque em Ativar de novo.');
  config.avisos = true; await Cofre.salvarConfig(config);
  await mostrarNotificacao('Consultório', 'Avisos ativados. Você será avisado quando chegar novidade do outro aparelho.');
  render(history.state);
}
function linhaAvisos(linha) {
  return linha('sino', 'Avisos no celular',
    avisosLigados() ? 'Ativados: avisa com som e vibração quando chega lembrete, presença ou pagamento do outro aparelho (com o app aberto ou minimizado).'
      : 'Desativados. Ative para ser avisado quando chegar novidade do outro aparelho.',
    el('button', { type: 'button', class: avisosLigados() ? 'secundario compacto' : 'primario compacto', text: avisosLigados() ? 'Desativar' : 'Ativar', onclick: alternarAvisos }));
}


// Janela para mudar o valor da sessão de um paciente a partir de uma data.
async function alterarValorSessao(c, aoFim) {
  const atual = valorNum(valorNaData(c));
  const hist = (c.valores || []).slice().sort((a, b) => b.desde.localeCompare(a.desde));
  const r = await dialogo({ titulo: `Valor da sessão · ${c.nome}`,
    texto: (atual ? `Valor atual: R$ ${reais(atual)}. ` : '') + 'O novo valor vale a partir da data escolhida; as sessões anteriores continuam com o valor antigo.'
      + (hist.length ? '\n\nHistórico: ' + hist.filter(v => valorNum(v.valor)).map(v => `R$ ${reais(valorNum(v.valor))} ${v.desde.startsWith('0000') ? 'antes' : 'desde ' + dataCurta(v.desde)}`).join(' · ') : ''),
    campos: [{ rotulo: 'Novo valor (R$)', valor: '', inputmode: 'decimal', placeholder: atual ? reais(atual) : '200,00' }, { rotulo: 'A partir de', tipo: 'date', valor: hojeISO() }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: true, estilo: 'primario' }] });
  if (!r) return;
  const [txt, desde0] = r; const novo = valorNum(txt), desde = desde0 || hojeISO();
  if (!novo) return aviso('Falta o valor', 'Digite o novo valor da sessão.');
  // valor que cada sessão teria antes da mudança (para não mexer em sessões com "outro valor" combinado)
  const ats = atendimentosDe(c.id).filter(a => a.data >= desde && a.pagamento !== 'pago');
  const antes = new Map(ats.map(a => [a.id, valorNum(valorNaData(c, a.data))]));
  if (!c.valores?.length) c.valores = [{ desde: '0000-01-01', valor: c.valor || '' }];
  c.valores = c.valores.filter(v => v.desde !== desde);
  c.valores.push({ desde, valor: String(novo) });
  c.valores.sort((a, b) => a.desde.localeCompare(b.desde));
  c.valor = String(valorNum(valorNaData(c)) || novo);
  c.atualizadoEm = agoraISO(); salvarCadastro(c);
  let mudadas = 0;
  for (const a of ats) if (!valorNum(a.valor) || valorNum(a.valor) === antes.get(a.id)) { a.valor = String(novo); salvarAt(a); mudadas++; }
  await salvarAgora();
  indicarStatus(`Valor de ${primeiroNome(c.nome)}: R$ ${reais(novo)} a partir de ${dataCurta(desde)}${mudadas ? ` (${mudadas} ${mudadas === 1 ? 'sessão atualizada' : 'sessões atualizadas'})` : ''}.`);
  if (aoFim) aoFim(); else render(history.state);
}


// =====================================================================
// Versão 66: importação automática do Google Forms ("Informações dos pacientes").
// A cada sincronização, se a planilha mudou: quem é novo vira cadastro (e ficha, no aparelho do Rodrigo);
// quem já existe (mesmo CPF ou mesmo nome) é atualizado com a resposta mais recente do formulário.
// O que foi editado no app só é trocado quando o paciente manda uma resposta nova no formulário.
// Os dois aparelhos podem importar: o paciente novo recebe sempre o mesmo código, então não duplica.
// =====================================================================
function codigoForms(rec) {
  const base = soDigitos(rec.cpf).length === 11 ? 'cpf' + soDigitos(rec.cpf) : 'nome' + norm(rec.nome);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const ch of base) { h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0; h2 = Math.imul(h2 + ch.charCodeAt(0), 2246822519) >>> 0; }
  return 'forms-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
const CAMPOS_FORMS = ['cpf', 'nascimento', 'email', 'telefone', 'telefone2', 'pix'];
async function autoImportarForms(token, agora0 = false) {
  const id = idDoLink(driveCfg().fontes?.pacientes);
  if (!id || !token) return null;
  let ultimo = {}; try { ultimo = JSON.parse(localStorage.getItem('consultorio-forms') || '{}'); } catch { }
  if (!agora0 && ultimo.em && Date.now() - ultimo.em < 5 * 60000) return null;   // sozinho: no máximo a cada 5 minutos; tocando no 🔁: sempre
  const meta = await (await driveApi(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime&supportsAllDrives=true`, token)).json();
  const salvarUltimo = () => { try { localStorage.setItem('consultorio-forms', JSON.stringify({ em: Date.now(), mod: meta.modifiedTime })); } catch { } };
  if (meta.modifiedTime && meta.modifiedTime === ultimo.mod) { salvarUltimo(); return null; }
  const recs = await lerFonte('pacientes', await baixarDoDrive(id, token));
  const agora = agoraISO();
  let novos = 0, atualizados = 0; const nomes = [];
  for (const r of recs) {
    const assin = JSON.stringify([r.nome, ...CAMPOS_FORMS.map(k => r[k] || ''), r.valor || '', r.modo || '']);
    let c = cadastros.find(x => (soDigitos(r.cpf).length === 11 && soDigitos(x.cpf) === soDigitos(r.cpf)) || norm(x.nome) === norm(r.nome)) || cadastroDe(codigoForms(r));
    if (!c) {
      const prov = cadastros.filter(x => x.provisorio && !soDigitos(x.cpf) && sugerirCadastro(x.nomeLista || x.nome, [{ id: 'ficha', nome: r.nome, apelidos: r.apelidos }]) === 'ficha');
      if (prov.length === 1) c = prov[0];
    }
    if (!c) {
      c = novoCadastro({ id: codigoForms(r), nome: r.nome, criadoEm: agora, atualizadoEm: agora });
      for (const k of CAMPOS_FORMS) if (r[k]) c[k] = r[k];
      if (r.valor) c.valor = r.valor;
      if (r.valorMensal) c.valorMensal = r.valorMensal;
      if (r.modo) c.modoPagamento = r.modo;
      c.formsAssinatura = assin; c.origem = 'formulário';
      cadastros.push(c); salvarCadastro(c); novos++; nomes.push(r.nome);
      for (const ap of r.apelidos || []) apelidos()[norm(ap)] ||= c.id;
      continue;
    }
    if (c.formsAssinatura === assin) continue;
    const primeiraVez = !c.formsAssinatura;   // já existia antes da importação automática: só preenche o vazio
    let mudou = false;
    if (c.provisorio && r.nome) { if (!c.nomeLista) c.nomeLista = c.nome; c.nome = r.nome; c.provisorio = false; mudou = true; }
    for (const k of CAMPOS_FORMS) if (r[k] && (primeiraVez ? !c[k] : c[k] !== r[k])) { c[k] = r[k]; mudou = true; }
    if (r.valor && !valorNum(c.valor) && !c.valores?.length) { c.valor = r.valor; mudou = true; }
    if (r.valorMensal && !valorNum(c.valorMensal)) { c.valorMensal = r.valorMensal; mudou = true; }
    if (r.modo && !c.modoPagamento) { c.modoPagamento = r.modo; mudou = true; }
    if (c.arquivado && !primeiraVez) { c.arquivado = false; mudou = true; }   // mandou o formulário de novo: voltou
    c.formsAssinatura = assin; c.atualizadoEm = agora; salvarCadastro(c);
    if (mudou && !primeiraVez) { atualizados++; nomes.push(c.nome); }
  }
  salvarUltimo();
  if (novos || atualizados) { salvarPerfil(); await salvarAgora(); if (modo === 'dono') { await sincronizarCadastros(); await salvarAgora(); } }
  return { novos, atualizados, nomes };
}


// =====================================================================
// Versão 68: Fechamento — mensal e anual.
// Previsto = sessões cobráveis do período (veio, faltou, desmarcou em cima da hora; não conta "Não cobra").
// Recebido = dessas sessões, as que já foram pagas. Não recebido = as que continuam a receber.
// Entrou no caixa = pagamentos registrados no período (inclui o que pagaram de meses anteriores).
// =====================================================================
let fechamentoAno = false;
function calcularFechamento(prefixo) {   // prefixo 'aaaa-mm' (mês) ou 'aaaa' (ano)
  const ats = atendimentos.filter(a => a.data.startsWith(prefixo) && !cadastroDe(a.pid)?.excluido);
  const cobraveis = ats.filter(a => a.pagamento === 'areceber' || a.pagamento === 'pago');
  const soma = l => l.reduce((t, a) => t + valorDe(a), 0);
  const pagas = cobraveis.filter(a => a.pagamento === 'pago'), abertas = cobraveis.filter(a => a.pagamento === 'areceber');
  const naoCobradas = ats.filter(a => a.pagamento === 'naocobrar' && ['realizada', 'falta', 'tardia'].includes(a.presenca));
  const r = {
    previsto: soma(cobraveis), recebido: soma(pagas), naoRecebido: soma(abertas), qtdPrevisto: cobraveis.length, qtdAbertas: abertas.length,
    naoCobradas: soma(naoCobradas), qtdNaoCobradas: naoCobradas.length,
    desmarcadas: ats.filter(a => a.presenca === 'cancelada' || a.presenca === 'remarcada').length,
    realizadas: ats.filter(a => a.presenca === 'realizada').length, faltas: ats.filter(a => a.presenca === 'falta' || a.presenca === 'tardia').length,
    caixa: pagamentos.filter(g => g.data.startsWith(prefixo)).reduce((t, g) => t + valorNum(g.valor), 0)
  };
  const porPac = new Map();
  for (const a of abertas) { const x = porPac.get(a.pid) || { c: cadastroDe(a.pid), total: 0, n: 0 }; x.total += valorDe(a); x.n++; porPac.set(a.pid, x); }
  r.devedores = [...porPac.values()].filter(x => x.c).sort((a, b) => b.total - a.total);
  r.pct = r.previsto ? Math.round(r.recebido / r.previsto * 100) : 0;
  return r;
}
function corpoFechamento(ym) {
  const ano = ym.slice(0, 4), hojeYm = hojeISO().slice(0, 7);
  const prefixo = fechamentoAno ? ano : ym;
  const f = calcularFechamento(prefixo);
  const titulo = fechamentoAno ? `Ano de ${ano}` : nomeMes(ym);
  const passo = fechamentoAno ? 12 : 1;
  const nav = el('div', { class: 'navega' },
    el('button', { type: 'button', class: 'secundario compacto com-icone', onclick: () => ir({ tela: 'mes', ym: somarMeses(ym, -passo) }, false) }, icone('voltar'), el('span', { text: 'Anterior' })),
    el('strong', { text: titulo }),
    el('button', { type: 'button', class: 'secundario compacto com-icone', disabled: fechamentoAno ? ano >= hojeYm.slice(0, 4) : ym >= hojeYm, onclick: () => { const alvo = somarMeses(ym, passo); ir({ tela: 'mes', ym: alvo > hojeYm ? hojeYm : alvo }, false); } }, el('span', { text: 'Seguinte' }), icone('seguinte')));
  const caixa = (rot, valor, extra, cls = '') => el('div', { class: 'cartao numero ' + cls }, el('small', { text: rot }), el('strong', { text: 'R$ ' + reais(valor) }), extra && el('span', { class: 'suave pequeno', text: extra }));
  const barra = (pct, cls) => { const b = el('span', { class: 'barra-preenchida ' + cls }); b.style.width = Math.max(0, Math.min(100, pct)) + '%'; return b; };
  const partes = [
    segmentoEscolha({ mes: 'Mensal', ano: 'Anual' }, fechamentoAno ? 'ano' : 'mes', k => { fechamentoAno = k === 'ano'; telaMes(ym); }, 'dois'),
    nav,
    el('div', { class: 'cartao destaque total-clinica' },
      el('small', { text: `Recebido das sessões de ${fechamentoAno ? ano : nomeMes(ym).split(' ')[0].toLowerCase()}` }),
      el('strong', { text: 'R$ ' + reais(f.recebido) }),
      el('span', { text: f.previsto ? `${f.pct}% do previsto (R$ ${reais(f.previsto)})` : 'Nenhuma sessão cobrável no período' }),
      f.previsto > 0 && el('span', { class: 'barra-fechamento' }, barra(f.pct, 'ok'), barra(100 - f.pct, 'alerta'))),
    el('div', { class: 'resumo-fin' },
      caixa('Previsto', f.previsto, `${f.qtdPrevisto} ${f.qtdPrevisto === 1 ? 'sessão cobrável' : 'sessões cobráveis'}`),
      caixa('Não recebido', f.naoRecebido, f.qtdAbertas ? `${f.qtdAbertas} ${f.qtdAbertas === 1 ? 'sessão' : 'sessões'} · ${f.devedores.length} ${f.devedores.length === 1 ? 'paciente' : 'pacientes'}` : 'tudo pago', f.naoRecebido ? 'alerta' : 'ok')),
    el('div', { class: 'resumo-fin' },
      caixa('Entrou no caixa', f.caixa, 'pagamentos feitos no período, inclusive de meses anteriores'),
      caixa('Não cobradas', f.naoCobradas, f.qtdNaoCobradas ? `${f.qtdNaoCobradas} ${f.qtdNaoCobradas === 1 ? 'sessão abonada' : 'sessões abonadas'}` : 'nenhuma')),
    el('p', { class: 'suave pequeno', text: `Sessões: ${f.realizadas} ${f.realizadas === 1 ? 'realizada' : 'realizadas'} · ${f.faltas} ${f.faltas === 1 ? 'falta cobrável' : 'faltas cobráveis'} · ${f.desmarcadas} ${f.desmarcadas === 1 ? 'desmarcada com aviso ou remarcada' : 'desmarcadas com aviso ou remarcadas'} (não entram na conta).` })];
  if (fechamentoAno) {
    const linhasMes = [];
    for (let m = 1; m <= 12; m++) {
      const p = `${ano}-${String(m).padStart(2, '0')}`;
      if (p > hojeYm) break;
      const x = calcularFechamento(p);
      linhasMes.push(el('button', { type: 'button', class: 'linha-fechamento', onclick: () => { fechamentoAno = false; ir({ tela: 'mes', ym: p }, false); } },
        el('strong', { text: MESES_CURTOS[m - 1] }),
        el('span', { class: 'barra-fechamento' }, x.previsto ? barra(x.pct, 'ok') : null, x.previsto ? barra(100 - x.pct, 'alerta') : null),
        el('span', { class: 'pequeno', text: x.previsto ? `R$ ${reais(x.recebido)} de R$ ${reais(x.previsto)}` : '—' }),
        el('span', { class: 'pequeno ' + (x.naoRecebido ? 'texto-alerta' : 'suave'), text: x.naoRecebido ? `falta R$ ${reais(x.naoRecebido)}` : x.previsto ? 'tudo pago' : '' })));
    }
    partes.push(cartao('Mês a mês', 'calendario', el('p', { class: 'suave pequeno', text: 'Verde: recebido. Vermelho: não recebido. Toque no mês para ver o fechamento dele.' }), ...linhasMes));
  }
  partes.push(cartao(fechamentoAno ? `Quem não pagou em ${ano}` : 'Quem não pagou neste mês', 'moeda',
    f.devedores.length ? f.devedores.map(x => el('button', { type: 'button', class: 'pag-linha linha-botao', onclick: () => ir({ tela: 'adm', id: x.c.id, aba: 'pagamentos' }) },
      el('span', { class: 'pag-info' }, el('strong', { text: x.c.nome }), el('span', { class: 'suave', text: `${x.n} ${x.n === 1 ? 'sessão' : 'sessões'}` })),
      el('strong', { class: 'texto-alerta', text: x.total ? 'R$ ' + reais(x.total) : 'valor a definir' })))
      : el('p', { class: 'suave', text: 'Ninguém deve sessões deste período. 🎉' })));
  partes.push(el('button', { type: 'button', class: 'secundario com-icone centralizado', onclick: () => pdfFechamento(prefixo, f, titulo) }, icone('assinar'), el('span', { text: 'Gerar PDF do fechamento' })));
  return partes;
}
async function pdfFechamento(prefixo, f, titulo) {
  const linhas = [`Fechamento — ${titulo}`, perfil.clinica || perfil.nome || '', '',
    `Previsto (sessões cobráveis): R$ ${reais(f.previsto)} (${f.qtdPrevisto} sessões)`,
    `Recebido dessas sessões: R$ ${reais(f.recebido)} (${f.pct}%)`,
    `Não recebido: R$ ${reais(f.naoRecebido)} (${f.qtdAbertas} sessões)`,
    `Entrou no caixa no período: R$ ${reais(f.caixa)}`,
    `Não cobradas (abonadas): R$ ${reais(f.naoCobradas)} (${f.qtdNaoCobradas} sessões)`,
    `Sessões: ${f.realizadas} realizadas · ${f.faltas} faltas cobráveis · ${f.desmarcadas} desmarcadas/remarcadas`, ''];
  if (prefixo.length === 4) {
    linhas.push('Mês a mês:');
    for (let m = 1; m <= 12; m++) { const p = `${prefixo}-${String(m).padStart(2, '0')}`; if (p > hojeISO().slice(0, 7)) break; const x = calcularFechamento(p);
      linhas.push(`  ${MESES_CURTOS[m - 1]}: previsto R$ ${reais(x.previsto)} · recebido R$ ${reais(x.recebido)} · não recebido R$ ${reais(x.naoRecebido)}`); }
    linhas.push('');
  }
  linhas.push('Quem não pagou:');
  for (const x of f.devedores) linhas.push(`  ${x.c.nome}: R$ ${reais(x.total)} (${x.n} ${x.n === 1 ? 'sessão' : 'sessões'})`);
  if (!f.devedores.length) linhas.push('  ninguém');
  linhas.push('', `Gerado em ${dataCurta(hojeISO())}.`);
  linhas.shift(); linhas.shift();
  const bytes = gerarPdfDocumento({ titulo: `Fechamento — ${titulo}`, texto: linhas.join('\n'), emissao: hojeISO() });
  await compartilharDocumento({ nome: `fechamento-${prefixo}.pdf`, mime: 'application/pdf', descricao: `Fechamento — ${titulo}` }, bytes);
}


// =====================================================================
// Versão 70: encerrar o atendimento de quem parou de vir.
// Os horários ganham data final, as sessões futuras saem da agenda e o paciente sai de "Atendendo agora".
// Não é arquivado: continua em "Todos", e o que deve continua em "Quem deve" e no Fechamento, com data e valor.
// =====================================================================
async function encerrarAtendimento(c, aoFim) {
  const r = await dialogo({ titulo: `Encerrar o atendimento de ${c.nome}?`,
    texto: 'A partir da data escolhida: os horários fixos acabam, as sessões marcadas daqui para frente saem da agenda e o paciente sai de "Atendendo agora". Ele continua na lista de todos os pacientes, e o que estiver devendo continua em "Quem deve", com as datas e os valores. Dá para retomar depois.',
    campos: [{ rotulo: 'Encerrar a partir de', tipo: 'date', valor: hojeISO() }],
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Encerrar', valor: true, estilo: 'perigo' }] });
  if (!r) return;
  const desde = (Array.isArray(r) ? r[0] : r) || hojeISO();
  for (const h of horariosDe(c)) if (!h.fim || h.fim > desde) { h.fimAntes = h.fim || null; h.fim = desde; }
  c.avulsosEncerrados = (c.avulsos || []).filter(a => a.data >= desde);
  c.avulsos = (c.avulsos || []).filter(a => a.data < desde);
  // sessões futuras sem presença marcada e não pagas saem; as cobradas/pagas ficam (são dívida ou histórico)
  for (const a of atendimentosDe(c.id).filter(a => a.data >= desde && !a.presenca && a.pagamento !== 'pago' && a.pagamento !== 'areceber')) await excluirAtendimento(a);
  c.encerradoEm = desde; c.atualizadoEm = agoraISO(); salvarCadastro(c);
  await salvarAgora();
  indicarStatus(`Atendimento de ${primeiroNome(c.nome)} encerrado a partir de ${dataCurta(desde)}.`);
  if (aoFim) aoFim(); else render(history.state);
}
async function retomarAtendimento(c, aoFim) {
  const ok = await dialogo({ titulo: `Retomar o atendimento de ${c.nome}?`, texto: 'Os horários fixos voltam a valer e o paciente volta para "Atendendo agora". As sessões avulsas que estavam marcadas voltam para a agenda.',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Retomar', valor: true, estilo: 'primario' }] });
  if (!ok) return;
  for (const h of horariosDe(c)) if (h.fim === c.encerradoEm) { h.fim = h.fimAntes || undefined; if (!h.fim) delete h.fim; delete h.fimAntes; }
  if (c.avulsosEncerrados?.length) { c.avulsos = [...(c.avulsos || []), ...c.avulsosEncerrados.filter(a => a.data >= hojeISO())]; }
  delete c.avulsosEncerrados; delete c.encerradoEm;
  c.atualizadoEm = agoraISO(); salvarCadastro(c);
  await salvarAgora();
  indicarStatus(`Atendimento de ${primeiroNome(c.nome)} retomado.`);
  if (aoFim) aoFim(); else render(history.state);
}
