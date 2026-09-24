/* Guarda os arquivos do app no aparelho para funcionar sem internet.
   Só baixa os próprios arquivos do app; nunca envia dados.
   Também recebe comprovantes compartilhados de outros apps (WhatsApp, banco)
   e os guarda já cifrados, sem enviá-los a lugar nenhum.
   Ao publicar uma nova versão, mude o número abaixo. */
const VERSAO = 'consultorio-v11';
const ARQUIVOS = ['./', './index.html', './estilo.css', './cofre.js', './app.js', './admin.js',
  './manifest.webmanifest', './icone-192.png', './icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('consultorio-') && k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/receber')) { e.respondWith(receber(e.request)); return; }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});

// ---------- Comprovantes compartilhados ----------
function abrirDB() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open('consultorio-cofre', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('registros')) d.createObjectStore('registros');
      if (!d.objectStoreNames.contains('entrada')) d.createObjectStore('entrada');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}
const operar = (d, loja, modo, fn) => new Promise((ok, erro) => {
  const tx = d.transaction(loja, modo);
  const r = fn(tx.objectStore(loja));
  tx.oncomplete = () => ok(r.result);
  tx.onerror = () => erro(tx.error);
});

async function receber(request) {
  let destino = './?recebido=1';
  try {
    const form = await request.formData();
    const arquivos = form.getAll('arquivos').filter(f => f && typeof f === 'object' && f.size > 0);
    const d = await abrirDB();
    const pubJwk = await operar(d, 'meta', 'readonly', s => s.get('entradaPub'));
    if (!pubJwk) throw new Error('sem-chave');
    const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    for (const f of arquivos.slice(0, 10)) {
      if (f.size > 25 * 1048576) continue;
      // Cifra com uma chave de uso único combinada com a chave pública do cofre.
      const efem = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
      const k = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, efem.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, await f.arrayBuffer()));
      const epk = new Uint8Array(await crypto.subtle.exportKey('raw', efem.publicKey));
      const id = Date.now().toString(36) + '-' + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
      await operar(d, 'entrada', 'readwrite', s => s.put({ epk, iv, ct, nome: f.name || 'comprovante', mime: f.type || 'application/octet-stream', tamanho: f.size, recebidoEm: new Date().toISOString() }, id));
    }
    d.close();
  } catch { destino = './?recebido=erro'; }
  return Response.redirect(destino, 303);
}
