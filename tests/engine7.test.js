// Tests : lot de questions en ligne (OpenQuizzDB via Supabase)
const fs = require('fs'), assert = require('assert');
global.window = global;
eval(fs.readFileSync(__dirname + '/../geo.js', 'utf8').replace(/^var GEO =/m, 'global.GEO =').replace(/^var GEO_BANK =/m, 'global.GEO_BANK ='));
eval(fs.readFileSync(__dirname + '/../questions.js', 'utf8').replace(/^var QUESTIONS/m, 'global.QUESTIONS'));
const E = require(__dirname + '/../engine.js');
let t = 0, timers = [], out = [], persisted = null, marks = [];
const tick = ms => { t += ms; timers.filter(h => h.at <= t).forEach(h => { timers = timers.filter(x => x !== h); h.fn(); }); };
const P = ['a', 'b', 'c', 'd'];
const pack = [];
for (let i = 0; i < 20; i++) pack.push({ id: 'oq9' + i + '-1', g: 'culture', d: 2, q: 'Question en ligne ' + i + ' ?', c: ['A', 'B', 'C', 'D'], a: i % 4, info: 'Anecdote ' + i, src: { n: 'OpenQuizzDB', by: 'Auteur', t: 'Thème' } });
for (let i = 0; i < 20; i++) pack.push({ id: 'oq8' + i + '-2', g: 'estimation', q: 'En quelle année ' + i + ' ?', a: 1900 + i, u: '' });
pack.push({ id: 'pas-oq', g: 'culture', q: 'x', c: ['a', 'b', 'c', 'd'], a: 0 }); // rejeté : id inattendu
pack.push({ id: 'oq-bad', g: 'culture', q: 'x', c: ['a', 'b'], a: 0 });           // rejeté : 2 choix
pack.push({ id: 'oq-bad2', g: 'bluff', q: 'x', a: 'y' });                          // rejeté : jeu non concerné

function mk(opts) {
  return new E.Engine(Object.assign({ noHeartbeat: true, code: 'T', hasTv: true, bank: QUESTIONS, geo: GEO, broadcast: v => out.push(v), now: () => t,
    persist: st => { persisted = JSON.parse(JSON.stringify(st)); },
    markPlayed: (id, names) => marks.push([id, names]),
    setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimeout: h => { timers = timers.filter(x => x !== h); } }, opts));
}
const last = () => out[out.length - 1];

// 1) lot reçu (de façon asynchrone) : questions en ligne en priorité, alternées avec la banque locale
let asked = null, cb = null;
let e = mk({ prepare: (req, done) => { asked = req; cb = done; } });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p.toUpperCase() }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 12, games: ['culture', 'estimation'], finale: false } });
assert.equal(e.s.phase, 'lobby'); assert.equal(last().preparing, true, 'les écrans affichent « préparation »');
assert.deepEqual(asked.players, ['A', 'B', 'C', 'D']); assert.equal(asked.culture, 12); assert.equal(asked.estimation, 12);
e.handle({ t: 'cmd', pid: 'a', cmd: 'start' }); // double appui ignoré
cb(pack);
assert.ok(!e.s.preparing); assert.equal(e.s.phase, 'draw');
const ids = e.s.deck.map(d => d.id);
const online = ids.filter(id => id.indexOf('oq') === 0);
console.log('deck :', ids.join(' '));
assert.ok(online.length >= 5, 'au moins la moitié du deck vient du lot en ligne');
assert.ok(ids.some(id => /^(cg|es)/.test(id)), 'et des questions locales aussi');
assert.ok(!ids.includes('pas-oq') && !ids.includes('oq-bad') && !ids.includes('oq-bad2'));
const kept = [].concat(e.s.pack.culture || [], e.s.pack.estimation || []).map(q => q.id).sort();
assert.deepEqual(kept, online.slice().sort(), 'l\'état du salon ne garde que les questions tirées');
assert.equal(last().pack, undefined, 'le lot (avec réponses) n\'est jamais diffusé');
assert.ok(persisted.pack, 'mais il est enregistré dans le salon (Supabase)');

