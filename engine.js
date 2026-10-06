// Moteur de partie Dé-lire.
// Il tourne sur UN seul appareil (la télé, ou le téléphone qui a créé la partie)
// et fait autorité : il reçoit les actions des joueurs et diffuse l'état.
// Écrit en ES5 pour rester compatible avec le navigateur des télés Samsung.
(function (root) {
  'use strict';

  var GAMES = {
    culture: { name: 'Culture générale', time: 20 },
    estimation: { name: 'Estimation', time: 30 },
    bluff: { name: 'Le Bluff', time: 60, voteTime: 30 },
    ordre: { name: 'Dans l\'ordre !', time: 30 },
    pyramide: { name: 'Pyramide', time: 30, announceTime: 12, min: 2, duo: true },
    croquis: { name: 'Croquis', time: 60, min: 2 },
    imposteur: { name: 'L\'Imposteur', time: 60, voteTime: 30, min: 3 },
    rebus: { name: 'Rébus emoji', time: 45 },
    petitbac: { name: 'Petit Bac', time: 60, checkTime: 35, min: 2 },
    reflexe: { name: 'Réflexe', time: 15, fixed: true },
    memoire: { name: 'Mémoire flash', time: 15, showTime: 5 },
    geo: { name: 'Géo-Devine', time: 25 },
    chrono: { name: 'Pile-poil', time: 70, fixed: true }
  };
  // duo : seuls deux joueurs jouent (jamais en finale) ; fixed : chrono indépendant du rythme
  var BAC_POINTS = { unique: 6, shared: 3 };
  // emojis connus des vieux téléphones et des télés (Unicode 9 au plus)
  var MEMO_POOL = ['🍕', '🚀', '🐶', '🎸', '⚽', '🌵', '🍩', '🎩', '🐙', '🚲', '🍉', '📷', '🦊', '🎈', '🍔', '🐢', '🌈', '🔑', '🎁', '🐝',
    '🍓', '🚗', '⏰', '🐧', '🎧', '🍦', '🌻', '👑', '🦁', '🍌', '🏀', '🐸', '🎂', '💎', '🚁', '🐼', '🍿', '⛄', '🐳', '🔥'];
  var OFFLINE_MS = 25000;
  var ABANDON_MS = 60000; // partie abandonnée : plus aucun téléphone depuis 1 min
  var LIE_MAX = 60;
  var EST_POINTS = [30, 20, 10, 0];
  var DRAW_MS = 3500;
  var MAX_PLAYERS = 6;
  var COLOR_COUNT = 6;

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- comparaison de réponses tolérante aux fautes ----------
  var SMALL_WORDS = ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'en', 'a', 'et'];

  function normText(str) {
    var t = String(str == null ? '' : str).toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ');
    return t.split(' ').filter(function (w) { return w && SMALL_WORDS.indexOf(w) < 0; })
      .map(function (w) { return w.length > 3 ? w.replace(/[sx]$/, '') : w; }).join(' ');
  }

  // Écrit comme ça se prononce (à peu près) : « ponpié » ≈ « pompier ».
  function phon(t) {
    return t.replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/c([aou])/g, 'k$1').replace(/ck/g, 'k')
      .replace(/eau|au/g, 'o').replace(/ai|ei/g, 'e').replace(/(er|ez|et|ee|es)\b/g, 'e')
      .replace(/m([bp])/g, 'n$1').replace(/y/g, 'i').replace(/h/g, '').replace(/([a-z])\1+/g, '$1');
  }

  function lev(a, b) {
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function similar(a, b) {
    var x = phon(normText(a)), y = phon(normText(b));
    if (!x || !y) return false;
    if (x === y) return true;
    var L = Math.max(x.length, y.length);
    return lev(x, y) <= (L <= 4 ? 0 : L <= 7 ? 1 : L <= 15 ? 2 : 3);
  }

  // Mots connus (toutes les banques de mots), sous forme phonétique.
  function knownWords(bank) {
    if (!bank) return {};
    if (bank.__known) return bank.__known;
    var k = {};
    function add(w) { var x = phon(normText(w)); if (x) k[x] = true; }
    (bank.croquis || []).forEach(function (q) { add(q.a); (q.alt || []).forEach(add); });
    (bank.pyramide || []).forEach(function (q) { add(q.a); });
    try { Object.defineProperty(bank, '__known', { value: k }); } catch (e) { bank.__known = k; }
    return k;
  }

  // Réponse au Croquis : tolère les fautes, mais un autre vrai mot n'est pas une faute
  // (« moule » n'est pas accepté pour « poule »).
  function matchGuess(text, words, known) {
    var x = phon(normText(text));
    if (!x) return false;
    for (var i = 0; i < words.length; i++) if (phon(normText(words[i])) === x) return true;
    if (known && known[x]) return false;
    return words.some(function (w) { return similar(text, w); });
  }

  // Presque juste (pour afficher « Presque ! » au Croquis).
  function nearMiss(a, b) {
    var x = phon(normText(a)), y = phon(normText(b));
    if (!x || !y) return false;
    return lev(x, y) <= Math.ceil(Math.max(x.length, y.length) / 3) || containsTruth(a, b);
  }

  // La réponse reprend-elle la vérité (même entourée d'autres mots) ?
  function containsTruth(answer, truth) {
    var x = ' ' + phon(normText(answer)) + ' ', y = phon(normText(truth));
    return y.length >= 5 && x.indexOf(' ' + y + ' ') >= 0;
  }

  // Ordre des épreuves : équilibré entre les jeux, jamais deux fois le même d'affilée.
  var PACE = { calme: 1.5, normal: 1, rapide: 0.7 };
  var FREQ_W = [0.5, 1, 2];

  // Nombre d'épreuves par jeu selon la fréquence choisie (peu / normal / beaucoup).
  function countsFor(count, games, freq) {
    var w = games.map(function (g) { return FREQ_W[freq && freq[g] != null ? freq[g] : 1]; });
    var sum = w.reduce(function (a, b) { return a + b; }, 0), per = {}, given = 0;
    var parts = games.map(function (g, i) { var x = count * w[i] / sum; per[g] = Math.floor(x); given += per[g]; return { g: g, r: x - per[g] }; });
    shuffle(parts).sort(function (a, b) { return b.r - a.r; });
    for (var i = 0; given < count; i = (i + 1) % parts.length) { per[parts[i].g]++; given++; }
    return per;
  }

  // Ordre des épreuves. Zapping : mélangé, jamais deux fois le même jeu d'affilée.
  // Manches : les épreuves d'un même jeu à la suite.
  function buildOrder(count, games, freq, mode) {
    var per = countsFor(count, games, freq), i, order = [];
    if (mode === 'manches') {
      shuffle(games.slice()).forEach(function (g) { for (var k = 0; k < per[g]; k++) order.push(g); });
      return order;
    }
    var last = null;
    for (i = 0; i < count; i++) {
      var cands = games.filter(function (g) { return per[g] > 0 && g !== last; });
      if (!cands.length) cands = games.filter(function (g) { return per[g] > 0; });
      var max = Math.max.apply(null, cands.map(function (g) { return per[g]; }));
      var best = cands.filter(function (g) { return per[g] === max; });
      var g = best[Math.floor(Math.random() * best.length)];
      per[g]--; order.push(g); last = g;
    }
    return order;
  }

  function diffOk(q, diff) {
    if (!q.d || !diff || diff === 'mixte') return true;
    return diff === 'facile' ? q.d <= 2 : q.d >= 2;
  }

  // Questions : jamais jouées d'abord, puis les autres ; les questions signalées sont écartées.
  function buildDeck(count, games, bank, played, o) {
    o = o || {};
    var excluded = o.excluded || {};
    var order = buildOrder(count, games, o.freq, o.mode);
    var pools = {}, used = {};
    function refill(g) {
      var all = (bank[g] || []).filter(function (q) { return !excluded[q.id]; });
      if (!all.length) all = (bank[g] || []).slice();
      var good = all.filter(function (q) { return diffOk(q, o.diff); });
      var rest = all.filter(function (q) { return !diffOk(q, o.diff); });
      var pick = function (list) {
        return shuffle(list.filter(function (q) { return !played[q.id]; })).concat(shuffle(list.filter(function (q) { return played[q.id]; })));
      };
      return pick(good).concat(pick(rest));
    }
    return order.map(function (g) {
      if (!pools[g] || !pools[g].length) pools[g] = refill(g).filter(function (q) { return !used[q.id]; });
      if (!pools[g].length) pools[g] = refill(g);
      var q = pools[g].shift();
      used[q.id] = true;
      return { g: g, id: q.id };
    });
  }

  // Finale (points doubles) : jamais un jeu où seuls deux joueurs jouent.
  function fixFinale(deck) {
    var n = deck.length;
    if (n < 6) return deck;
    for (var i = n - 2; i < n; i++) {
      if (!GAMES[deck[i].g].duo) continue;
      for (var j = n - 3; j >= 0; j--) {
        if (GAMES[deck[j].g].duo) continue;
        var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
        break;
      }
    }
    return deck;
  }

  // ---------- Géo-Devine : géométrie ----------
  var geoCache = {};
  function geoRings(geo, key) {
    if (geoCache[key]) return geoCache[key];
    var d = null;
    for (var i = 0; i < geo.paths.length; i++) if (geo.paths[i][0] === key) d = geo.paths[i][1];
    var rings = !d ? [] : d.split('M').filter(Boolean).map(function (part) {
      return part.replace('Z', '').split('L').map(function (pt) { var xy = pt.split(' '); return [Number(xy[0]), Number(xy[1])]; });
    });
    geoCache[key] = rings;
    return rings;
  }
  function insideRings(rings, x, y) {
    var inside = false;
    rings.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
    });
    return inside;
  }
  function toLonLat(geo, x, y) { return [x / geo.w * 360 - 180, geo.top - y / geo.h * (geo.top - geo.bot)]; }
  function kmBetween(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Distance (km) entre un point tapé et le pays : 0 si dedans, sinon le bord le plus proche.
  function geoDistance(geo, key, x, y) {
    var rings = geoRings(geo, key);
    if (insideRings(rings, x, y)) return 0;
    var p = toLonLat(geo, x, y), best = Infinity;
    rings.forEach(function (r) { r.forEach(function (pt) { var d = kmBetween(p, toLonLat(geo, pt[0], pt[1])); if (d < best) best = d; }); });
    return Math.round(best);
  }
  function geoPoints(km) { return km === 0 ? 30 : km <= 500 ? 20 : km <= 1500 ? 12 : km <= 3000 ? 6 : 0; }

  // Petit Bac : première lettre réelle d'un mot (sans accent ni article).
  function firstLetter(w) {
    var t = String(w || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/^[^a-z0-9]+/, '');
    return t.charAt(0);
  }

  function findQuestion(bank, g, id) {
    var list = bank[g] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function newState(code, hasTv) {
    return {
      code: code,
      hasTv: !!hasTv,
      phase: 'lobby',
      players: [],
      captain: null,
      settings: sanitizeSettings({ count: 15, games: Object.keys(GAMES), finale: true }, {}),
      deck: [],
      round: 0,
      cur: null,
      answers: {},
      result: null,
      mult: 1,
      drawUntil: 0,
      v: 0
    };
  }

  // Ce que les joueurs ont le droit de voir : pendant une question,
  // ni la bonne réponse ni les réponses des autres.
  function publicView(s) {
    var p = clone(s);
    p.deck = s.deck.map(function (d) { return d.g; });
    if (p.phase === 'question' || p.phase === 'vote') {
      if (p.cur) {
        delete p.cur.a; delete p.cur.alt; delete p.cur.order; delete p.cur.vals;
        delete p.cur.k; delete p.cur.c2; delete p.cur.ans;
        // Mémoire flash : la grille disparaît quand vient la question
        if (p.cur.g === 'memoire' && p.cur.step === 'ask') delete p.cur.grid;
        if (p.cur.g === 'memoire' && p.cur.step === 'show') delete p.cur.target;
      }
    }
    if (p.phase === 'question' && p.cur && p.cur.found) {
      p.cur.found = p.cur.found.map(function (f) { return { pid: f.pid }; });
    }
    if (p.phase === 'question') {
      var cur = s.cur || {};
      p.answered = Object.keys(s.answers);
      if (cur.g === 'imposteur' && cur.step === 'talk') p.answered = Object.keys(s.ready || {});
      if (cur.g === 'petitbac' && cur.step === 'check') p.answered = Object.keys(s.checked || {});
      if (cur.g === 'petitbac' && cur.step === 'write') {
        // on montre seulement qui a fini, pas les réponses
        p.answered = Object.keys(s.answers).filter(function (pid) { return s.answers[pid].done; });
      }
      p.answers = {};
    } else if (p.phase === 'vote') {
      p.answered = Object.keys(s.votes || {});
      p.answers = {};
      p.votes = {};
      p.options = (s.options || []).map(function (o) { return { id: o.id, text: o.text }; });
    } else {
      p.answered = Object.keys(s.answers);
    }
    return p;
  }

  function Engine(opts) {
    // opts : code, hasTv, state, bank, broadcast(view, remainingMs), persist(state),
    //        markPlayed(id), getPlayed() -> {id:true}, now(), setTimeout, clearTimeout
    this.o = opts;
    this.s = opts.state || newState(opts.code, opts.hasTv);
    this.timer = null;
    this.seen = {};
    var self = this, now = this.now();
    this.s.players.forEach(function (p) { self.seen[p.pid] = now; });
    this.resume();
    if (!opts.noHeartbeat) (opts.setInterval || setInterval)(function () { self.checkActive(); }, 4000);
  }

  // ---------- joueurs présents ----------
  // Un téléphone éteint ou fermé ne bloque plus la partie : on n'attend que les joueurs actifs.
  Engine.prototype.checkActive = function () {
    var s = this.s, now = this.now(), self = this, changed = false;
    s.players.forEach(function (p) {
      var off = now - (self.seen[p.pid] || 0) > OFFLINE_MS;
      if (!!p.off !== off) { p.off = off; changed = true; }
    });
    // capitaine injoignable : un joueur présent prend le relais
    var cap = this.player(s.captain);
    if (cap && cap.off) {
      var on = this.active();
      if (on.length) { s.captain = on[0].pid; changed = true; }
    }
    // plus aucun téléphone depuis un moment pendant une partie : retour au QR code
    var playing = s.phase !== 'lobby' && s.phase !== 'closed';
    if (playing && s.players.length && !this.active().length) {
      if (!this.allOffSince) this.allOffSince = now;
      if (now - this.allOffSince > ABANDON_MS) {
        this.allOffSince = 0;
        this.toLobby(true);
        this.publish();
        return;
      }
    } else {
      this.allOffSince = 0;
    }
    if (changed) {
      if (!this.checkDone()) this.publish(false);
    }
  };

  // Premier joueur présent (à défaut, le premier de la liste).
  Engine.prototype.nextCaptain = function () {
    var on = this.active();
    if (on.length) return on[0].pid;
    return this.s.players.length ? this.s.players[0].pid : null;
  };

  // Retour au salon (écran QR code). dropGone : on retire aussi les joueurs injoignables.
  Engine.prototype.toLobby = function (dropGone) {
    var s = this.s;
    this.cancel();
    if (dropGone) s.players = s.players.filter(function (p) { return !p.off; });
    s.phase = 'lobby'; s.round = 0; s.deck = []; s.cur = null; s.answers = {}; s.result = null;
    s.votes = {}; s.options = null; s.reject = {};
    s.players.forEach(function (p) { p.score = 0; });
    if (!this.player(s.captain)) s.captain = this.nextCaptain();
  };

  Engine.prototype.active = function () {
    return this.s.players.filter(function (p) { return !p.off; });
  };

  // Tout le monde a-t-il joué ? Si oui, on passe à la suite sans attendre le chrono.
  Engine.prototype.checkDone = function () {
    var s = this.s, act = this.active(), cur = s.cur;
    if (!act.length || !cur) return false;
    var done = false;
    if (s.phase === 'question') {
      if (cur.g === 'pyramide') done = false;
      else if (cur.g === 'croquis' || cur.g === 'rebus') {
        var found = {};
        cur.found.forEach(function (f) { found[f.pid] = true; });
        var guessers = act.filter(function (p) { return p.pid !== cur.drawer; });
        done = guessers.length > 0 && guessers.every(function (p) { return found[p.pid]; });
      } else if (cur.g === 'imposteur' && cur.step === 'talk') {
        if (act.every(function (p) { return s.ready[p.pid]; })) { this.nextStep('vote', 'voteTime'); return true; }
        return false;
      } else if (cur.g === 'petitbac' && cur.step === 'write') {
        if (act.every(function (p) { return s.answers[p.pid] && s.answers[p.pid].done; })) { this.startBacCheck(); return true; }
        return false;
      } else if (cur.g === 'petitbac' && cur.step === 'check') {
        done = act.every(function (p) { return s.checked[p.pid]; });
      } else if (cur.g === 'memoire' && cur.step === 'show') {
        done = false;
      } else done = act.every(function (p) { return s.answers[p.pid]; });
      if (done) { this.closeQuestion(); return true; }
    } else if (s.phase === 'vote') {
      done = act.every(function (p) { return s.votes[p.pid]; });
      if (done) { this.closeVote(); return true; }
    }
    return false;
  };

  Engine.prototype.pick = function (role, exclude) {
    var s = this.s, counts = s.roles[role] || (s.roles[role] = {});
    var cands = this.active().filter(function (p) { return p.pid !== exclude; });
    if (!cands.length) cands = s.players.filter(function (p) { return p.pid !== exclude; });
    var min = Math.min.apply(null, cands.map(function (p) { return counts[p.pid] || 0; }));
    var best = cands.filter(function (p) { return (counts[p.pid] || 0) === min; });
    var pid = best[Math.floor(Math.random() * best.length)].pid;
    counts[pid] = (counts[pid] || 0) + 1;
    return pid;
  };

  Engine.prototype.now = function () { return this.o.now ? this.o.now() : Date.now(); };

  // Durée d'un chrono selon le rythme choisi (calme / normal / rapide).
  Engine.prototype.dur = function (g, key) {
    var pace = GAMES[g].fixed ? 1 : (PACE[(this.s.settings || {}).pace] || 1);
    return Math.round(GAMES[g][key || 'time'] * pace) * 1000;
  };

  Engine.prototype.schedule = function (ms, fn) {
    var self = this;
    var st = this.o.setTimeout || setTimeout, ct = this.o.clearTimeout || clearTimeout;
    if (this.timer) ct(this.timer);
    this.timer = st(function () { self.timer = null; fn.call(self); }, Math.max(0, ms));
  };

  Engine.prototype.cancel = function () {
    var ct = this.o.clearTimeout || clearTimeout;
    if (this.timer) ct(this.timer);
    this.timer = null;
  };

  Engine.prototype.resume = function () {
    var s = this.s, now = this.now();
    if (s.phase === 'draw') this.schedule(s.drawUntil - now, this.startQuestion);
    else if (s.phase === 'question' && s.cur) this.schedule(s.cur.deadline - now, this.onDeadline);
    else if (s.phase === 'vote' && s.cur) this.schedule(s.cur.deadline - now, this.closeVote);
  };

  Engine.prototype.remaining = function () {
    var s = this.s, now = this.now();
    if (s.phase === 'draw') return Math.max(0, s.drawUntil - now);
    if ((s.phase === 'question' || s.phase === 'vote') && s.cur) return Math.max(0, s.cur.deadline - now);
    return 0;
  };

  Engine.prototype.publish = function (persist) {
    this.s.v++;
    this.o.broadcast(publicView(this.s), this.remaining());
    if (persist !== false && this.o.persist) this.o.persist(this.s);
  };

  Engine.prototype.player = function (pid) {
    var ps = this.s.players;
    for (var i = 0; i < ps.length; i++) if (ps[i].pid === pid) return ps[i];
    return null;
  };

  Engine.prototype.freeColor = function (wanted, pid) {
    var taken = {};
    this.s.players.forEach(function (p) { if (p.pid !== pid) taken[p.color] = true; });
    if (typeof wanted === 'number' && wanted >= 0 && wanted < COLOR_COUNT && !taken[wanted]) return wanted;
    for (var c = 0; c < COLOR_COUNT; c++) if (!taken[c]) return c;
    return 0;
  };

  Engine.prototype.handle = function (m) {
    if (!m || typeof m !== 'object' || typeof m.pid !== 'string') return;
    var s = this.s;
    if (this.player(m.pid)) {
      this.seen[m.pid] = this.now();
      var me = this.player(m.pid);
      if (me.off) { me.off = false; if (m.t === 'ping') this.publish(false); }
    }
    switch (m.t) {
      case 'ping':
        break;
      case 'announce':
        this.announce(m);
        break;
      case 'pyr':
        this.pyrVerdict(m);
        break;
      case 'guess':
        this.guess(m);
        break;
      case 'bac':
        this.bac(m);
        break;
      case 'ready':
        this.ready(m);
        break;
      case 'hello':
        this.publish(false);
        break;
      case 'join': {
        var name = String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 14);
        if (!name) return;
        var p = this.player(m.pid);
        if (p) {
          p.name = name;
          p.color = this.freeColor(m.color, m.pid);
        } else {
          if (s.players.length >= MAX_PLAYERS) return;
          s.players.push({ pid: m.pid, name: name, color: this.freeColor(m.color, m.pid), score: 0 });
          this.seen[m.pid] = this.now();
        }
        if (!s.captain || !this.player(s.captain)) s.captain = m.pid;
        this.publish();
        break;
      }
      case 'leave': {
        if (!this.player(m.pid)) return;
        s.players = s.players.filter(function (x) { return x.pid !== m.pid; });
        delete s.answers[m.pid];
        var wasCaptain = s.captain === m.pid;
        if (wasCaptain) s.captain = this.nextCaptain();
        if (s.phase !== 'lobby' && s.phase !== 'closed' && (!s.players.length || wasCaptain)) {
          // plus personne, ou le capitaine est parti : la partie s'arrête, retour au QR code
          this.toLobby(false);
          this.publish();
          return;
        } else if (s.phase === 'question' && s.cur && (s.cur.giver === m.pid || s.cur.partner === m.pid || s.cur.drawer === m.pid)) {
          // un rôle clé est parti : on arrête l'épreuve
          this.closeQuestion();
          return;
        } else if (this.checkDone()) {
          return;
        }
        this.publish();
        break;
      }
      case 'answer':
        this.answer(m);
        break;
      case 'vote':
        this.vote(m);
        break;
      case 'cmd':
        if (m.pid !== s.captain) return;
        this.command(m);
        break;
    }
  };

  Engine.prototype.answer = function (m) {
    var s = this.s;
    if (s.phase !== 'question' || !s.cur || m.round !== s.round) return;
    if (!this.player(m.pid)) return;
    var v = m.val, cur = s.cur, now = this.now();
    // Petit Bac : la grille se met à jour en continu jusqu'à « J'ai fini »
    if (cur.g === 'petitbac') {
      if (cur.step !== 'write' || (s.answers[m.pid] && s.answers[m.pid].done)) return;
      if (!v || !Array.isArray(v.w)) return;
      var w = cur.cats.map(function (_, i) { return String(v.w[i] == null ? '' : v.w[i]).slice(0, 30); });
      s.answers[m.pid] = { w: w, done: !!v.done, t: now - cur.startedAt };
      if (!v.done || !this.checkDone()) this.publish(false);
      return;
    }
    if (s.answers[m.pid]) return;
    if (cur.g === 'pyramide' || cur.g === 'croquis' || cur.g === 'rebus') return;
    if (cur.g === 'imposteur') {
      if (cur.step !== 'vote' || v === m.pid || !this.player(v)) return;
    } else if (cur.g === 'reflexe') {
      if (typeof v !== 'number' || !isFinite(v) || v > 15000) return;
      if (v < 100) v = -1; // parti avant le signal (ou impossible à battre) : faux départ
    } else if (cur.g === 'chrono') {
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 80000) return;
    } else if (cur.g === 'memoire') {
      if (cur.step !== 'ask' || typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > 8) return;
      s.answers[m.pid] = { v: v, t: now - (cur.stepAt || cur.startedAt) };
      if (!this.checkDone()) this.publish(false);
      return;
    } else if (cur.g === 'geo') {
      if (!Array.isArray(v) || v.length !== 2 || !isFinite(v[0]) || !isFinite(v[1])) return;
      v = [Math.round(Number(v[0])), Math.round(Number(v[1]))];
    } else if (s.cur.g === 'culture') {
      if (typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > 3) return;
    } else if (s.cur.g === 'estimation') {
      if (typeof v !== 'number' || !isFinite(v)) return;
    } else if (s.cur.g === 'ordre') {
      if (!Array.isArray(v) || v.length !== s.cur.items.length) return;
      var seen = {};
      for (var i = 0; i < v.length; i++) {
        if (typeof v[i] !== 'number' || v[i] < 0 || v[i] >= v.length || seen[v[i]]) return;
        seen[v[i]] = true;
      }
    } else if (s.cur.g === 'bluff') {
      v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, LIE_MAX);
      if (!normText(v)) return;
      s.reject = s.reject || {};
      var truths = [s.cur.a].concat(s.cur.alt || []);
      var isTruth = truths.some(function (t) { return similar(v, t) || containsTruth(v, t); });
      var dup = Object.keys(s.answers).some(function (pid) { return similar(v, s.answers[pid].v); });
      if (isTruth || dup) {
        s.reject[m.pid] = { why: isTruth ? 'truth' : 'dup', n: (s.reject[m.pid] ? s.reject[m.pid].n : 0) + 1 };
        this.publish(false);
        return;
      }
      delete s.reject[m.pid];
    }
    s.answers[m.pid] = { v: v, t: this.now() - s.cur.startedAt };
    if (!this.checkDone()) this.publish(false);
  };

  Engine.prototype.command = function (m) {
    var s = this.s;
    switch (m.cmd) {
      case 'settings':
        if (s.phase !== 'lobby') return;
        s.settings = sanitizeSettings(m.settings, s.settings);
        this.publish();
        break;
      case 'start':
        if (s.phase !== 'lobby' || !s.players.length) return;
        if (m.settings) s.settings = sanitizeSettings(m.settings, s.settings);
        this.startGame();
        break;
      case 'next':
        if (s.phase === 'reveal') this.nextRound();
        break;
      case 'rematch':
        if (s.phase === 'final') this.startGame();
        break;
      case 'lobby':
        if (s.phase === 'final' || s.phase === 'reveal') {
          this.toLobby(false);
          this.publish();
        }
        break;
    }
  };

  function pickOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }

  function sanitizeSettings(n, old) {
    n = n || {};
    old = old || {};
    var count = Math.round(Number(n.count));
    if (!(count >= 3 && count <= 40)) count = old.count || 15;
    var games = Array.isArray(n.games) ? n.games.filter(function (g, i, a) { return GAMES.hasOwnProperty(g) && a.indexOf(g) === i; }) : old.games;
    if (!games || !games.length) games = old.games || ['culture'];
    var freq = {}, src = n.freq || old.freq || {};
    Object.keys(GAMES).forEach(function (g) { var f = Number(src[g]); freq[g] = f === 0 || f === 2 ? f : 1; });
    return {
      count: count,
      games: games,
      finale: n.finale === undefined ? (old.finale !== false) : !!n.finale,
      mode: pickOf(n.mode, ['zapping', 'manches'], old.mode || 'zapping'),
      pace: pickOf(n.pace, ['calme', 'normal', 'rapide'], old.pace || 'normal'),
      diff: pickOf(n.diff, ['facile', 'mixte', 'difficile'], old.diff || 'mixte'),
      teams: n.teams === undefined ? !!old.teams : !!n.teams,
      teamOf: cleanTeamOf(n.teamOf === undefined ? old.teamOf : n.teamOf),
      sound: n.sound === undefined ? old.sound !== false : !!n.sound,
      freq: freq
    };
  }

  // Composition des équipes choisie par le capitaine : { pid: 0 | 1 }.
  function cleanTeamOf(t) {
    var out = {};
    if (!t || typeof t !== 'object') return out;
    Object.keys(t).slice(0, 12).forEach(function (pid) { if (t[pid] === 0 || t[pid] === 1) out[String(pid).slice(0, 40)] = t[pid]; });
    return out;
  }
  // Équipes de la partie : le choix du capitaine, les joueurs non placés vont dans l'équipe la plus petite.
  // Si une équipe reste vide, on rééquilibre.
  function teamsFor(players, teamOf) {
    var out = {}, n = [0, 0];
    teamOf = teamOf || {};
    players.forEach(function (p) { if (teamOf[p.pid] === 0 || teamOf[p.pid] === 1) { out[p.pid] = teamOf[p.pid]; n[teamOf[p.pid]]++; } });
    players.forEach(function (p) { if (out[p.pid] == null) { var t = n[0] <= n[1] ? 0 : 1; out[p.pid] = t; n[t]++; } });
    if (players.length >= 2 && (!n[0] || !n[1])) {
      var big = n[0] ? 0 : 1, moved = players[players.length - 1];
      out[moved.pid] = 1 - big;
    }
    return out;
  }

  // L'appareil qui fait tourner la partie la ferme pour tout le monde.
  Engine.prototype.close = function (byName) {
    this.cancel();
    this.s.phase = 'closed';
    this.s.closedBy = byName || '';
    this.publish();
  };

  Engine.prototype.startGame = function () {
    var s = this.s;
    s.players.forEach(function (p) { p.score = 0; });
    var played = this.o.getPlayed ? this.o.getPlayed() : {};
    var n = s.players.length;
    var games = s.settings.games.filter(function (g) { return !GAMES[g].min || n >= GAMES[g].min; });
    if (!games.length) return; // aucun jeu jouable avec ce nombre de joueurs : on reste au salon
    s.roles = {};
    s.stats = {};
    s.titles = null;
    s.recorded = false;
    s.players.forEach(function (p) { s.stats[p.pid] = newStats(); delete p.team; });
    if (s.settings.teams && s.players.length >= 2) {
      var tf = teamsFor(s.players, s.settings.teamOf);
      s.players.forEach(function (p) { p.team = tf[p.pid]; });
    }
    var excluded = this.o.getExcluded ? this.o.getExcluded() : {};
    s.deck = buildDeck(s.settings.count, games, this.o.bank, played,
      { excluded: excluded, freq: s.settings.freq, mode: s.settings.mode, diff: s.settings.diff });
    if (s.settings.finale) fixFinale(s.deck);
    s.round = 0;
    s.result = null;
    this.nextRound();
  };

  Engine.prototype.multiplier = function () {
    var s = this.s;
    return (s.settings.finale && s.deck.length >= 6 && s.round > s.deck.length - 3) ? 2 : 1;
  };

  Engine.prototype.nextRound = function () {
    var s = this.s;
    s.round++;
    s.answers = {};
    s.result = null;
    s.cur = null;
    if (s.round > s.deck.length) {
      this.cancel();
      s.phase = 'final';
      s.titles = computeTitles(s);
      if (!s.recorded && this.o.recordGame && s.players.length) {
        s.recorded = true;
        this.o.recordGame(s.players.map(function (p) { return { name: p.name, color: p.color, score: p.score, team: p.team }; }));
      }
      this.publish();
      return;
    }
    s.phase = 'draw';
    s.mult = this.multiplier();
    s.drawUntil = this.now() + DRAW_MS;
    this.schedule(DRAW_MS, this.startQuestion);
    this.publish();
  };

  Engine.prototype.startQuestion = function () {
    var s = this.s;
    var item = s.deck[s.round - 1];
    if (GAMES[item.g].min && s.players.length < GAMES[item.g].min) return this.nextRound();
    var q = findQuestion(this.o.bank, item.g, item.id);
    var now = this.now();
    var time = this.dur(item.g);
    s.cur = { g: item.g, id: item.id, q: q.q, a: q.a, startedAt: now, deadline: now + time, time: time };
    if (item.g === 'culture') s.cur.c = q.c;
    if (item.g === 'estimation') s.cur.u = q.u || '';
    if (item.g === 'bluff') s.cur.alt = q.alt || [];
    if (item.g === 'ordre') {
      // affichage mélangé ; l'ordre juste reste secret jusqu'à la révélation
      var idx = shuffle(q.items.map(function (_, i) { return i; }));
      s.cur.items = idx.map(function (i) { return { t: q.items[i].t }; });
      s.cur.vals = idx.map(function (i) { return q.items[i].v; });
      s.cur.order = q.items.map(function (_, i) { return idx.indexOf(i); });
      delete s.cur.a;
    }
    s.roles = s.roles || {};
    if (item.g === 'pyramide') {
      s.cur.giver = this.pick('giver');
      s.cur.partner = this.pick('partner', s.cur.giver);
      s.cur.step = 'announce';
      s.cur.n = null;
      s.cur.playTime = time;
      time = this.dur('pyramide', 'announceTime');
      s.cur.deadline = now + time;
      s.cur.time = time;
    }
    if (item.g === 'croquis') {
      s.cur.drawer = this.pick('drawer');
      s.cur.alt = q.alt || [];
      s.cur.found = [];
      s.feed = [];
      s.fb = {};
    }
    if (item.g === 'rebus') {
      s.cur.e = q.e;
      s.cur.cat = q.c;
      s.cur.alt = q.alt || [];
      s.cur.found = [];
      s.feed = [];
      s.fb = {};
    }
    if (item.g === 'imposteur') {
      // les téléphones retrouvent les mots dans leur banque ; la télé n'affiche jamais qui est l'imposteur
      s.cur.imp = this.pick('imp');
      s.cur.ci = Math.random() < 0.5 ? 0 : 1;
      s.cur.talk = shuffle(this.active().map(function (p) { return p.pid; }));
      s.cur.step = 'talk';
      s.ready = {};
      delete s.cur.a;
    }
    if (item.g === 'petitbac') {
      var cats = shuffle(((this.o.bank.petitbac_cats) || ['Pays', 'Prénom', 'Animal', 'Métier', 'Fruit ou légume']).slice()).slice(0, 5);
      s.cur.l = q.l;
      s.cur.cats = cats;
      s.cur.step = 'write';
      s.checked = {};
      s.bacRej = {};
      delete s.cur.a;
    }
    if (item.g === 'reflexe') {
      // délai avant le signal, mesuré par chaque téléphone : la connexion ne change rien
      s.cur.wait = 2000 + Math.floor(Math.random() * 4000);
      delete s.cur.a;
    }
    if (item.g === 'memoire') {
      var grid = shuffle(MEMO_POOL.slice()).slice(0, 9);
      var target = Math.floor(Math.random() * 9);
      s.cur.grid = grid;
      s.cur.target = grid[target];
      s.cur.ans = target;
      s.cur.step = 'show';
      time = this.dur('memoire', 'showTime');
      s.cur.deadline = now + time;
      s.cur.time = time;
      delete s.cur.a;
    }
    if (item.g === 'geo') {
      s.cur.q = q.a;
      s.cur.k = q.k;
      s.cur.c2 = q.c;
    }
    if (item.g === 'chrono') {
      s.cur.n = q.n;
      delete s.cur.a;
    }
    s.answers = {};
    s.reject = {};
    s.options = null;
    s.votes = {};
    s.phase = 'question';
    if (this.o.markPlayed) this.o.markPlayed(item.id);
    this.schedule(time, this.onDeadline);
    this.publish();
  };

  Engine.prototype.onDeadline = function () {
    var s = this.s, cur = s.cur;
    if (s.phase === 'question' && cur) {
      if (cur.g === 'pyramide' && cur.step === 'announce') return this.startPlay(3);
      if (cur.g === 'imposteur' && cur.step === 'talk') return this.nextStep('vote', 'voteTime');
      if (cur.g === 'petitbac' && cur.step === 'write') return this.startBacCheck();
      if (cur.g === 'memoire' && cur.step === 'show') return this.nextStep('ask', 'time');
    }
    this.closeQuestion();
  };

  // Étape suivante d'une épreuve en plusieurs temps (avec son propre chrono).
  Engine.prototype.nextStep = function (step, key) {
    var s = this.s, cur = s.cur, now = this.now(), time = this.dur(cur.g, key);
    cur.step = step;
    cur.time = time;
    cur.deadline = now + time;
    cur.stepAt = now;
    if (cur.g === 'imposteur') s.answers = {};
    this.schedule(time, this.onDeadline);
    this.publish();
  };

  // ---------- Petit Bac : vérification croisée ----------
  Engine.prototype.startBacCheck = function () {
    var s = this.s, cur = s.cur, self = this;
    // grille publique : chaque réponse, validée automatiquement sur la lettre
    cur.sheet = {};
    Object.keys(s.answers).forEach(function (pid) {
      if (!self.player(pid)) return;
      cur.sheet[pid] = (s.answers[pid].w || []).map(function (w) {
        w = String(w || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        return { w: w, ok: w.length >= 2 && firstLetter(w) === cur.l.toLowerCase() };
      });
    });
    s.checked = {};
    s.bacRej = {};
    var any = Object.keys(cur.sheet).some(function (pid) { return cur.sheet[pid].some(function (x) { return x.ok; }); });
    if (!any) return this.closeQuestion();
    this.nextStep('check', 'checkTime');
  };

  Engine.prototype.bac = function (m) {
    var s = this.s, cur = s.cur;
    if (s.phase !== 'question' || !cur || cur.g !== 'petitbac' || cur.step !== 'check' || m.round !== s.round) return;
    if (!this.player(m.pid)) return;
    if (m.done) {
      s.checked[m.pid] = true;
      if (!this.checkDone()) this.publish(false);
      return;
    }
    var key = String(m.key || ''), parts = key.split(':');
    if (parts[0] === m.pid || !cur.sheet[parts[0]] || !cur.sheet[parts[0]][Number(parts[1])]) return;
    var r = s.bacRej[key] || (s.bacRej[key] = {});
    if (r[m.pid]) delete r[m.pid]; else r[m.pid] = true;
    this.publish(false);
  };

  // ---------- Pyramide ----------
  Engine.prototype.announce = function (m) {
    var s = this.s, cur = s.cur;
    if (s.phase !== 'question' || !cur || cur.g !== 'pyramide' || m.round !== s.round) return;
    if (m.pid !== cur.giver || cur.step !== 'announce') return;
    var n = Number(m.n);
    if (n !== 1 && n !== 2 && n !== 3) return;
    this.startPlay(n);
  };

  Engine.prototype.startPlay = function (n) {
    var s = this.s, cur = s.cur, now = this.now();
    cur.step = 'play';
    cur.n = n;
    cur.time = cur.playTime;
    cur.deadline = now + cur.playTime;
    this.schedule(cur.playTime, this.onDeadline);
    this.publish();
  };

  Engine.prototype.pyrVerdict = function (m) {
    var s = this.s, cur = s.cur;
    if (s.phase !== 'question' || !cur || cur.g !== 'pyramide' || m.round !== s.round) return;
    if (m.pid !== cur.giver || cur.step !== 'play') return;
    cur.ok = !!m.ok;
    this.closeQuestion();
  };

  // ---------- L'Imposteur : « on passe au vote » ----------
  Engine.prototype.ready = function (m) {
    var s = this.s, cur = s.cur;
    if (s.phase !== 'question' || !cur || cur.g !== 'imposteur' || cur.step !== 'talk' || m.round !== s.round) return;
    if (!this.player(m.pid)) return;
    s.ready[m.pid] = true;
    if (!this.checkDone()) this.publish(false);
  };

  // ---------- Croquis et Rébus : propositions ----------
  Engine.prototype.guess = function (m) {
    var s = this.s, cur = s.cur;
    if (s.phase !== 'question' || !cur || (cur.g !== 'croquis' && cur.g !== 'rebus') || m.round !== s.round) return;
    if (!this.player(m.pid) || (cur.g === 'croquis' && m.pid === cur.drawer)) return;
    if (cur.found.some(function (f) { return f.pid === m.pid; })) return;
    var text = String(m.text == null ? '' : m.text).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!normText(text)) return;
    var words = [cur.a].concat(cur.alt || []);
    var ok = cur.g === 'rebus' ? matchGuess(text, words, null) : matchGuess(text, words, knownWords(this.o.bank));
    var prev = s.fb[m.pid] ? s.fb[m.pid].n : 0;
    if (ok) {
      cur.found.push({ pid: m.pid, t: this.now() - cur.startedAt });
      s.fb[m.pid] = { n: prev + 1, res: 'ok' };
      s.feed.push({ pid: m.pid, ok: true });
    } else {
      var near = words.some(function (w) { return nearMiss(text, w); });
      s.fb[m.pid] = { n: prev + 1, res: near ? 'near' : 'no' };
      s.feed.push({ pid: m.pid, text: text, near: near });
    }
    if (s.feed.length > 8) s.feed = s.feed.slice(-8);
    if (!this.checkDone()) this.publish(false);
  };

  Engine.prototype.closeQuestion = function () {
    var s = this.s;
    if (s.phase !== 'question') return;
    this.cancel();
    if (s.cur.g === 'bluff') return this.startVote();
    var mult = s.mult || 1;
    var res = {}, answers = s.answers, cur = s.cur;
    s.players.forEach(function (p) { res[p.pid] = { v: null, pts: 0 }; });

    if (cur.g === 'culture') {
      var good = Object.keys(answers).filter(function (pid) { return answers[pid].v === cur.a; });
      good.sort(function (a, b) { return answers[a].t - answers[b].t; });
      Object.keys(answers).forEach(function (pid) {
        if (!res[pid]) return;
        var ok = answers[pid].v === cur.a;
        res[pid] = { v: answers[pid].v, ok: ok, fast: ok && pid === good[0], pts: ok ? (20 + (pid === good[0] ? 10 : 0)) * mult : 0 };
      });
    } else if (cur.g === 'estimation') {
      var rows = Object.keys(answers).filter(function (pid) { return res[pid]; }).map(function (pid) {
        return { pid: pid, v: answers[pid].v, diff: Math.abs(answers[pid].v - cur.a) };
      });
      rows.sort(function (a, b) { return a.diff - b.diff; });
      rows.forEach(function (r, i) {
        r.rank = (i > 0 && r.diff === rows[i - 1].diff) ? rows[i - 1].rank : i;
        res[r.pid] = { v: r.v, diff: r.diff, rank: r.rank, exact: r.diff === 0, pts: (EST_POINTS[r.rank] || 0) * mult };
      });
    } else if (cur.g === 'pyramide') {
      var pts = cur.ok ? [0, 30, 20, 10][cur.n || 3] * mult : 0;
      if (res[cur.giver]) res[cur.giver] = { role: 'giver', ok: !!cur.ok, pts: pts };
      if (res[cur.partner]) res[cur.partner] = { role: 'partner', ok: !!cur.ok, pts: pts };
    } else if (cur.g === 'croquis') {
      cur.found.forEach(function (f, i) {
        if (res[f.pid]) res[f.pid] = { found: true, rank: i, pts: ([30, 20, 10][i] || 10) * mult };
      });
      if (res[cur.drawer]) res[cur.drawer] = { role: 'drawer', pts: cur.found.length * 10 * mult, finders: cur.found.length };
    } else if (cur.g === 'ordre') {
      Object.keys(answers).forEach(function (pid) {
        if (!res[pid]) return;
        var v = answers[pid].v, good = 0;
        for (var i = 0; i < cur.order.length; i++) if (v[i] === cur.order[i]) good++;
        res[pid] = { v: v, good: good, pts: (good * 5 + (good === cur.order.length ? 10 : 0)) * mult };
      });
    } else if (cur.g === 'rebus') {
      cur.found.forEach(function (f, i) {
        if (res[f.pid]) res[f.pid] = { found: true, rank: i, pts: ([30, 20][i] || 10) * mult };
      });
    } else if (cur.g === 'imposteur') {
      var tally = {}, max = 0;
      Object.keys(answers).forEach(function (pid) { var t = answers[pid].v; tally[t] = (tally[t] || 0) + 1; if (tally[t] > max) max = tally[t]; });
      var tops = Object.keys(tally).filter(function (pid) { return tally[pid] === max; });
      var caught = max > 0 && tops.length === 1 && tops[0] === cur.imp;
      cur.caught = caught;
      cur.tally = tally;
      s.players.forEach(function (p) {
        var vote = answers[p.pid] ? answers[p.pid].v : null, imp = p.pid === cur.imp, ok = vote === cur.imp;
        var pts = imp ? (caught ? 0 : 30) : caught ? (ok ? 30 : 10) : (ok ? 10 : 0);
        res[p.pid] = { role: imp ? 'imp' : 'civ', vote: vote, ok: ok, caught: caught, pts: pts * mult };
      });
    } else if (cur.g === 'petitbac') {
      var sheet = cur.sheet || {}, act = this.active(), rej = s.bacRej || {};
      var valid = {};
      Object.keys(sheet).forEach(function (pid) {
        var others = act.filter(function (p) { return p.pid !== pid; }).length;
        var need = Math.max(1, Math.ceil(others / 2));
        valid[pid] = sheet[pid].map(function (x, i) {
          var nRej = Object.keys(rej[pid + ':' + i] || {}).length;
          return x.ok && x.w && nRej < need;
        });
      });
      Object.keys(sheet).forEach(function (pid) {
        if (!res[pid]) return;
        var total = 0, uniq = 0;
        var marks = sheet[pid].map(function (x, i) {
          if (!valid[pid][i]) return { w: x.w, st: x.w ? (x.ok ? 'rej' : 'bad') : 'empty', pts: 0 };
          var shared = Object.keys(sheet).some(function (o) { return o !== pid && valid[o][i] && similar(sheet[o][i].w, x.w); });
          var pts = shared ? BAC_POINTS.shared : BAC_POINTS.unique;
          if (!shared) uniq++;
          total += pts;
          return { w: x.w, st: shared ? 'shared' : 'unique', pts: pts * mult };
        });
        res[pid] = { marks: marks, uniq: uniq, pts: total * mult };
      });
    } else if (cur.g === 'reflexe') {
      var okR = Object.keys(answers).filter(function (pid) { return res[pid] && answers[pid].v >= 0; });
      okR.sort(function (a, b) { return answers[a].v - answers[b].v; });
      Object.keys(answers).forEach(function (pid) {
        if (!res[pid]) return;
        var rk = okR.indexOf(pid), v = answers[pid].v;
        res[pid] = { v: v, early: v < 0, rank: rk, pts: rk < 0 ? 0 : ([30, 20, 10][rk] || 5) * mult };
      });
    } else if (cur.g === 'chrono') {
      var target = cur.n * 1000;
      var rowsC = Object.keys(answers).filter(function (pid) { return res[pid]; }).map(function (pid) {
        return { pid: pid, v: answers[pid].v, diff: Math.abs(answers[pid].v - target) };
      });
      rowsC.sort(function (a, b) { return a.diff - b.diff; });
      rowsC.forEach(function (r, i) {
        r.rank = (i > 0 && r.diff === rowsC[i - 1].diff) ? rowsC[i - 1].rank : i;
        res[r.pid] = { v: r.v, diff: r.diff, rank: r.rank, pts: (EST_POINTS[r.rank] || 0) * mult };
      });
    } else if (cur.g === 'memoire') {
      var goodM = Object.keys(answers).filter(function (pid) { return answers[pid].v === cur.ans; });
      goodM.sort(function (a, b) { return answers[a].t - answers[b].t; });
      Object.keys(answers).forEach(function (pid) {
        if (!res[pid]) return;
        var ok = answers[pid].v === cur.ans;
        res[pid] = { v: answers[pid].v, ok: ok, fast: ok && pid === goodM[0], pts: ok ? (20 + (pid === goodM[0] ? 10 : 0)) * mult : 0 };
      });
    } else if (cur.g === 'geo') {
      var geo = this.o.geo || (typeof GEO !== 'undefined' ? GEO : null);
      Object.keys(answers).forEach(function (pid) {
        if (!res[pid]) return;
        var v = answers[pid].v, km = geo ? geoDistance(geo, cur.k, v[0], v[1]) : 99999;
        res[pid] = { v: v, km: km, inside: km === 0, pts: geoPoints(km) * mult };
      });
    }

    this.finish(res);
  };

  Engine.prototype.finish = function (res) {
    var s = this.s, cur = s.cur;
    s.players.forEach(function (p) { if (res[p.pid]) p.score += res[p.pid].pts; });
    // statistiques pour les titres de fin de partie
    s.stats = s.stats || {};
    Object.keys(res).forEach(function (pid) {
      var st = s.stats[pid] || (s.stats[pid] = newStats()), r = res[pid];
      st.byGame[cur.g] = (st.byGame[cur.g] || 0) + (r.pts || 0);
      if (cur.g === 'culture' && r.fast) st.fast++;
      if (cur.g === 'estimation' && r.v != null && r.rank === 0) st.estWin++;
      if (cur.g === 'bluff') st.fooled += r.fooled || 0;
      if (cur.g === 'ordre') st.ordre += r.good || 0;
      if (cur.g === 'croquis' && r.role === 'drawer') st.drawn += r.finders || 0;
      if (cur.g === 'croquis' && r.found) st.guessed++;
      if (cur.g === 'pyramide' && r.role === 'giver' && cur.n === 1) st.kamikaze++;
      if (cur.g === 'imposteur' && r.role === 'imp' && !r.caught) st.spy++;
      if (cur.g === 'imposteur' && r.role === 'civ' && r.ok) st.detect++;
      if (cur.g === 'rebus' && r.found) st.rebus++;
      if (cur.g === 'petitbac') st.bac += r.uniq || 0;
      if (cur.g === 'reflexe' && r.rank === 0) st.reflex++;
      if (cur.g === 'chrono' && r.v != null && r.rank === 0) st.clock++;
      if (cur.g === 'memoire' && r.ok) st.memo++;
      if (cur.g === 'geo' && r.v) st.geo += r.pts || 0;
    });
    s.result = res;
    s.phase = 'reveal';
    this.publish();
  };

  function newStats() { return { byGame: {}, fast: 0, estWin: 0, fooled: 0, ordre: 0, drawn: 0, guessed: 0, kamikaze: 0, spy: 0, detect: 0, rebus: 0, bac: 0, reflex: 0, clock: 0, memo: 0, geo: 0 }; }

  var TITLES = [
    { k: 'fooled', name: 'Le Mytho', why: 'a piégé le plus de monde au Bluff' },
    { k: 'drawn', name: 'Picasso', why: 'ses dessins ont été les plus trouvés' },
    { k: 'estWin', name: 'La Calculette', why: 'le plus précis aux estimations' },
    { k: 'kamikaze', name: 'Le Kamikaze', why: 'a tenté « 1 indice » le plus souvent' },
    { k: 'fast', name: 'L\'Éclair', why: 'le plus rapide en Culture G' },
    { k: 'ordre', name: 'L\'Historien', why: 'le meilleur à Dans l\'ordre' },
    { k: 'guessed', name: 'Le Devin', why: 'a deviné le plus de croquis' },
    { k: 'spy', name: 'L\'Agent double', why: 'imposteur jamais démasqué' },
    { k: 'detect', name: 'Le Détective', why: 'a démasqué le plus d\'imposteurs' },
    { k: 'rebus', name: 'Le Décodeur', why: 'a résolu le plus de rébus' },
    { k: 'bac', name: 'Le Dico', why: 'le plus de mots uniques au Petit Bac' },
    { k: 'reflex', name: 'Le Ninja', why: 'les meilleurs réflexes' },
    { k: 'clock', name: 'L\'Horloge suisse', why: 'le plus précis à Pile-poil' },
    { k: 'memo', name: 'Mémoire d\'éléphant', why: 'n\'oublie rien' },
    { k: 'geo', name: 'Le Globe-trotteur', why: 'le meilleur sur la carte du monde' }
  ];

  // Chaque joueur repart avec au moins un titre.
  function computeTitles(s) {
    var out = {}, stats = s.stats || {};
    s.players.forEach(function (p) { out[p.pid] = []; });
    TITLES.forEach(function (t) {
      var max = 0;
      s.players.forEach(function (p) { var v = (stats[p.pid] || {})[t.k] || 0; if (v > max) max = v; });
      if (!max) return;
      s.players.forEach(function (p) { if (((stats[p.pid] || {})[t.k] || 0) === max) out[p.pid].push({ name: t.name, why: t.why }); });
    });
    s.players.forEach(function (p) {
      if (out[p.pid].length) return;
      var by = (stats[p.pid] || {}).byGame || {}, best = null;
      Object.keys(by).forEach(function (g) { if (by[g] > 0 && (!best || by[g] > by[best])) best = g; });
      out[p.pid].push(best ? { name: 'Spécialiste ' + GAMES[best].name, why: 'son meilleur jeu ce soir' } :
        { name: 'Le Touriste', why: 'surtout là pour l\'ambiance' });
    });
    return out;
  }

  // Présentation homogène des réponses : majuscule au début, pas de point final.
  function tidy(t) {
    t = String(t).replace(/[\s.]+$/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ---------- Le Bluff : vote ----------
  Engine.prototype.startVote = function () {
    var s = this.s, now = this.now(), self = this;
    var opts = [{ text: s.cur.a, by: null }];
    Object.keys(s.answers).forEach(function (pid) {
      if (self.player(pid)) opts.push({ text: tidy(s.answers[pid].v), by: pid });
    });
    s.options = shuffle(opts).map(function (o, i) { return { id: 'o' + i, text: o.text, by: o.by }; });
    s.votes = {};
    s.reject = {};
    if (opts.length < 2) return this.closeVote();
    var time = this.dur(s.cur.g, 'voteTime');
    s.cur.deadline = now + time;
    s.cur.time = time;
    s.phase = 'vote';
    this.schedule(time, this.closeVote);
    this.publish();
  };

  Engine.prototype.vote = function (m) {
    var s = this.s;
    if (s.phase !== 'vote' || m.round !== s.round || !this.player(m.pid) || s.votes[m.pid]) return;
    var opt = null;
    (s.options || []).forEach(function (o) { if (o.id === m.opt) opt = o; });
    if (!opt || opt.by === m.pid) return;
    s.votes[m.pid] = opt.id;
    if (!this.checkDone()) this.publish(false);
  };

  Engine.prototype.closeVote = function () {
    var s = this.s;
    if (s.phase !== 'vote' && s.phase !== 'question') return;
    this.cancel();
    var mult = s.mult || 1, res = {}, byId = {};
    (s.options || []).forEach(function (o) { byId[o.id] = o; });
    s.players.forEach(function (p) { res[p.pid] = { pts: 0, found: false, voted: s.votes[p.pid] || null, fooled: 0, lie: s.answers[p.pid] ? s.answers[p.pid].v : null }; });
    Object.keys(s.votes).forEach(function (pid) {
      var o = byId[s.votes[pid]];
      if (!o || !res[pid]) return;
      if (o.by === null) res[pid].found = true;
      else if (res[o.by]) res[o.by].fooled++;
    });
    Object.keys(res).forEach(function (pid) {
      var r = res[pid];
      r.pts = ((r.found ? 15 : 0) + Math.min(15, r.fooled * 5)) * mult;
    });
    this.finish(res);
  };

  var api = { sanitizeSettings: sanitizeSettings, computeTitles: computeTitles, countsFor: countsFor, nearMiss: nearMiss, Engine: Engine, GAMES: GAMES, newState: newState, publicView: publicView, buildDeck: buildDeck, buildOrder: buildOrder, teamsFor: teamsFor, fixFinale: fixFinale, geoDistance: geoDistance, firstLetter: firstLetter, similar: similar, matchGuess: matchGuess, knownWords: knownWords, normText: normText, containsTruth: containsTruth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCEngine = api;
})(this);
