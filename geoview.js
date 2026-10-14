// Vue de la carte Géo-Devine : calculs purs (zoom, déplacement, pincement, conversion écran <-> carte).
// ES5 uniquement. Utilisé par app.js (écran téléphone) et testé par tests/geoview.test.js.
// Une « vue » = { cx, cy, w } : centre de la zone visible (unités de la carte) et largeur visible.
// La hauteur visible se déduit de la forme du cadre : h = w * hauteurCadre / largeurCadre.
var GeoView = (function () {
  var MIN_W_DIV = 20; // zoom maximal : on voit au minimum 1/20 de la largeur du monde

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Largeur visible quand on voit tout le monde dans le cadre
  function fitW(map, box) {
    return Math.max(map.w, map.h * box.w / box.h);
  }
  function minW(map) { return map.w / MIN_W_DIV; }

  // Ramène la vue dans des limites raisonnables (zoom, et centre dans le monde)
  function clampView(v, map, box) {
    var w = clamp(v.w, minW(map), fitW(map, box));
    var h = w * box.h / box.w;
    var cx = w >= map.w ? map.w / 2 : clamp(v.cx, w / 2, map.w - w / 2);
    var cy = h >= map.h ? map.h / 2 : clamp(v.cy, h / 2, map.h - h / 2);
    return { cx: cx, cy: cy, w: w };
  }

  function fullView(map, box) {
    return clampView({ cx: map.w / 2, cy: map.h / 2, w: fitW(map, box) }, map, box);
  }

  function isFull(v, map, box) { return v.w >= fitW(map, box) - 0.5; }

  // Pixels par unité de carte
  function scale(v, box) { return box.w / v.w; }

  // viewBox SVG de la vue
  function viewBox(v, box) {
    var h = v.w * box.h / box.w;
    return [round2(v.cx - v.w / 2), round2(v.cy - h / 2), round2(v.w), round2(h)].join(' ');
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  // px, py : position relative au coin haut-gauche du cadre
  function toMap(v, box, px, py) {
    var s = scale(v, box);
    return { x: v.cx + (px - box.w / 2) / s, y: v.cy + (py - box.h / 2) / s };
  }
  function toScreen(v, box, x, y) {
    var s = scale(v, box);
    return { x: (x - v.cx) * s + box.w / 2, y: (y - v.cy) * s + box.h / 2 };
  }

  // Zoom d'un facteur f (>1 = rapprocher) en gardant fixe le point d'écran (px, py)
  function zoomAt(v, map, box, f, px, py) {
    var m = toMap(v, box, px, py);
    var w = clamp(v.w / f, minW(map), fitW(map, box));
    var s = box.w / w;
    return clampView({ cx: m.x - (px - box.w / 2) / s, cy: m.y - (py - box.h / 2) / s, w: w }, map, box);
  }

  // Zoom d'un facteur f centré sur un point de la carte (il passe au milieu du cadre)
  function zoomOn(v, map, box, f, x, y) {
    var w = clamp(v.w / f, minW(map), fitW(map, box));
    return clampView({ cx: x, cy: y, w: w }, map, box);
  }

  // Glisser : la vue de départ v0 est déplacée de (dx, dy) pixels
  function panBy(v0, map, box, dx, dy) {
    var s = scale(v0, box);
    return clampView({ cx: v0.cx - dx / s, cy: v0.cy - dy / s, w: v0.w }, map, box);
  }

  // Pincer : depuis la vue v0, deux doigts passent de (distance d0, milieu m0) à (d1, m1).
  // Le point de la carte sous le milieu de départ reste sous le milieu d'arrivée.
  function pinch(v0, map, box, d0, m0, d1, m1) {
    var anchor = toMap(v0, box, m0.x, m0.y);
    var w = clamp(v0.w * d0 / Math.max(d1, 1), minW(map), fitW(map, box));
    var s = box.w / w;
    return clampView({ cx: anchor.x - (m1.x - box.w / 2) / s, cy: anchor.y - (m1.y - box.h / 2) / s, w: w }, map, box);
  }

  // Un point de la carte, borné au monde dessiné
  function clampPoint(map, x, y) {
    return [Math.round(clamp(x, 0, map.w)), Math.round(clamp(y, 0, map.h))];
  }

  return {
    fitW: fitW, minW: minW, clampView: clampView, fullView: fullView, isFull: isFull,
    scale: scale, viewBox: viewBox, toMap: toMap, toScreen: toScreen,
    zoomAt: zoomAt, zoomOn: zoomOn, panBy: panBy, pinch: pinch, clampPoint: clampPoint
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GeoView;
