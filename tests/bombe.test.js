const fs = require('fs'), assert = require('assert');
global.window = global;
eval(fs.readFileSync(__dirname + '/../geo.js', 'utf8').replace(/^var GEO =/m, 'global.GEO =').replace(/^var GEO_BANK =/m, 'global.GEO_BANK ='));
eval(fs.readFileSync(__dirname + '/../questions.js', 'utf8').replace(/^var QUESTIONS/m, 'global.QUESTIONS'));
const E = require(__dirname + '/../engine.js');
let t = 0, timers = [], out = [], loaded = [];
const letterWords = l => new Set(fs.readFileSync(__dirname + '/../words/' + l + '.txt', 'utf8').split('\n'));
const cache = {};
const mk = () => new E.Engine({ noHeartbeat: true, code: 'T', hasTv: true, bank: QUESTIONS, geo: GEO, broadcast: v => out.push(v), now: () => t,
  loadWords: l => { loaded.push(l); cache[l] = cache[l] || letterWords(l); },
  checkWord: (l, w) => cache[l] ? cache[l].has(w) : null,
  setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimeout: h => { timers = timers.filter(x => x !== h); } });
const tick = ms => { t += ms; timers.filter(h => h.at <= t).forEach(h => { timers = timers.filter(x => x !== h); h.fn(); }); };
const P = ['a', 'b', 'c'];
function game(finale) {
  const e = mk(); P.forEach(p => e.handle({ t: 'join', pid: p, name: p.toUpperCase() }));
  e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: finale ? 6 : 3, games: ['bombe'], finale: !!finale } }); tick(3600);
  assert.equal(e.s.phase, 'question'); assert.equal(e.s.cur.g, 'bombe'); return e;
}
const say = (e, pid, w) => e.handle({ t: 'answer', pid, round: e.s.round, val: w });
const wordFor = (l, skip) => { const ws = [...cache[l]].filter(w => w.length >= 4 && w.length <= 7 && !/[sx]$/.test(w) && !(skip || []).includes(w)); return ws[Math.floor(ws.length / 3)]; };

let L, e = game();
L = e.s.cur.letter.toLowerCase(); assert.deepEqual(loaded.slice(-1), [L]);
const fuse = e.s.cur.deadline - e.s.cur.startedAt; assert.ok(fuse >= 25000 && fuse <= 45000, 'mèche ' + fuse);
const pv = E.publicView(e.s); assert.equal(pv.said, undefined); assert.equal(pv.wc, undefined);
let h = e.s.cur.holder;
// refus : mauvais porteur, mauvaise lettre, trop court, inconnu
const other = P.find(p => p !== h); say(e, other, wordFor(L)); assert.equal(e.s.cur.holder, h, 'seul le porteur joue');
const bad = L === 'z' ? 'a' : 'z';
say(e, h, bad + 'abcdef'); assert.equal(e.s.cur.holder, h); assert.equal(e.s.reject[h].n, 1);
say(e, h, L + 'a'); assert.equal(e.s.reject[h].n, 2);
say(e, h, L + 'qxzzqkw'); assert.equal(e.s.reject[h].n, 3, 'inconnu refusé'); assert.equal(e.s.cur.holder, h);
// mot valide : passe au suivant, +5
const w1 = wordFor(L); say(e, h, w1); const idx = P.indexOf(h); assert.equal(e.s.cur.holder, e.s.players[(e.s.players.findIndex(p => p.pid === h) + 1) % 3].pid);
assert.equal(e.s.wc[h], 1); assert.equal(e.s.reject[h], undefined);
// doublon (pluriel) refusé
const h2 = e.s.cur.holder; say(e, h2, w1); assert.equal(e.s.cur.holder, h2); assert.equal(e.s.reject[h2].n, 1);
say(e, h2, w1 + 's'); if (cache[L].has(w1 + 's')) assert.equal(e.s.cur.holder, h2, 'pluriel = déjà dit');
// accents acceptés
const w2 = wordFor(L, [w1]); say(e, h2, w2.toUpperCase()); assert.notEqual(e.s.cur.holder, h2);
// porteur injoignable : la bombe passe
const h3 = e.s.cur.holder; e.player(h3).off = true; e.checkDone(); assert.notEqual(e.s.cur.holder, h3);
e.player(h3).off = false;
// explosion
const holderAtEnd = e.s.cur.holder; tick(fuse + 100);
assert.equal(e.s.phase, 'reveal'); assert.equal(e.s.cur.boom, holderAtEnd);
const r = e.s.result;
assert.equal(r[holderAtEnd].pts, 0);
P.filter(p => p !== holderAtEnd).forEach(p => assert.equal(r[p].pts, (e.s.wc[p] || 0) * 5));
assert.equal(r[h].n, 1);
// celui qui a trouvé un mot puis explose : 0
e = game(); h = e.s.cur.holder; say(e, h, wordFor(L = e.s.cur.letter.toLowerCase()));
let cur = e.s.cur.holder; const w3 = wordFor(L, []); // faire revenir la bombe à h
const order = e.s.players.map(p => p.pid); let guard = 0;
while (e.s.cur.holder !== h && guard++ < 5) { const used = [...e.s.said]; const w = [...cache[L]].filter(x => x.length >= 4 && x.length <= 8 && !used.includes(x.replace(/[sx]$/, '')))[guard * 50]; say(e, e.s.cur.holder, w); }
assert.equal(e.s.cur.holder, h); tick(46000); assert.equal(e.s.result[h].pts, 0, 'celui qui explose perd ses points');
// finale : points doublés
e = game(true); for (let i = 0; i < 3; i++) { tick(46000); e.handle({ t: 'cmd', pid: 'a', cmd: 'next' }); tick(3600); }
assert.equal(e.s.mult, 2); const L2 = e.s.cur.letter.toLowerCase(); const hh = e.s.cur.holder; say(e, hh, wordFor(L2)); const nx = e.s.cur.holder;
const used2 = [...e.s.said]; say(e, nx, [...cache[L2]].filter(x => x.length >= 4 && !used2.includes(x.replace(/[sx]$/, '')))[40]);
tick(46000); const rr = e.s.result; const bm = e.s.cur.boom; Object.keys(rr).forEach(p => { if (p !== bm) assert.equal(rr[p].pts, (e.s.wc[p] || 0) * 10); });
console.log('OK bombe', fuse);
