// Tests moteur des 8 nouveaux jeux + composition des parties
const fs = require('fs'), assert = require('assert');
global.window = global;
eval(fs.readFileSync(__dirname + '/../geo.js', 'utf8').replace(/^var GEO =/m, 'global.GEO =').replace(/^var GEO_BANK =/m, 'global.GEO_BANK ='));
eval(fs.readFileSync(__dirname + '/../questions.js', 'utf8').replace(/^var QUESTIONS/m, 'global.QUESTIONS'));
const E = require(__dirname + '/../engine.js');
let t = 0, timers = [], out = [];
const mk = () => new E.Engine({ noHeartbeat: true, code: 'T', hasTv: true, bank: QUESTIONS, geo: GEO, broadcast: v => out.push(v), now: () => t,
  setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimeout: h => { timers = timers.filter(x => x !== h); } });
const tick = ms => { t += ms; timers.filter(h => h.at <= t).forEach(h => { timers = timers.filter(x => x !== h); h.fn(); }); };
const last = () => out[out.length - 1];
const P = ['a', 'b', 'c', 'd'];
function game(only, n) {
  const e = mk(); (n || P).forEach(p => e.handle({ t: 'join', pid: p, name: p.toUpperCase() }));
  e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 3, games: [only], finale: false } });
  tick(3600); assert.equal(e.s.phase, 'question', only + ' démarre'); return e;
}
const A = (e, pid, val) => e.handle({ t: 'answer', pid, round: e.s.round, val });

// Imposteur
let e = game('imposteur');
const imp = e.s.cur.imp; assert.ok(P.includes(imp)); assert.equal(e.s.cur.step, 'talk');
assert.equal(E.publicView(e.s).cur.a, undefined);
P.forEach(p => e.handle({ t: 'ready', pid: p, round: 1 }));
assert.equal(e.s.cur.step, 'vote');
P.forEach(p => A(e, p, p === imp ? P.find(x => x !== imp) : imp));
assert.equal(e.s.phase, 'reveal'); assert.ok(e.s.cur.caught);
P.forEach(p => assert.equal(e.s.result[p].pts, p === imp ? 0 : 30));
// imposteur non démasqué
e = game('imposteur'); const imp2 = e.s.cur.imp; tick(60000); assert.equal(e.s.cur.step, 'vote');
const civ = P.filter(p => p !== imp2);
A(e, civ[0], civ[1]); A(e, civ[1], civ[0]); A(e, civ[2], civ[0]); A(e, imp2, civ[0]);
assert.equal(e.s.phase, 'reveal'); assert.equal(e.s.cur.caught, false); assert.equal(e.s.result[imp2].pts, 30);
A(e, civ[0], civ[0]); // vote pour soi refusé (déjà fini de toute façon)

// Rébus
e = game('rebus'); const ans = e.s.cur.a;
e.handle({ t: 'guess', pid: 'b', round: 1, text: 'zzzz' }); assert.equal(e.s.fb.b.res, 'no');
e.handle({ t: 'guess', pid: 'b', round: 1, text: ans.toLowerCase() });
e.handle({ t: 'guess', pid: 'a', round: 1, text: ans });
assert.equal(e.s.cur.found.length, 2); tick(46000);
assert.equal(e.s.result.b.pts, 30); assert.equal(e.s.result.a.pts, 20); assert.equal(e.s.result.c.pts, 0);

// Petit Bac
e = game('petitbac'); const L = e.s.cur.l, cats = e.s.cur.cats; assert.equal(cats.length, 5);
const W = (x) => [L + 'aaa' + x, L + 'bbb', '', 'Zut' + x, L + 'ccc' + x];
A(e, 'a', { w: W(1) }); A(e, 'a', { w: W(1), done: true }); A(e, 'a', { w: ['change'], done: true });
assert.equal(e.s.answers.a.w[0], L + 'aaa1', 'figé après « fini »');
['b', 'c'].forEach((p, i) => A(e, p, { w: W(i + 2), done: true }));
A(e, 'd', { w: W(9) }); // pas fini : brouillon
assert.equal(e.s.cur.step, 'write'); tick(60000); assert.equal(e.s.cur.step, 'check');
assert.equal(E.publicView(e.s).cur.sheet.a[3].ok, false, 'Zut ne commence pas par la lettre (sauf si L=Z)');
// b et c rejettent le premier mot de a (2 rejets sur 3 autres -> rejeté)
e.handle({ t: 'bac', pid: 'b', round: 1, key: 'a:0' }); e.handle({ t: 'bac', pid: 'c', round: 1, key: 'a:0' });
e.handle({ t: 'bac', pid: 'a', round: 1, key: 'a:1' }); // on ne juge pas ses propres mots
P.forEach(p => e.handle({ t: 'bac', pid: p, round: 1, done: true }));
assert.equal(e.s.phase, 'reveal');
const ra = e.s.result.a.marks;
assert.equal(ra[0].st, 'rej'); assert.equal(ra[1].st, 'shared'); assert.equal(ra[1].pts, 3); assert.equal(ra[4].st, 'unique'); assert.equal(ra[2].st, 'empty');
assert.equal(e.s.result.a.pts, 3 + 6);

