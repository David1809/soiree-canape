// Tests de la vue de la carte Géo-Devine (zoom, glisser, pincer, conversions).
var assert = require('assert');
var G = require('../geoview.js');

var map = { w: 1000, h: 394 };
var portrait = { w: 330, h: 300 };   // cadre quasi carré (téléphone en portrait)
var paysage = { w: 780, h: 340 };    // téléphone en paysage

function near(a, b, eps, msg) { assert.ok(Math.abs(a - b) <= (eps || 0.01), (msg || '') + ' : ' + a + ' ≠ ' + b); }

// 1. Vue d'ensemble : le monde entier tient dans le cadre
[portrait, paysage].forEach(function (box) {
  var v = G.fullView(map, box);
  var h = v.w * box.h / box.w;
  assert.ok(v.w >= map.w - 0.001, 'toute la largeur visible');
  assert.ok(h >= map.h - 0.001, 'toute la hauteur visible');
  near(v.cx, 500, 0.001); near(v.cy, 197, 0.001);
  assert.ok(G.isFull(v, map, box));
});

// 2. Le cadre en paysage est plus précis que celui en portrait
assert.ok(G.scale(G.fullView(map, paysage), paysage) > 2 * G.scale(G.fullView(map, portrait), portrait), 'paysage ≥ 2× plus de pixels par unité');

// 3. Conversions écran <-> carte, dans les deux sens
var v = { cx: 300, cy: 120, w: 200 };
var m = G.toMap(v, paysage, 100, 80);
var s = G.toScreen(v, paysage, m.x, m.y);
near(s.x, 100, 0.001); near(s.y, 80, 0.001);
var centre = G.toMap(v, paysage, paysage.w / 2, paysage.h / 2);
near(centre.x, 300, 0.001); near(centre.y, 120, 0.001);

// 4. Le zoom garde fixe le point sous le doigt
var full = G.fullView(map, portrait);
var avant = G.toMap(full, portrait, 250, 150);
var z = G.zoomAt(full, map, portrait, 4, 250, 150);
var apres = G.toMap(z, portrait, 250, 150);
near(z.w, full.w / 4, 0.001, 'largeur divisée par 4');
near(apres.x, avant.x, 0.5, 'x conservé'); near(apres.y, avant.y, 0.5, 'y conservé');
// près du bord du monde, la vue reste bornée au monde (le point peut alors se décaler)
var coin = G.zoomAt(full, map, portrait, 4, 5, 5);
assert.ok(coin.cx - coin.w / 2 >= -0.001 && coin.cy - coin.w * portrait.h / portrait.w / 2 >= -0.001, 'jamais hors du monde');

// 5. Limites de zoom : jamais plus loin que le monde, jamais plus près que 1/20
var trop = G.zoomAt(full, map, portrait, 1000, 100, 100);
near(trop.w, G.minW(map), 0.001, 'zoom max');
var dehors = G.zoomAt(trop, map, portrait, 0.0001, 100, 100);
near(dehors.w, G.fitW(map, portrait), 0.001, 'zoom arrière borné');

// 6. Glisser : le contenu suit le doigt, et la vue reste dans le monde
var zoomee = { cx: 500, cy: 197, w: 200 };
var p = G.panBy(zoomee, map, paysage, 78, 0); // doigt vers la droite de 78 px = 20 unités (3,9 px/u)
near(p.cx, 500 - 20, 0.01, 'déplacement horizontal');
var bord = G.panBy(zoomee, map, paysage, 1e6, 1e6);
near(bord.cx, 100, 0.001, 'bord gauche'); // demi-largeur
assert.ok(bord.cy >= 0 && bord.cy <= map.h, 'reste dans le monde');

// 7. Pincer : écarter les doigts zoome, le point entre les doigts ne bouge pas
var base = { cx: 500, cy: 197, w: 400 };
var m0 = { x: 400, y: 150 };
var ancre = G.toMap(base, paysage, m0.x, m0.y);
var pz = G.pinch(base, map, paysage, 100, m0, 200, m0);
near(pz.w, 200, 0.001, 'doigts 2× plus écartés = 2× plus près');
var ancre2 = G.toMap(pz, paysage, m0.x, m0.y);
near(ancre2.x, ancre.x, 0.5); near(ancre2.y, ancre.y, 0.5);
// pincer en déplaçant le milieu : la carte suit
var pm = G.pinch(base, map, paysage, 100, m0, 100, { x: m0.x + 39, y: m0.y });
near(pm.w, 400, 0.001, 'même écart = même zoom');
assert.ok(pm.cx < base.cx, 'la carte suit le milieu des doigts');

// 8. Rapprocher les doigts (d1 très petit) ne divise pas par zéro
var pz0 = G.pinch(base, map, paysage, 100, m0, 0, m0);
assert.ok(isFinite(pz0.w) && isFinite(pz0.cx), 'valeurs finies');

// 9. viewBox : même forme que le cadre
var vb = G.viewBox({ cx: 500, cy: 197, w: 400 }, paysage).split(' ').map(Number);
near(vb[2] / vb[3], paysage.w / paysage.h, 0.01, 'proportions du cadre');
near(vb[0] + vb[2] / 2, 500, 0.01);

// 10. zoomOn : le point visé passe au milieu
var zo = G.zoomOn(full, map, portrait, 4, 700, 200);
near(zo.cx, 700, 0.001); near(zo.cy, 200, 0.001);

// 11. Point borné au monde (et arrondi)
var pt = G.clampPoint(map, -12.4, 500.6);
assert.deepStrictEqual(pt, [0, 394]);
assert.deepStrictEqual(G.clampPoint(map, 123.6, 45.2), [124, 45]);

// 12. Changement de cadre (rotation) : la vue est ramenée dans les limites du nouveau cadre
var apresRotation = G.clampView(zoomee, map, paysage);
assert.ok(apresRotation.w <= G.fitW(map, paysage));

console.log('geoview OK');
