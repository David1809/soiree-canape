const fs = require('fs'), assert = require('assert');
global.window = global;
eval(fs.readFileSync(__dirname + '/../geo.js', 'utf8').replace(/^var GEO =/m, 'global.GEO =').replace(/^var GEO_BANK =/m, 'global.GEO_BANK ='));
eval(fs.readFileSync(__dirname + '/../questions.js', 'utf8').replace(/^var QUESTIONS/m, 'global.QUESTIONS'));
const E = require(__dirname + '/../engine.js');
let t = 0, timers = [], out = [], rec = null, saved = [];
const mk = () => new E.Engine({ noHeartbeat: true, code: 'T', hasTv: true, bank: QUESTIONS, geo: GEO, broadcast: v => out.push(v), now: () => t,
  getRecord: () => rec, setRecord: (g, r) => { rec = r; saved.push(r); },
  setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimeout: h => { timers = timers.filter(x => x !== h); } });
const tick = ms => { t += ms; timers.filter(h => h.at <= t).forEach(h => { timers = timers.filter(x => x !== h); h.fn(); }); };
const P = ['a', 'b', 'c'];
function round(times) {
  const e = mk(); P.forEach(p => e.handle({ t: 'join', pid: p, name: p.toUpperCase() }));
  e.handle({ t: 'cmd', pid: 'a', cmd: 'start', settings: { count: 3, games: ['reflexe'], finale: false } }); tick(3600);
  P.forEach((p, i) => e.handle({ t: 'answer', pid: p, round: e.s.round, val: times[i] })); tick(100); return e;
}
let e = round([300, 250, 400]);
assert.deepEqual(rec, { name: 'B', ms: 250 }); assert.ok(!e.s.cur.broke, 'premier record : pas de détrônement'); assert.equal(e.s.cur.record.name, 'B');
e = round([260, 270, 500]);   // pas battu
assert.equal(rec.ms, 250); assert.ok(!e.s.cur.broke); assert.equal(e.s.cur.record.ms, 250); assert.equal(saved.length, 1);
e = round([240, 200, 500]);   // battu par B lui-même (200)
assert.equal(rec.ms, 200); assert.equal(e.s.cur.broke.name, 'B'); assert.equal(e.s.cur.broke.prev.ms, 250);
e = round([150, 90, 500]);    // 90 = faux départ ; A bat à 150
assert.equal(rec.name, 'A'); assert.equal(rec.ms, 150); assert.equal(e.s.cur.broke.name, 'A');
e = round([100, 119, 500]);   // trop rapide pour être humain : ignoré
assert.equal(rec.ms, 150);
e = round([150, 400, 500]);   // égalité : pas de détrônement
assert.ok(!e.s.cur.broke);
console.log('OK record réflexe');