// Réflexe
e = game('reflexe'); assert.ok(e.s.cur.wait >= 2000 && e.s.cur.wait < 6000);
A(e, 'a', 250); A(e, 'b', 180); A(e, 'c', 40); A(e, 'd', 400);
assert.equal(e.s.result.b.pts, 30); assert.equal(e.s.result.a.pts, 20); assert.equal(e.s.result.c.early, true); assert.equal(e.s.result.c.pts, 0); assert.equal(e.s.result.d.pts, 10);

// Mémoire
e = game('memoire'); assert.equal(e.s.cur.step, 'show'); assert.equal(E.publicView(e.s).cur.target, undefined);
A(e, 'a', 1); assert.ok(!e.s.answers.a, 'pas de réponse pendant la mémorisation');
tick(5000); assert.equal(e.s.cur.step, 'ask'); assert.equal(E.publicView(e.s).cur.grid, undefined); assert.ok(E.publicView(e.s).cur.target);
const good = e.s.cur.ans;
tick(1000); A(e, 'b', good); tick(500); A(e, 'a', good); A(e, 'c', (good + 1) % 9); A(e, 'd', good);
assert.equal(e.s.result.b.pts, 30); assert.equal(e.s.result.a.pts, 20); assert.equal(e.s.result.c.pts, 0);

// Géo
e = game('geo'); const k = e.s.cur.k, c = e.s.cur.c2;
assert.equal(E.publicView(e.s).cur.k, undefined);
A(e, 'a', c); A(e, 'b', [c[0] + 40, c[1]]); A(e, 'c', [5, 5]); A(e, 'd', [c[0] + 15, c[1] + 3]);
console.log('géo :', e.s.cur.q, JSON.stringify(Object.fromEntries(P.map(p => [p, [e.s.result[p].km, e.s.result[p].pts]]))));
assert.ok(e.s.result.a.pts >= 20); assert.ok(e.s.result.c.pts < e.s.result.a.pts);
// France : Paris dedans, Londres à moins de 500 km, Madrid plus loin
const fr = GEO_BANK.find(b => b.a === 'France');
const xy = (lon, lat) => [(lon + 180) / 360 * GEO.w, (GEO.top - lat) / (GEO.top - GEO.bot) * GEO.h];
const dParis = E.geoDistance(GEO, fr.k, ...xy(2.35, 48.85)), dLondres = E.geoDistance(GEO, fr.k, ...xy(-0.12, 51.5)), dNY = E.geoDistance(GEO, fr.k, ...xy(-74, 40.7));
console.log('France : Paris', dParis, 'km · Londres', dLondres, 'km · New York', dNY, 'km');
assert.equal(dParis, 0); assert.ok(dLondres < 500); assert.ok(dNY > 5000);

// Pile-poil
e = game('chrono'); const n = e.s.cur.n; assert.ok(n >= 5 && n <= 30);
A(e, 'a', n * 1000 + 300); A(e, 'b', n * 1000 - 100); A(e, 'c', n * 1000 + 2000);
assert.equal(e.s.phase, 'question'); tick(34000); assert.equal(e.s.phase, 'question'); tick(1500); assert.equal(e.s.phase, 'reveal');
assert.equal(e.s.result.b.pts, 30); assert.equal(e.s.result.a.pts, 20); assert.equal(e.s.result.c.pts, 10); assert.equal(e.s.result.d.pts, 0);
e = game('chrono'); tick(35500); assert.equal(e.s.phase, 'reveal', 'personne ne clique : fin à 35 s');

