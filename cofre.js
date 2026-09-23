'use strict';
/*
  COFRE — tudo o que é gravado passa por aqui e é cifrado antes.

  Como funciona, em linguagem simples:
  - Existe uma "chave dos dados" aleatória (256 bits). É ela que cifra fichas e sessões.
  - Essa chave nunca é gravada aberta. Ela fica guardada dentro de um "envelope",
    trancado pela sua senha mestra (e, se ativada, por um segundo envelope trancado pela biometria).
  - Ao desbloquear, o envelope é aberto e a chave passa a existir só na memória.
    Ao bloquear, ela é descartada.
  - Nada aqui acessa a internet.
*/
const Cofre = (() => {
  const NOME_DB = 'consultorio-cofre';
  const ITERACOES = 600000; // PBKDF2-SHA256: torna tentativas de adivinhar a senha muito lentas
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  let promessaDB = null;
  let chaveDados = null; // só existe enquanto o app está desbloqueado

  // ---------- Banco local (IndexedDB) ----------
  function db() {
    if (!promessaDB) {
      promessaDB = new Promise((ok, erro) => {
        const req = indexedDB.open(NOME_DB, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
          if (!d.objectStoreNames.contains('registros')) d.createObjectStore('registros');
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => erro(req.error);
      });
    }
    return promessaDB;
  }

  async function operar(loja, modo, fn) {
    const d = await db();
    return new Promise((ok, erro) => {
      const tx = d.transaction(loja, modo);
      const req = fn(tx.objectStore(loja));
      tx.oncomplete = () => ok(req ? req.result : undefined);
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error);
    });
  }
  const obter = (loja, k) => operar(loja, 'readonly', s => s.get(k));
  const gravar = (loja, k, v) => operar(loja, 'readwrite', s => s.put(v, k));
  const remover = (loja, k) => operar(loja, 'readwrite', s => s.delete(k));

  async function listar(prefixo) {
    const d = await db();
    return new Promise((ok, erro) => {
      const tx = d.transaction('registros', 'readonly');
      const s = tx.objectStore('registros');
      const faixa = IDBKeyRange.bound(prefixo, prefixo + '\uffff');
      const rk = s.getAllKeys(faixa);
      const rv = s.getAll(faixa);
      tx.oncomplete = () => ok(rk.result.map((k, i) => [k, rv.result[i]]));
      tx.onerror = () => erro(tx.error);
    });
  }

  // ---------- Criptografia ----------
  const aleatorio = n => crypto.getRandomValues(new Uint8Array(n));

  async function cifrar(chave, bytes, contexto) {
    const iv = aleatorio(12);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(contexto) }, chave, bytes);
    return { iv, ct: new Uint8Array(ct) };
  }
  async function decifrar(chave, env, contexto) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: env.iv, additionalData: enc.encode(contexto) }, chave, env.ct);
    return new Uint8Array(pt);
  }

  async function chaveDaSenha(senha, sal, iter) {
    const base = await crypto.subtle.importKey(
      'raw', enc.encode(senha.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function chaveDaBiometria(saida) {
    const base = await crypto.subtle.importKey('raw', saida, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('consultorio/biometria/v1') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function brutaPelaSenha(senha) {
    const m = await obter('meta', 'senha');
    if (!m) throw new Error('sem-cofre');
    const kek = await chaveDaSenha(senha, m.sal, m.iter);
    try { return await decifrar(kek, m.envelope, 'envelope-senha'); }
    catch { throw new Error('senha-incorreta'); }
  }

  async function abrirCom(bruta) {
    chaveDados = await crypto.subtle.importKey('raw', bruta, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    bruta.fill(0);
  }

  function exigirAberto() {
    if (!chaveDados) throw new Error('cofre-trancado');
    return chaveDados;
  }

  // ---------- Biometria (chave de acesso do Android, extensão PRF) ----------
  async function saidaBiometrica(credId, sal) {
    const a = await navigator.credentials.get({
      publicKey: {
        challenge: aleatorio(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credId }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: sal } } }
      }
    });
    const r = a.getClientExtensionResults?.().prf?.results?.first;
    if (!r) throw new Error('prf-indisponivel');
    return new Uint8Array(r);
  }

  function b64(u) {
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deB64(t) {
    const s = atob(t);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  // ---------- Interface pública ----------
  return {
    aberto: () => chaveDados !== null,
    trancar() { chaveDados = null; },

    async existe() { return !!(await obter('meta', 'senha')); },

    async criar(senha) {
      const bruta = aleatorio(32);
      const sal = aleatorio(16);
      const kek = await chaveDaSenha(senha, sal, ITERACOES);
      const envelope = await cifrar(kek, bruta, 'envelope-senha');
      await gravar('meta', 'senha', { v: 1, sal, iter: ITERACOES, envelope });
      await abrirCom(bruta);
    },

    async abrirComSenha(senha) { await abrirCom(await brutaPelaSenha(senha)); },

    async trocarSenha(atual, nova) {
      const bruta = await brutaPelaSenha(atual);
      try {
        const sal = aleatorio(16);
        const kek = await chaveDaSenha(nova, sal, ITERACOES);
        const envelope = await cifrar(kek, bruta, 'envelope-senha');
        await gravar('meta', 'senha', { v: 1, sal, iter: ITERACOES, envelope });
      } finally { bruta.fill(0); }
    },

    async salvar(chave, objeto) {
      const k = exigirAberto();
      const env = await cifrar(k, enc.encode(JSON.stringify(objeto)), chave);
      await gravar('registros', chave, env);
    },

    async ler(chave) {
      const k = exigirAberto();
      const env = await obter('registros', chave);
      if (!env) return null;
      return JSON.parse(dec.decode(await decifrar(k, env, chave)));
    },

    async lerTodos(prefixo) {
      const k = exigirAberto();
      const pares = await listar(prefixo);
      return Promise.all(pares.map(async ([chave, env]) =>
        JSON.parse(dec.decode(await decifrar(k, env, chave)))));
    },

    apagar: chave => remover('registros', chave),

    // Preferências não clínicas (ex.: tempo de bloqueio) — não são cifradas.
    async lerConfig() { return (await obter('meta', 'config')) || {}; },
    salvarConfig: c => gravar('meta', 'config', c),

    async biometriaAtiva() { return !!(await obter('meta', 'bio')); },

    async ativarBiometria(senha) {
      if (!window.PublicKeyCredential) throw new Error('prf-indisponivel');
      const bruta = await brutaPelaSenha(senha);
      try {
        const sal = aleatorio(32);
        const cred = await navigator.credentials.create({
          publicKey: {
            rp: { name: 'Consultório', id: location.hostname },
            user: { id: aleatorio(16), name: 'consultorio', displayName: 'Consultório' },
            challenge: aleatorio(32),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
            timeout: 60000,
            extensions: { prf: { eval: { first: sal } } }
          }
        });
        const ext = cred.getClientExtensionResults?.() || {};
        if (!ext.prf || ext.prf.enabled === false) throw new Error('prf-indisponivel');
        const credId = new Uint8Array(cred.rawId);
        let saida = ext.prf.results?.first ? new Uint8Array(ext.prf.results.first) : null;
        if (!saida) saida = await saidaBiometrica(credId, sal); // alguns aparelhos pedem um segundo toque
        const kek = await chaveDaBiometria(saida);
        const envelope = await cifrar(kek, bruta, 'envelope-bio');
        await gravar('meta', 'bio', { v: 1, credId, sal, envelope });
      } finally { bruta.fill(0); }
    },

    async abrirComBiometria() {
      const b = await obter('meta', 'bio');
      if (!b) throw new Error('sem-biometria');
      const kek = await chaveDaBiometria(await saidaBiometrica(b.credId, b.sal));
      let bruta;
      try { bruta = await decifrar(kek, b.envelope, 'envelope-bio'); }
      catch { throw new Error('bio-invalida'); }
      await abrirCom(bruta);
    },

    desativarBiometria: () => remover('meta', 'bio'),

    // Backup: o pacote inteiro é cifrado com uma senha própria antes de sair do aparelho.
    async cifrarPacote(senha, objeto) {
      const sal = aleatorio(16);
      const kek = await chaveDaSenha(senha, sal, ITERACOES);
      const env = await cifrar(kek, enc.encode(JSON.stringify(objeto)), 'backup-v1');
      return JSON.stringify({ formato: 'consultorio-backup', v: 1, sal: b64(sal), iter: ITERACOES, iv: b64(env.iv), ct: b64(env.ct) });
    },

    async decifrarPacote(senha, texto) {
      let d;
      try { d = JSON.parse(texto); } catch { throw new Error('arquivo-invalido'); }
      if (!d || d.formato !== 'consultorio-backup') throw new Error('arquivo-invalido');
      const kek = await chaveDaSenha(senha, deB64(d.sal), d.iter);
      try { return JSON.parse(dec.decode(await decifrar(kek, { iv: deB64(d.iv), ct: deB64(d.ct) }, 'backup-v1'))); }
      catch { throw new Error('senha-incorreta'); }
    }
  };
})();
