// Pour les vieux navigateurs (télé Samsung Tizen 4 = Chrome 56) : sans « gap » en flexbox
// ni grille CSS. On relit style.css, on retrouve les règles gap / grid-template-columns,
// et on les remplace par des marges et des largeurs après chaque affichage.
(function () {
  function flexGapOk() {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    d.appendChild(document.createElement('div'));
    d.appendChild(document.createElement('div'));
    document.body.appendChild(d);
    var ok = d.scrollHeight === 1;
    document.body.removeChild(d);
    return ok;
  }
  var gridOk = window.CSS && CSS.supports && CSS.supports('display', 'grid');
  if (window.__forceGapFix) gridOk = false;
  else if (flexGapOk() && gridOk) return;

  var rules = [];   // { media, sel, gap: [row, col], cols }
  var probe;

  function toPx(v) {
    if (!probe) { probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden'; document.body.appendChild(probe); }
    probe.style.width = v;
    return probe.getBoundingClientRect().width;
  }

  function parse(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    var i = 0, media = null, depth = 0, mediaDepth = -1;
    var re = /([^{}]+)\{|\}/g, m, lastSel = null, start = 0;
    while ((m = re.exec(css))) {
      if (m[0] === '}') {
        if (lastSel !== null) { addRule(media, lastSel, css.slice(start, m.index)); lastSel = null; }
        depth--;
        if (depth === mediaDepth) { media = null; mediaDepth = -1; }
        continue;
      }
      var head = m[1].trim();
      if (head.charAt(0) === '@') { if (/^@media/.test(head)) { media = head.replace(/^@media/, '').trim(); mediaDepth = depth; } depth++; lastSel = null; continue; }
      depth++;
      lastSel = head; start = re.lastIndex;
    }
  }

  function addRule(media, sel, body) {
    var gap = /(?:^|;)\s*gap\s*:\s*([^;]+)/.exec(body);
    var cols = /grid-template-columns\s*:\s*([^;]+)/.exec(body);
    var grid = /display\s*:\s*grid/.test(body);
    var flow = /grid-auto-flow\s*:\s*column/.test(body);
    if (!gap && !cols && !grid) return;
    var g = null;
    if (gap) { var p = gap[1].trim().split(/\s+/); g = [p[0], p[1] || p[0]]; }
    rules.push({ media: media, sel: sel, gap: g, cols: cols ? cols[1].trim() : null, grid: grid, flow: flow });
  }

  function colCount(spec) {
    var r = /repeat\(\s*(\d+)/.exec(spec);
    if (r) return { n: +r[1], fixed: null };
    var parts = spec.replace(/minmax\([^)]*\)/g, 'X').split(/\s+/);
    return { n: parts.length, fixed: /px$/.test(parts[0]) ? parts[0] : null };
  }

  function apply() {
    var info = [], i, j;
    for (i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.media && !window.matchMedia(r.media).matches) continue;
      var els;
      try { els = document.querySelectorAll(r.sel); } catch (e) { continue; }
      for (j = 0; j < els.length; j++) {
        var el = els[j], o = el.__gf || (el.__gf = {});
        if (o.stamp !== apply.stamp) { o.stamp = apply.stamp; o.gap = null; o.cols = null; o.grid = false; o.flow = false; info.push(el); }
        if (r.gap) o.gap = r.gap;
        if (r.cols) o.cols = r.cols;
        if (r.grid) o.grid = true;
        if (r.flow) o.flow = true;
      }
    }
    for (i = 0; i < info.length; i++) fix(info[i]);
  }
  apply.stamp = 0;

  function kids(el) {
    var out = [], c = el.children;
    for (var i = 0; i < c.length; i++) {
      var cs = getComputedStyle(c[i]);
      if (cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed') out.push(c[i]);
    }
    return out;
  }

  function setM(k, side, v) {
    // ne remplace pas une marge posée par la feuille de style (ex. margin-top:auto)
    var prop = 'margin' + side;
    if (!k.__gfm) k.__gfm = {};
    if (!k.__gfm[side]) {
      var cur = getComputedStyle(k)[prop];
      if (cur && cur !== '0px') return;
      k.__gfm[side] = true;
    }
    k.style[prop] = v + 'px';
  }

  function fix(el) {
    var o = el.__gf, ks = kids(el);
    if (!ks.length) return;
    var row = o.gap ? toPx(o.gap[0]) : 0, col = o.gap ? toPx(o.gap[1]) : 0;
    var i;
    if ((o.grid || o.cols) && !gridOk) {
      var n, fixed = null;
      if (o.flow && !o.cols) { n = ks.length; } else { var cc = colCount(o.cols || 'X'); n = cc.n; fixed = cc.fixed; }
      // Grille simulée en blocs en ligne (plus fiable que flex-wrap sur les vieux Chrome)
      el.style.display = 'block';
      el.style.boxSizing = 'border-box';
      el.style.fontSize = el.style.fontSize || '';
      var pcs = el.parentNode ? getComputedStyle(el.parentNode) : null;
      if (pcs && pcs.display.indexOf('flex') >= 0 && pcs.flexDirection.indexOf('row') === 0) el.style.flex = '1 1 0%';
      else { el.style.alignSelf = 'stretch'; el.style.width = '100%'; }
      var mid = getComputedStyle(el).alignItems === 'center';
      for (i = 0; i < ks.length; i++) {
        var k = ks[i], c = i % n, kd = getComputedStyle(k).display;
        if (kd === 'flex') k.style.display = 'inline-flex';
        else if (kd === 'block' || kd === 'grid') k.style.display = 'inline-block';
        k.style.verticalAlign = mid ? 'middle' : 'top';
        k.style.boxSizing = 'border-box';
        if (fixed && n === 2) k.style.width = c === 0 ? fixed : 'calc(100% - ' + (toPx(fixed) + col + 1) + 'px)';
        else k.style.width = 'calc((100% - ' + (col * (n - 1) + n) + 'px) / ' + n + ')'; // 1 px de marge contre les arrondis
        k.style.marginLeft = c === 0 ? '0px' : col + 'px';
        k.style.marginTop = i < n ? '0px' : row + 'px';
      }
      return;
    }
    if (!o.gap) return;
    var cs = getComputedStyle(el);
    if (cs.display.indexOf('flex') < 0) return;
    var colDir = cs.flexDirection.indexOf('column') === 0, rev = cs.flexDirection.indexOf('reverse') > 0;
    var wrap = cs.flexWrap !== 'nowrap';
    for (i = 0; i < ks.length; i++) {
      if (colDir) { if (i > 0) setM(ks[i], rev ? 'Bottom' : 'Top', row); }
      else if (wrap) { setM(ks[i], 'Right', col); setM(ks[i], 'Bottom', row); }
      else if (i > 0) setM(ks[i], rev ? 'Right' : 'Left', col);
    }
  }

  var t = null;
  function later() { if (t) return; t = setTimeout(function () { t = null; apply.stamp++; apply(); }, 30); }

  var link = document.querySelector('link[href^="style.css"]');
  var x = new XMLHttpRequest();
  x.open('GET', link ? link.getAttribute('href') : 'style.css', true);
  x.onload = function () {
    parse(x.responseText);
    later();
    new MutationObserver(later).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
    window.addEventListener('resize', later);
  };
  x.send();
})();