// joue jusqu'à une question en ligne et vérifie affichage / secret / historique
let found = false;
for (let r = 0; r < 12 && !found; r++) {
  tick(3600);
  const cur = e.s.cur;
  if (cur.id.indexOf('oq9') === 0) {
    found = true;
    const v = last();
    assert.equal(v.cur.a, undefined); assert.equal(v.cur.info, undefined, 'pas d\'anecdote pendant la question');
    assert.equal(v.cur.src.n, 'OpenQuizzDB', 'crédit affiché');
    assert.deepEqual(marks[marks.length - 1], [cur.id, ['A', 'B', 'C', 'D']], 'historique par joueur');
    P.forEach(p => e.handle({ t: 'answer', pid: p, round: e.s.round, val: cur.a }));
    assert.equal(e.s.phase, 'reveal'); assert.ok(/^Anecdote/.test(last().cur.info), 'anecdote à la révélation');
    assert.ok(e.s.result.a.pts > 0);
  } else {
    tick(cur.time + 10);
  }
  if (!found) e.handle({ t: 'cmd', pid: 'a', cmd: 'next' });
}
assert.ok(found, 'une question en ligne a été jouée');

// 2) reprise par un autre hôte : le lot voyage dans l'état enregistré
const e2 = mk({ state: JSON.parse(JSON.stringify(persisted)), prepare: () => {} });
e2.handle({ t: 'cmd', pid: 'a', cmd: 'next' });
tick(3600);
assert.ok(e2.s.cur && e2.s.cur.q, 'le nouvel hôte retrouve la question suivante');

// 3) pas de réponse du serveur : on part au bout de 6 s avec la banque locale
e = mk({ prepare: () => {} });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 5, games: ['culture'], finale: false } });
assert.equal(e.s.phase, 'lobby'); tick(5900); assert.equal(e.s.phase, 'lobby'); tick(200);
assert.equal(e.s.phase, 'draw'); assert.ok(e.s.deck.every(d => /^cg/.test(d.id))); assert.equal(e.s.pack, null);

// 4) erreur réseau : repli immédiat
e = mk({ prepare: (req, done) => done(null) });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 5, games: ['culture'], finale: false } });
assert.equal(e.s.phase, 'draw');

// 5) réglage « questions en ligne » désactivé, ou aucun jeu concerné : pas d'appel
let calls = 0;
e = mk({ prepare: () => { calls++; } });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 5, games: ['culture'], finale: false, online: false } });
assert.equal(e.s.phase, 'draw'); assert.equal(calls, 0);
e = mk({ prepare: () => { calls++; } });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 5, games: ['bluff', 'ordre'], finale: false } });
assert.equal(e.s.phase, 'draw'); assert.equal(calls, 0);

// 6) le capitaine quitte pendant la préparation : réponse tardive ignorée
e = mk({ prepare: (req, done) => { cb = done; } });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 5, games: ['culture'], finale: false } });
e.toLobby(false); cb(pack);
assert.equal(e.s.phase, 'lobby'); assert.ok(!e.s.preparing);

// 7) revanche : nouveau lot
let n = 0;
e = mk({ prepare: (req, done) => { n++; done(pack); } });
P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 3, games: ['culture'], finale: false } });
for (let r = 0; r < 3; r++) { tick(3600); tick(e.s.cur.time + 10); e.handle({ t: 'cmd', pid: 'a', cmd: 'next' }); }
assert.equal(e.s.phase, 'final'); e.handle({ t: 'cmd', pid: 'a', cmd: 'rematch' });
assert.equal(n, 2); assert.equal(e.s.phase, 'draw');

// 8) partie enregistrée pendant une préparation (hôte coupé) : on n'y reste pas bloqué
const st = JSON.parse(JSON.stringify(e.s)); st.phase = 'lobby'; st.preparing = true;
const e3 = mk({ state: st, prepare: (r, d) => d(null) });
assert.ok(!e3.s.preparing);
console.log('OK lot en ligne');
