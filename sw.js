/* Guarda os arquivos do app no aparelho para funcionar sem internet.
   Só baixa os próprios arquivos do app; nunca envia dados.
   Ao publicar uma nova versão, mude o número abaixo. */
const VERSAO = 'consultorio-v4';
const ARQUIVOS = ['./', './index.html', './estilo.css', './cofre.js', './app.js',
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
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