// Minimum de joueurs : imposteur / punchline à 3, petit bac à 2
e = mk(); ['a', 'b'].forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 3, games: ['imposteur'], finale: false } });
assert.equal(e.s.phase, 'lobby', 'aucun jeu jouable à 2');

// Composition : sous-ensemble de jeux, finale jamais en Pyramide
const all = Object.keys(E.GAMES);
for (let i = 0; i < 300; i++) {
  const d = E.fixFinale(E.buildDeck(10, all, QUESTIONS, {}, {}));
  assert.equal(d.length, 10);
  assert.ok(!E.GAMES[d[8].g].duo && !E.GAMES[d[9].g].duo, 'finale sans duo');
  for (let j = 1; j < 10; j++) assert.notEqual(d[j].g, d[j - 1].g, 'jamais deux fois de suite');
}
const d10 = E.buildDeck(10, all, QUESTIONS, {}, {});
console.log('10 épreuves parmi', all.length, 'jeux :', [...new Set(d10.map(x => x.g))].length, 'jeux différents');
// Équipes choisies par le capitaine
const tf = E.teamsFor([{ pid: 'a' }, { pid: 'b' }, { pid: 'c' }, { pid: 'd' }], { a: 0, b: 0, c: 1 });
assert.deepEqual(tf, { a: 0, b: 0, c: 1, d: 1 });
const tf2 = E.teamsFor([{ pid: 'a' }, { pid: 'b' }, { pid: 'c' }], { a: 1, b: 1, c: 1 });
assert.ok(Object.values(tf2).includes(0), 'jamais une équipe vide');
e = mk(); P.forEach(p => e.handle({ t: 'join', pid: p, name: p }));
e.handle({ t: 'cmd', pid: 'a', cmd: 'settings', settings: { count: 3, games: ['culture'], finale: false, teams: true, teamOf: { a: 1, b: 0, c: 1, d: 0 } } });
e.handle({ t: 'cmd', pid: 'a', cmd: 'start' });
assert.deepEqual(e.s.players.map(p => p.team), [1, 0, 1, 0]);
assert.ok(!E.GAMES.punchline, 'Punchline supprimé');
console.log('OK nouveaux jeux + équipes');

// Géo : points continus selon la distance (1240 km ≠ 250 km)
const gp = (()=>{ const e0 = game('geo'); return null; })();
{
  const e1 = game('geo'); const c1 = e1.s.cur.c2;
  A(e1, 'a', c1); A(e1, 'b', [c1[0] + 8, c1[1]]); A(e1, 'c', [c1[0] + 40, c1[1]]); A(e1, 'd', [5, 5]);
  const km = p => e1.s.result[p].km, pt = p => e1.s.result[p].pts;
  assert.ok(km('b') > km('c') || pt('b') >= pt('c'), 'plus près = plus de points : ' + km('b') + 'km ' + pt('b') + ' / ' + km('c') + 'km ' + pt('c'));
}

// Drapeaux
e = game('drapeaux'); const cd = e.s.cur;
assert.equal(cd.names.length, 4); assert.equal(cd.items.length, 4); assert.equal(new Set(cd.names).size, 4);
assert.equal(E.publicView(e.s).cur.order, undefined, 'l\'ordre juste reste secret');
cd.items.forEach(it => assert.ok(/^[a-z]{2}$/.test(it.f)));
A(e, 'a', cd.order.slice()); A(e, 'b', [0, 1, 2, 3].sort((x, y) => cd.order.indexOf(x) - cd.order.indexOf(y)).reverse()); A(e, 'c', [0, 0, 1, 2]); assert.ok(!e.s.answers.c, 'réponse invalide refusée'); A(e, 'c', cd.order.map(k => (k + 1) % 4));
A(e, 'd', cd.order.slice());
assert.equal(e.s.result.a.good, 4); assert.equal(e.s.result.a.pts, 30); assert.equal(e.s.result.c.good, 0); assert.equal(e.s.result.c.pts, 0);
// jamais deux drapeaux jumeaux dans la même série
for (let i = 0; i < 200; i++) { const x = game('drapeaux'); const fs_ = x.s.cur.items.map(t => t.f); ['id','mc','pl'].filter(c => fs_.includes(c)).length < 2 || assert.fail('jumeaux ' + fs_); }
console.log('OK drapeaux + géo continu');
