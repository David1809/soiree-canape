// Moteur de partie Soirée Canapé.
// Il tourne sur UN seul appareil (la télé, ou le téléphone qui a créé la partie)
// et fait autorité : il reçoit les actions des joueurs et diffuse l'état.
// Écrit en ES5 pour rester compatible avec le navigateur des télés Samsung.
(function (root) {
  'use strict';

  var GAMES = {
    culture: { name: 'Culture générale', time: 20 },
    estimation: { name: 'Estimation', time: 30 }
  };
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
      settings: { count: 15, games: ['culture', 'estimation'], finale: true },
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
    if (p.phase === 'question') {
      if (p.cur) delete p.cur.a;
      p.answered = Object.keys(s.answers);
      p.answers = {};
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
    this.resume();
  }

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
    else if (s.phase === 'question' && s.cur) this.schedule(s.cur.deadline - now, this.closeQuestion);
  };

  Engine.prototype.remaining = function () {
    var s = this.s, now = this.now();
    if (s.phase === 'draw') return Math.max(0, s.drawUntil - now);
    if (s.phase === 'question' && s.cur) return Math.max(0, s.cur.deadline - now);
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
    switch (m.t) {
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
        }
        if (!s.captain || !this.player(s.captain)) s.captain = m.pid;
        this.publish();
        break;
      }
      case 'leave': {
        if (s.phase !== 'lobby') return;
        s.players = s.players.filter(function (x) { return x.pid !== m.pid; });
        if (s.captain === m.pid) s.captain = s.players.length ? s.players[0].pid : null;
        this.publish();
        break;
      }
      case 'answer':
        this.answer(m);
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
    if (s.cur.g === 'culture') {
      if (typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > 3) return;
    } else if (s.cur.g === 'estimation') {
      if (typeof v !== 'number' || !isFinite(v)) return;
    }
    s.answers[m.pid] = { v: v, t: this.now() - s.cur.startedAt };
    if (Object.keys(s.answers).length >= s.players.length) this.closeQuestion();
    else this.publish(false);
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
    var games = Array.isArray(n.games) ? n.games.filter(function (g) { return GAMES.hasOwnProperty(g); }) : old.games;
    if (!games.length) games = old.games;
    return { count: count, games: games, finale: n.finale === undefined ? old.finale : !!n.finale };
  }

  Engine.prototype.startGame = function () {
    var s = this.s;
    s.players.forEach(function (p) { p.score = 0; });
    var played = this.o.getPlayed ? this.o.getPlayed() : {};
    s.deck = buildDeck(s.settings.count, s.settings.games, this.o.bank, played);
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
    var q = findQuestion(this.o.bank, item.g, item.id);
    var now = this.now();
    var time = GAMES[item.g].time * 1000;
    s.cur = { g: item.g, id: item.id, q: q.q, a: q.a, startedAt: now, deadline: now + time, time: time };
    if (item.g === 'culture') s.cur.c = q.c;
    if (item.g === 'estimation') s.cur.u = q.u || '';
    s.answers = {};
    s.phase = 'question';
    if (this.o.markPlayed) this.o.markPlayed(item.id);
    this.schedule(time, this.closeQuestion);
    this.publish();
  };

  Engine.prototype.closeQuestion = function () {
    var s = this.s;
    if (s.phase !== 'question') return;
    this.cancel();
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
    }

    s.players.forEach(function (p) { p.score += res[p.pid].pts; });
    s.result = res;
    s.phase = 'reveal';
    this.publish();
  };

  var api = { Engine: Engine, GAMES: GAMES, newState: newState, publicView: publicView, buildDeck: buildDeck, buildOrder: buildOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCEngine = api;
})(this);
