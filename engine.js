// Moteur de partie Soirée Canapé.
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
    pyramide: { name: 'Pyramide', time: 30, announceTime: 12, min: 2 },
    croquis: { name: 'Croquis', time: 60, min: 2 }
  };
  var OFFLINE_MS = 25000;
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
  function buildOrder(count, games) {
    var per = {}, i, k = games.length;
    for (i = 0; i < k; i++) per[games[i]] = Math.floor(count / k);
    var extra = shuffle(games.slice()).slice(0, count - Math.floor(count / k) * k);
    for (i = 0; i < extra.length; i++) per[extra[i]]++;
    var order = [], last = null;
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

  // Questions : d'abord celles jamais jouées, puis les autres.
  function buildDeck(count, games, bank, played) {
    var order = buildOrder(count, games);
    var pools = {};
    function refill(g) {
      var all = bank[g] || [];
      var fresh = shuffle(all.filter(function (q) { return !played[q.id]; }));
      var old = shuffle(all.filter(function (q) { return played[q.id]; }));
      return fresh.concat(old);
    }
    var used = {};
    return order.map(function (g) {
      if (!pools[g] || !pools[g].length) pools[g] = refill(g).filter(function (q) { return !used[q.id]; });
      if (!pools[g].length) pools[g] = shuffle((bank[g] || []).slice());
      var q = pools[g].shift();
      used[q.id] = true;
      return { g: g, id: q.id };
    });
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
      settings: { count: 15, games: ['culture', 'estimation', 'bluff', 'ordre', 'pyramide', 'croquis'], finale: true },
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
      if (p.cur) { delete p.cur.a; delete p.cur.alt; delete p.cur.order; delete p.cur.vals; }
    }
    if (p.phase === 'question' && p.cur && p.cur.found) {
      p.cur.found = p.cur.found.map(function (f) { return { pid: f.pid }; });
    }
    if (p.phase === 'question') {
      p.answered = Object.keys(s.answers);
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
    if (changed) {
      if (!this.checkDone()) this.publish(false);
    }
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
      else if (cur.g === 'croquis') {
        var found = {};
        cur.found.forEach(function (f) { found[f.pid] = true; });
        var guessers = act.filter(function (p) { return p.pid !== cur.drawer; });
        done = guessers.length > 0 && guessers.every(function (p) { return found[p.pid]; });
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
        if (s.captain === m.pid) s.captain = s.players.length ? s.players[0].pid : null;
        if (!s.players.length && s.phase !== 'lobby') {
          // plus personne : on revient au salon
          this.cancel();
          s.phase = 'lobby'; s.round = 0; s.deck = []; s.cur = null; s.answers = {}; s.result = null;
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
    if (!this.player(m.pid) || s.answers[m.pid]) return;
    var v = m.val;
    if (s.cur.g === 'pyramide' || s.cur.g === 'croquis') return;
    if (s.cur.g === 'culture') {
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
          this.cancel();
          s.phase = 'lobby'; s.round = 0; s.deck = []; s.cur = null; s.answers = {}; s.result = null;
          s.players.forEach(function (p) { p.score = 0; });
          this.publish();
        }
        break;
    }
  };

  function sanitizeSettings(n, old) {
    n = n || {};
    var count = Math.round(Number(n.count));
    if (!(count >= 3 && count <= 40)) count = old.count;
    var games = Array.isArray(n.games) ? n.games.filter(function (g, i, a) { return GAMES.hasOwnProperty(g) && a.indexOf(g) === i; }) : old.games;
    if (!games.length) games = old.games;
    return { count: count, games: games, finale: n.finale === undefined ? old.finale : !!n.finale };
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
    var n = this.active().length || s.players.length;
    var games = s.settings.games.filter(function (g) { return !GAMES[g].min || n >= GAMES[g].min; });
    if (!games.length) games = ['culture'];
    s.roles = {};
    s.deck = buildDeck(s.settings.count, games, this.o.bank, played);
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
    if (GAMES[item.g].min && this.active().length < GAMES[item.g].min) return this.nextRound();
    var q = findQuestion(this.o.bank, item.g, item.id);
    var now = this.now();
    var time = GAMES[item.g].time * 1000;
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
      time = GAMES.pyramide.announceTime * 1000;
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
    var s = this.s;
    if (s.phase === 'question' && s.cur && s.cur.g === 'pyramide' && s.cur.step === 'announce') return this.startPlay(3);
    this.closeQuestion();
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

  // ---------- Croquis ----------
  Engine.prototype.guess = function (m) {
    var s = this.s, cur = s.cur;
    if (s.phase !== 'question' || !cur || cur.g !== 'croquis' || m.round !== s.round) return;
    if (!this.player(m.pid) || m.pid === cur.drawer) return;
    if (cur.found.some(function (f) { return f.pid === m.pid; })) return;
    var text = String(m.text == null ? '' : m.text).replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!normText(text)) return;
    var words = [cur.a].concat(cur.alt || []);
    var ok = words.some(function (w) { return similar(text, w); });
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
    }

    this.finish(res);
  };

  Engine.prototype.finish = function (res) {
    var s = this.s;
    s.players.forEach(function (p) { if (res[p.pid]) p.score += res[p.pid].pts; });
    s.result = res;
    s.phase = 'reveal';
    this.publish();
  };

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
    var time = GAMES.bluff.voteTime * 1000;
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

  var api = { nearMiss: nearMiss, Engine: Engine, GAMES: GAMES, newState: newState, publicView: publicView, buildDeck: buildDeck, buildOrder: buildOrder, similar: similar, normText: normText, containsTruth: containsTruth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCEngine = api;
})(this);
