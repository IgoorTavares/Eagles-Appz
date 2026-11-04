// FIREBASE FALSO — só para os testes de navegador da LABZ AI (Fase S4). Nunca vai para o site.
// Simula o mínimo do SDK compat 10.x que o script.js usa: login (onAuthStateChanged, currentUser,
// getIdToken) e um Firestore em memória que só conhece usuarios/{uid}. O papel e o comportamento
// do token vêm de window.__TESTE (posto pelo teste antes de a página carregar).
(function () {
  const T = window.__TESTE || {};
  const vazio = { exists: false, id: '', data: () => undefined, get: () => undefined };
  const consultaVazia = { empty: true, size: 0, docs: [], forEach() {}, docChanges: () => [] };
  let tokensPedidos = 0;
  const user = {
    uid: T.uid || 'sa', email: T.email || 'sa@teste.local', displayName: 'Teste',
    async getIdToken(forcar) {
      tokensPedidos += 1;
      window.__tokensPedidos = tokensPedidos;
      const r = await fetch(`/__teste/token?uid=${encodeURIComponent(T.tokenUid || T.uid || 'sa')}&modo=${encodeURIComponent(forcar ? 'novo' : (T.tokenModo || 'valido'))}`, { cache: 'no-store' });
      return (await r.json()).token;
    },
  };
  function doc(colecao, id) {
    const caminho = `${colecao}/${id}`;
    return {
      id,
      async get() {
        if (caminho === `usuarios/${user.uid}` && T.role) return { exists: true, id, data: () => ({ role: T.role, nome: 'Teste', tenantId: T.tenantId || null }) };
        return Object.assign({}, vazio, { id });
      },
      onSnapshot(a, b) { const cb = typeof a === 'function' ? a : b; setTimeout(() => { try { cb(Object.assign({}, vazio, { id })); } catch (e) { /* ignora */ } }, 0); return () => {}; },
      set: async () => {}, update: async () => {}, delete: async () => {},
      collection: (c) => colecaoRef(`${caminho}/${c}`),
    };
  }
  function colecaoRef(nome) {
    const q = {
      doc: (id) => doc(nome, id || 'auto'),
      add: async () => doc(nome, 'auto'),
      where: () => q, orderBy: () => q, limit: () => q, startAfter: () => q, limitToLast: () => q,
      get: async () => consultaVazia,
      onSnapshot(a, b) { const cb = typeof a === 'function' ? a : b; setTimeout(() => { try { cb(consultaVazia); } catch (e) { /* ignora */ } }, 0); return () => {}; },
    };
    return q;
  }
  const db = {
    collection: colecaoRef, doc: (p) => { const x = p.split('/'); return doc(x.slice(0, -1).join('/'), x[x.length - 1]); },
    enablePersistence: () => Promise.resolve(), batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
    runTransaction: async (fn) => fn({ get: async () => vazio, set() {}, update() {} }),
  };
  const auth = {
    currentUser: T.logado === false ? null : user,
    onAuthStateChanged(cb) { setTimeout(() => cb(auth.currentUser), 0); return () => {}; },
    signOut: async () => { auth.currentUser = null; },
    setPersistence: async () => {},
  };
  const app = { options: { projectId: 'labz-18246' }, auth: () => auth, firestore: () => db };
  const firebase = {
    apps: [],
    initializeApp() { firebase.apps.push(app); return app; },
    app: () => app,
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } } }),
    firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => new Date(), increment: (n) => n, delete: () => null, arrayUnion: (...x) => x, arrayRemove: () => [] }, Timestamp: { now: () => ({ toDate: () => new Date() }) } }),
  };
  window.firebase = firebase;
})();
