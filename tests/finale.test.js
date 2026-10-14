const E = require(__dirname + '/../engine.js'); const assert = require('assert');
global.window = global; const fs = require('fs');
eval(fs.readFileSync(__dirname + '/../questions.js', 'utf8').replace(/^var QUESTIONS/m, 'global.QUESTIONS'));
eval(fs.readFileSync(__dirname + '/../geo.js','utf8').replace(/^var GEO =/m,'global.GEO =').replace(/^var GEO_BANK =/m,'global.GEO_BANK =')); QUESTIONS.geo = GEO_BANK;
const all = Object.keys(E.GAMES); let bad = 0, runs = 0;
for (const count of [6, 8, 10, 12, 15, 20]) for (let r = 0; r < 400; r++) {
  const d = E.buildDeck(count, all, QUESTIONS, {}, { mode: 'mixte' }); E.fixFinale(d); runs++;
  d.slice(-3).forEach(x => { if (x.g === 'pyramide' || x.g === 'croquis') bad++; });
}
// jeux restreints : beaucoup de pyramide/croquis mais d'autres jeux disponibles
for (let r = 0; r < 400; r++) {
  const d = E.buildDeck(10, ['pyramide', 'croquis', 'culture'], QUESTIONS, {}, { mode: 'mixte' }); E.fixFinale(d); runs++;
  d.slice(-3).forEach(x => { if (x.g === 'pyramide' || x.g === 'croquis') bad++; });
}
console.log('parties', runs, '· pyramide/croquis en finale :', bad); assert.equal(bad, 0);
