const fs = require('fs'), assert = require('assert');
global.window = global;
eval(fs.readFileSync(__dirname + '/../geo.js', 'utf8').replace(/^var GEO =/m, 'global.GEO =').replace(/^var GEO_BANK =/m, 'global.GEO_BANK ='));
eval(fs.readFileSync(__dirname + '/../questions.js', 'utf8').replace(/^var QUESTIONS/m, 'global.QUESTIONS'));
const E = require(__dirname + '/../engine.js');
let t = 0, timers = [], loaded = [];
const cache = {};
const mk = (bank, withDict) => new E.Engine(Object.assign({ noHeartbeat: true, code: 'T', hasTv: true, bank, geo: GEO, broadcast: () => {}, now: () => t,
  setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimeout: h => { timers = timers.filter(x => x !== h); } },
  withDict ? { loadWords: l => { loaded.push(l); cache[l] = cache[l] || new Set(fs.readFileSync(__dirname + '/../words/' + l + '.txt', 'utf8').split('\n')); },
               checkWord: (l, w) => cache[l] ? cache[l].has(w) : null } : {}));
const tick = ms => { t += ms; timers.filter(h => h.at <= t).forEach(h => { timers = timers.filter(x => x !== h); h.fn(); }); };
function run(g, ans, alt, withDict) {
  const bank = { [g]: [Object.assign({ id: 'x1', a: ans, alt: alt || [], e: '🔥', c: 'Métier', w: ans }, g === 'rebus' ? {} : {})] };
  const e = mk(Object.assign({}, QUESTIONS, bank), withDict);
  ['a', 'b', 'c'].forEach(p => e.handle({ t: 'join', pid: p, name: p }));
  e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 3, games: [g], finale: false, online: false } }); tick(4000);
  assert.equal(e.s.cur.g, g);
  return e;
}
const found = (e, pid) => e.s.cur.found.some(f => f.pid === pid);
const guess = (e, pid, text) => e.handle({ t: 'guess', pid, round: e.s.round, text });
// sans dictionnaire : ancien comportement (accepté) — avec dictionnaire : refusé
let e = run('rebus', 'pompier', [], true);
assert.ok(loaded.includes('p'), 'lettre chargée');
guess(e, 'b', 'pompiste'); assert.ok(!found(e, 'b'), 'pompiste refusé');
guess(e, 'c', 'pompiers'); assert.ok(found(e, 'c'), 'pluriel accepté');
guess(e, 'a', 'pompié'); assert.ok(found(e, 'a'), 'faute de frappe acceptée (pompié)');
e = run('rebus', 'pompier', [], true);
guess(e, 'b', 'Pompier'); assert.ok(found(e, 'b'));
guess(e, 'c', 'pomppiez'); assert.ok(found(e, 'c'), 'pomppiez (pas un mot) accepté');
// titres à plusieurs mots : règle non appliquée
e = run('rebus', 'le petit chaperon rouge', [], true);
guess(e, 'b', 'petit chaperon rouges'); assert.ok(found(e, 'b'));
console.log('OK rebus dictionnaire');
