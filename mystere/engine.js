// Soirée Mystère — moteur de règles (ES5, sans dépendance). Tourne sur la télé (ou sur le téléphone du capitaine en secours).
(function (root) {
  'use strict';

  var SUSPECTS = ['Mathias', 'David', 'Léa', 'Christelle', "L'Androïde", "L'IA du bord"];
  var MODULES = ['Cockpit', 'Laboratoire', 'Serre', 'Soute', 'Salle des machines', 'Cabines'];
  var MEANS = ['Torche de soudure', 'Virus informatique', 'Câble arraché', 'Gaz soporifique', 'Liquide de refroidissement', 'Marteau magnétique'];
  // cartes : 0-5 suspects, 6-11 modules, 12-17 moyens
  var NCARDS = 18;
  var VENTS = { 0: 3, 3: 0, 1: 4, 4: 1 };
  var ONLINE_MS = 25000, ABANDON_MS = 60000;
  var MAXLOG = 40;

  function cardName(c) {
    if (c < 6) return SUSPECTS[c];
    if (c < 12) return MODULES[c - 6];
    return MEANS[c - 12];
  }
  function cardKind(c) { return c < 6 ? 'who' : c < 12 ? 'where' : 'what'; }
  function neighbors(r) {
    var o = [(r + 1) % 6, (r + 5) % 6];
    if (VENTS[r] !== undefined) o.push(VENTS[r]);
    return o;
  }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function newState(code) {
    return {
      game: 'mystere', code: code, phase: 'lobby', created: Date.now(),
      settings: { timer: 45, refuteTimer: 30 },
      players: [], captain: null,
      turn: -1, step: '', deadline: 0, pawns: [0, 1, 2, 3, 4, 5],
      round: 0, log: [], last: null, refuter: null, winner: null, reveal: null, closedBy: '',
      secret: null
    };
  }

  // Vue publique : jamais la solution (sauf fin de partie), jamais les mains.
  function publicView(st) {
    var v = clone(st);
    delete v.secret;
    v.players = st.players.map(function (p) {
      return { pid: p.pid, name: p.name, sid: p.sid, out: !!p.out, abandoned: !!p.abandoned, online: !!p.online, nc: p.nc || 0 };
    });
    if (v.last) { delete v.last.cards; }
    return v;
  }

  function Engine(opts) {
    this.o = opts;
    this.st = opts.state || newState(opts.code);
    this.seen = {};          // pid -> dernier message reçu (mémoire seulement)
    this.legacy();
    this.markAll();
  }

  var P = Engine.prototype;

  P.legacy = function () { if (!this.st.settings) this.st.settings = { timer: 45, refuteTimer: 30 }; };
  P.markAll = function () { var n = Date.now(), s = this.seen; this.st.players.forEach(function (p) { s[p.pid] = n; }); };

  P.find = function (pid) {
    for (var i = 0; i < this.st.players.length; i++) if (this.st.players[i].pid === pid) return this.st.players[i];
    return null;
  };
  P.idx = function (pid) {
    for (var i = 0; i < this.st.players.length; i++) if (this.st.players[i].pid === pid) return i;
    return -1;
  };
  P.say = function (text, kind) {
    var st = this.st;
    st.log.push({ at: Date.now(), k: kind || 'i', t: text });
    if (st.log.length > MAXLOG) st.log.splice(0, st.log.length - MAXLOG);
  };
  P.nm = function (pid) { var p = this.find(pid); return p ? p.name : '?'; };

  P.rem = function () { return this.st.deadline ? Math.max(0, this.st.deadline - Date.now()) : 0; };
  P.publish = function () {
    this.refreshOnline();
    var st = this.st;
    this.o.broadcast(publicView(st), this.rem());
    this.persistNow();
  };
  P.persistNow = function () { if (this.o.persist) this.o.persist(this.st); };
  P.priv = function (pid, ev, payload) { if (this.o.priv) this.o.priv(pid, ev, payload); };

  P.refreshOnline = function () {
    var n = Date.now(), self = this;
    this.st.players.forEach(function (p) {
      var last = self.seen[p.pid] || 0;
      p.online = n - last < ONLINE_MS;
      p.abandoned = n - last >= ABANDON_MS;
    });
  };

  P.captainFix = function () {
    var st = this.st, cur = this.find(st.captain);
    if (cur && !cur.abandoned) return;
    st.captain = null;
    for (var i = 0; i < st.players.length; i++) if (!st.players[i].abandoned) { st.captain = st.players[i].pid; return; }
    if (st.players.length) st.captain = st.players[0].pid;
  };

  // ---------- messages entrants ----------
  P.handle = function (m) {
    if (!m || !m.t) return;
    var st = this.st, p = m.pid ? this.find(m.pid) : null;
    if (m.pid && p) { this.seen[m.pid] = Date.now(); }
    var t = m.t;

    if (t === 'cmd') return this.cmd(m);
    if (t === 'join') return this.join(m);
    if (t === 'ping') return;
    if (t === 'hello') {
      if (p) this.sendHand(p.pid);
      return this.publish();
    }
    if (t === 'leave') { return this.leave(m.pid); }
    if (!p) return;

    if (t === 'badge' && st.phase === 'lobby') return this.badge(p, m.sid);
    if (st.phase !== 'play') return;
    if (t === 'move') return this.move(p, m.room);
    if (t === 'suspect') return this.suspect(p, m.s, m.w);
    if (t === 'endturn') return this.endturn(p);
    if (t === 'accuse') return this.accuse(p, m.s, m.m, m.w);
    if (t === 'refute') return this.refute(p, m.card);
  };

  P.cmd = function (m) {
    var st = this.st, c = m.c;
    if (c === 'resend') { var p0 = this.find(m.pid); if (p0) this.sendHand(p0.pid); return this.publish(); }
    // seuls la télé (pid vide) et le capitaine pilotent
    var isHost = !m.pid || m.pid === st.captain;
    if (!isHost) return;
    if (c === 'start') return this.start();
    if (c === 'settings') {
      if (st.phase !== 'lobby') return;
      if (typeof m.timer === 'number') st.settings.timer = m.timer;
      if (typeof m.refuteTimer === 'number') st.settings.refuteTimer = m.refuteTimer;
      return this.publish();
    }
    if (c === 'lobby') {
      st.phase = 'lobby'; st.turn = -1; st.step = ''; st.deadline = 0; st.last = null; st.refuter = null;
      st.winner = null; st.reveal = null; st.secret = null; st.pawns = [0, 1, 2, 3, 4, 5];
      st.players.forEach(function (p) { p.out = false; p.nc = 0; });
      this.say('Retour au salon.', 'i');
      return this.publish();
    }
    if (c === 'close') { st.phase = 'closed'; st.closedBy = m.pid ? this.nm(m.pid) : ''; return this.publish(); }
    if (c === 'kick' && st.phase === 'lobby') {
      var i = this.idx(m.target);
      if (i >= 0) { st.players.splice(i, 1); this.captainFix(); return this.publish(); }
    }
  };

  P.join = function (m) {
    var st = this.st, name = String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Joueur';
    var p = this.find(m.pid);
    if (p) { p.name = name; this.seen[p.pid] = Date.now(); this.sendHand(p.pid); return this.publish(); }
    if (st.phase !== 'lobby') return this.priv(m.pid, 'err', { msg: 'La partie a déjà commencé.' });
    if (st.players.length >= 6) return this.priv(m.pid, 'err', { msg: 'La partie est complète (6 joueurs).' });
    var taken = {};
    st.players.forEach(function (x) { taken[x.sid] = 1; });
    var sid = typeof m.sid === 'number' && m.sid >= 0 && m.sid < 6 && !taken[m.sid] ? m.sid : -1;
    if (sid < 0) for (var i = 0; i < 6; i++) if (!taken[i]) { sid = i; break; }
    this.seen[m.pid] = Date.now();
    st.players.push({ pid: m.pid, name: name, sid: sid, out: false, nc: 0 });
    if (!st.captain) st.captain = m.pid;
    this.say(name + ' monte à bord.', 'i');
    this.publish();
  };

  P.leave = function (pid) {
    var st = this.st, i = this.idx(pid);
    if (i < 0) return;
    if (st.phase === 'lobby') {
      this.say(st.players[i].name + ' quitte le vaisseau.', 'i');
      st.players.splice(i, 1);
      this.captainFix();
    } else {
      this.seen[pid] = 0; // abandon : ses cartes continuent de réfuter automatiquement
      this.say(st.players[i].name + ' a quitté la partie.', 'i');
      this.captainFix();
      if (st.turn === i && st.step !== 'refute') this.nextTurn();
    }
    this.publish();
  };

  P.badge = function (p, sid) {
    if (typeof sid !== 'number' || sid < 0 || sid > 5) return;
    var taken = false;
    this.st.players.forEach(function (x) { if (x !== p && x.sid === sid) taken = true; });
    if (taken) return;
    p.sid = sid;
    this.publish();
  };

  // ---------- démarrage ----------
  P.start = function () {
    var st = this.st;
    if (st.phase !== 'lobby' || st.players.length < 3) return;
    var sol = [rnd(6), 6 + rnd(6), 12 + rnd(6)];
    var rest = [];
    for (var c = 0; c < NCARDS; c++) if (sol.indexOf(c) < 0) rest.push(c);
    rest = shuffle(rest);
    var hands = {}, n = st.players.length;
    st.players.forEach(function (p) { hands[p.pid] = []; });
    rest.forEach(function (c, i) { hands[st.players[i % n].pid].push(c); });
    st.players.forEach(function (p) { p.nc = hands[p.pid].length; p.out = false; });
    st.secret = { sol: sol, hands: hands, shown: {}, gid: Date.now().toString(36) + rnd(1000) };
    st.pawns = [0, 1, 2, 3, 4, 5];
    st.phase = 'play'; st.round = 1; st.log = []; st.last = null; st.refuter = null;
    st.winner = null; st.reveal = null;
    st.turn = rnd(n);
    this.markAll();
    this.say('Le réacteur est saboté ! Qui, où, avec quoi ? Menez l’enquête.', 'i');
    this.beginTurn();
    var self = this;
    st.players.forEach(function (p) { self.sendHand(p.pid); });
    this.publish();
  };

  P.sendHand = function (pid) {
    var st = this.st;
    if (!st.secret || !st.secret.hands[pid]) return;
    this.priv(pid, 'hand', { code: st.code, cards: st.secret.hands[pid], shown: st.secret.shown[pid] || [], round: st.round, gid: st.secret.gid });
  };

  // ---------- tour ----------
  P.beginTurn = function () {
    var st = this.st, p = st.players[st.turn];
    st.step = 'move'; st.refuter = null; st.last = st.last && st.last.keep ? st.last : st.last;
    st.deadline = st.settings.timer ? Date.now() + st.settings.timer * 1000 : 0;
    if (p) this.say('Tour de ' + p.name + '.', 't');
  };

  P.nextTurn = function () {
    var st = this.st, n = st.players.length, guard = 0;
    this.refreshOnline();
    do { st.turn = (st.turn + 1) % n; guard++; } while (st.players[st.turn].abandoned && guard <= n);
    st.round++;
    this.beginTurn();
  };

  P.isTurn = function (p) { return this.st.players[this.st.turn] === p; };
  P.pos = function (p) { return this.st.pawns[p.sid]; };

  P.move = function (p, room) {
    var st = this.st;
    if (!this.isTurn(p) || st.step !== 'move') return;
    room = +room;
    if (!(room >= 0 && room < 6)) return;
    var cur = this.pos(p);
    if (room !== cur && neighbors(cur).indexOf(room) < 0) return;
    if (room !== cur) {
      st.pawns[p.sid] = room;
      var vent = VENTS[cur] === room && room !== (cur + 1) % 6 && room !== (cur + 5) % 6;
      this.say(p.name + (vent ? ' file par les conduits : ' : ' se rend : ') + MODULES[room] + '.', 'm');
    } else this.say(p.name + ' reste en « ' + MODULES[room] + ' ».', 'm');
    st.step = 'suspect';
    this.publish();
  };

  P.suspect = function (p, s, w) {
    var st = this.st;
    if (!this.isTurn(p) || (st.step !== 'suspect' && st.step !== 'move')) return;
    s = +s; w = +w;
    if (!(s >= 0 && s < 6) || !(w >= 12 && w < 18)) return;
    var room = this.pos(p), mod = 6 + room;
    st.pawns[s] = room;                         // le suspect est téléporté sur place
    var text = p.name + ' soupçonne ' + SUSPECTS[s] + ' · ' + MODULES[room] + ' · ' + MEANS[w - 12] + '.';
    this.say(text, 's');
    st.last = { pid: p.pid, s: s, m: mod, w: w, by: null, none: false };
    // chaîne de réfutation : à gauche de celui qui demande
    var n = st.players.length, i, q, hand, hit;
    for (i = 1; i < n; i++) {
      q = st.players[(st.turn + i) % n];
      hand = st.secret.hands[q.pid] || [];
      hit = hand.filter(function (c) { return c === s || c === mod || c === w; });
      if (hit.length) {
        st.refuter = q.pid; st.last.by = q.pid; st.last.opts = hit;
        st.step = 'refute';
        st.deadline = st.settings.refuteTimer ? Date.now() + st.settings.refuteTimer * 1000 : 0;
        this.say(q.name + ' montre un indice à ' + p.name + '…', 'r');
        this.refreshOnline();
        return this.publish();
      }
    }
    st.last.none = true; st.refuter = null;
    this.say('Personne ne peut réfuter.', 'r');
    st.step = 'after';
    st.deadline = st.settings.timer ? Date.now() + st.settings.timer * 1000 : 0;
    this.publish();
  };

  P.refute = function (p, card) {
    var st = this.st;
    if (st.step !== 'refute' || st.refuter !== p.pid) return;
    card = +card;
    if (!st.last.opts || st.last.opts.indexOf(card) < 0) return;
    this.doShow(p, card, false);
  };

  P.doShow = function (p, card, auto) {
    var st = this.st, asker = st.last.pid;
    var sh = st.secret.shown;
    (sh[asker] = sh[asker] || []).push({ card: card, by: p.pid, byName: p.name, round: st.round });
    this.priv(asker, 'show', { card: card, by: p.pid, byName: p.name, round: st.round });
    this.say(p.name + ' a montré un indice à ' + this.nm(asker) + (auto ? ' (temps écoulé).' : '.'), 'r');
    delete st.last.opts;
    st.refuter = null; st.last.shownBy = p.pid;
    st.step = 'after';
    st.deadline = st.settings.timer ? Date.now() + st.settings.timer * 1000 : 0;
    this.publish();
  };

  P.endturn = function (p) {
    var st = this.st;
    if (!this.isTurn(p) || (st.step !== 'after' && st.step !== 'suspect' && st.step !== 'move')) return;
    this.nextTurn();
    this.publish();
  };

  P.accuse = function (p, s, m, w) {
    var st = this.st;
    if (!this.isTurn(p) || p.out) return;
    if (st.step !== 'move' && st.step !== 'suspect' && st.step !== 'after') return;
    s = +s; m = +m; w = +w;
    if (!(s >= 0 && s < 6) || !(m >= 6 && m < 12) || !(w >= 12 && w < 18)) return;
    var sol = st.secret.sol;
    var msg = p.name + ' accuse ' + SUSPECTS[s] + ' · ' + MODULES[m - 6] + ' · ' + MEANS[w - 12] + '.';
    this.say(msg, 'a');
    if (s === sol[0] && m === sol[1] && w === sol[2]) {
      st.winner = p.pid; st.reveal = sol.slice(); st.phase = 'over'; st.step = ''; st.deadline = 0;
      this.say(p.name + ' a trouvé : le réacteur est réparé !', 'w');
      return this.publish();
    }
    p.out = true;
    this.say('Accusation fausse : ' + p.name + ' ne peut plus accuser, mais continue d’enquêter.', 'a');
    var left = st.players.filter(function (x) { return !x.out; }).length;
    if (!left) {
      st.reveal = sol.slice(); st.phase = 'over'; st.step = ''; st.deadline = 0; st.winner = null;
      this.say('Plus personne ne peut accuser : la vérité est révélée.', 'w');
      return this.publish();
    }
    this.nextTurn();
    this.publish();
  };

  // ---------- horloge (appelée ~2 fois par seconde) ----------
  P.tick = function () {
    var st = this.st, n = Date.now(), changed = false, cur = st.players[st.turn];
    var before = JSON.stringify(st.players.map(function (p) { return [p.online, p.abandoned]; }));
    this.refreshOnline();
    if (JSON.stringify(st.players.map(function (p) { return [p.online, p.abandoned]; })) !== before) { this.captainFix(); changed = true; }
    if (st.phase === 'play' && cur) {
      if (st.step === 'refute') {
        var q = this.find(st.refuter);
        if (q && (!q.online || (st.deadline && n >= st.deadline))) {
          this.doShow(q, st.last.opts[rnd(st.last.opts.length)], true);
          return;
        }
      } else if (cur.abandoned || (st.deadline && n >= st.deadline)) {
        this.say(cur.abandoned ? cur.name + ' est absent : son tour est passé.' : 'Temps écoulé pour ' + cur.name + '.', 't');
        this.nextTurn();
        return this.publish();
      }
    }
    if (changed) this.publish();
  };

  var API = {
    SUSPECTS: SUSPECTS, MODULES: MODULES, MEANS: MEANS, VENTS: VENTS, NCARDS: NCARDS,
    cardName: cardName, cardKind: cardKind, neighbors: neighbors,
    newState: newState, publicView: publicView, Engine: Engine
  };
  root.MYEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : this);
