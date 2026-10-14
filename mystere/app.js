// Soirée Mystère — interface (télé + téléphones) et synchronisation Supabase. ES5 (télés anciennes).
(function () {
  'use strict';

  var SB_URL = 'https://qsyrrcrknxdkdsxkoooa.supabase.co';
  var SB_KEY = 'sb_publishable_whJtaOQEsL6Q1YqsxtLU5w_mLhX3Ocz';
  var E = window.MYEngine;
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var STALE_MS = 12 * 3600 * 1000;
  var SCOL = ['#3DD9EB', '#FFB454', '#B79CFF', '#FF7A93', '#7DE0A0', '#9FB6FF'];
  var PHOTO = ['badges/mathias.jpg', 'badges/david.jpg', 'badges/lea.jpg', 'badges/christelle.jpg', 'badges/android.jpg', 'badges/ia.jpg'];
  var STEPLBL = { move: 'Déplacement', suspect: 'Soupçon', refute: 'Réfutation', after: 'Fin de tour' };

  var app = document.getElementById('app');
  var netEl = document.getElementById('net');
  var sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function randIndex(n) {
    try {
      var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n;
      do { (window.crypto || window.msCrypto).getRandomValues(a); } while (a[0] >= lim);
      return a[0] % n;
    } catch (e) { return Math.floor(Math.random() * n); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function onAll(sel, ev, fn) {
    var els = app.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) (function (el) { el.addEventListener(ev, function (e) { fn(el, e); }); })(els[i]);
  }
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + two(s % 60); }
  function hhmm(t) { var d = new Date(t); return two(d.getHours()) + ':' + two(d.getMinutes()); }

  var me = lsGet('my_me');
  if (!me || !me.pid) { me = { pid: uid(), name: '', sid: -1 }; lsSet('my_me', me); }

  var C = {
    code: null, tv: false, engine: null, ch: null, ready: false, queue: [], S: null, endAt: 0,
    tab: 'tour', sel: null, selKey: '', accuse: null, helloTimer: null, silent: 0, gotFresh: false,
    hand: null, notes: null, lastTurnKey: '', ackAccuse: false, view: ''
  };

  // ---------- badges ----------
  function badge(sid, size, cls) {
    var c = SCOL[sid] || SCOL[0], st = 'width:' + size + 'px;height:' + size + 'px;--c:' + c;
    if (sid >= 0 && sid < 6) return '<img class="bd ' + (cls || '') + '" style="' + st + '" src="' + PHOTO[sid] + '" alt="' + esc(E.SUSPECTS[sid]) + '">';
    return '<span class="bdai ' + (cls || '') + '" style="' + st + ';font-size:' + Math.round(size * 0.34) + 'px">' + (sid === 4 ? 'AN' : 'IA') + '</span>';
  }
  function cardBadge(c, size) { return c < 6 ? badge(c, size) : ''; }
  function kindClass(c) { return E.cardKind(c); }
  function findP(pid) {
    var ps = (C.S && C.S.players) || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].pid === pid) return ps[i];
    return null;
  }
  function pName(pid) { var p = findP(pid); return p ? p.name : '?'; }
  function curPlayer() { return C.S && C.S.turn >= 0 ? C.S.players[C.S.turn] : null; }
  function myTurn() { var c = curPlayer(); return !!c && c.pid === me.pid; }

  // ---------- démarrage ----------
  function boot(t) { app.innerHTML = '<div class="boot">' + esc(t) + '</div>'; }
  function showError(t) {
    document.body.className = 'phone';
    app.innerHTML = '<div class="ph"><h1>SOIRÉE MYSTÈRE</h1><div class="grow"></div><div class="alert"><h2>Oups</h2>' + esc(t) +
      '</div><div class="grow"></div><button class="btn" id="home">Retour</button></div>';
    on('home', 'click', function () { lsDel('my_sess'); location.href = location.pathname; });
  }

  function fetchRoom(code) { return sb.from('rooms').select('state, updated_at').eq('code', code).maybeSingle(); }
  function isMine(row) { return row && row.state && row.state.game === 'mystere'; }

  function init() {
    var params = new URLSearchParams(location.search);
    var r = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '');
    var sess = lsGet('my_sess');
    if (params.has('tv')) {
      if (sess && sess.tv) return resume(sess, function () { createRoom(); });
      return createRoom();
    }
    if (r.length === 4) {
      if (sess && sess.code === r && !sess.tv) return resume(sess, function () { openJoin(r); });
      return openJoin(r);
    }
    if (sess && !sess.tv) return resume(sess, showHome);
    showHome();
  }

  function resume(sess, fallback) {
    boot('Reconnexion…');
    fetchRoom(sess.code).then(function (r) {
      var row = r.data;
      if (r.error || !isMine(row) || Date.now() - Date.parse(row.updated_at) > STALE_MS || row.state.phase === 'closed') {
        lsDel('my_sess'); return fallback();
      }
      start(sess, row.state);
    });
  }

  function openJoin(code) {
    boot('Recherche de la partie…');
    fetchRoom(code).then(function (r) {
      if (r.error || !isMine(r.data) || Date.now() - Date.parse(r.data.updated_at) > STALE_MS || r.data.state.phase === 'closed')
        return showError('Partie « ' + code + ' » introuvable. Vérifie le code.');
      start({ code: code, tv: false, engine: false }, r.data.state);
    });
  }

  function createRoom() {
    boot('Création de la partie…');
    var tries = 0;
    (function attempt() {
      var code = '';
      for (var i = 0; i < 4; i++) code += CODE_CHARS.charAt(randIndex(CODE_CHARS.length));
      var st = E.newState(code);
      sb.from('rooms').insert({ code: code, state: st }).then(function (r) {
        if (r.error) { if (++tries < 15) return attempt(); return showError('Impossible de créer la partie (' + r.error.message + ').'); }
        var sess = { code: code, tv: true, engine: true };
        lsSet('my_sess', sess);
        start(sess, st);
      });
    })();
  }

  function start(sess, state) {
    C.code = sess.code; C.tv = !!sess.tv;
    document.body.className = C.tv ? 'tv' : 'phone';
    if (C.tv) { sizeTv(); window.addEventListener('resize', sizeTv); }
    try { history.replaceState(null, '', C.tv ? '?tv' : '?r=' + sess.code); } catch (e) {}
    loadLocal(state);
    if (sess.engine) C.engine = makeEngine(sess.code, state);
    connect();
    if (C.engine) C.engine.publish();
    else if (state) onState({ s: E.publicView(state), rem: state.deadline ? Math.max(0, state.deadline - Date.now()) : 0 });
  }

  // ---------- moteur local (télé, ou téléphone du capitaine en reprise) ----------
  function makeEngine(code, state) {
    var persistT = null;
    var eng = new E.Engine({
      code: code, state: state,
      broadcast: function (view, rem) { chSend('s', { s: view, rem: rem }); onState({ s: view, rem: rem }); },
      persist: function (st) {
        clearTimeout(persistT);
        persistT = setTimeout(function () {
          sb.from('rooms').upsert({ code: code, state: st, updated_at: new Date().toISOString() }).then(function (r) { if (r.error) console.warn('persist', r.error); });
        }, 250);
      },
      priv: function (pid, ev, payload) {
        if (!C.tv && pid === me.pid) return onPriv({ to: pid, ev: ev, p: payload });
        chSend('priv', { to: pid, ev: ev, p: payload });
      }
    });
    if (!C.engineTimer) {
      C.engineTimer = setInterval(function () { if (C.engine) C.engine.tick(); }, 500);
      setInterval(function () { if (C.engine) C.engine.publish(); }, 10000);
    }
    return eng;
  }

  // ---------- temps réel ----------
  function connect() {
    if (C.ch) { try { sb.removeChannel(C.ch); } catch (e) {} }
    C.ready = false;
    var ch = sb.channel('my-' + C.code, { config: { broadcast: { self: false } } });
    C.ch = ch;
    if (C.engine) ch.on('broadcast', { event: 'p' }, function (m) { C.engine.handle(m.payload); });
    else ch.on('broadcast', { event: 's' }, function (m) { onState(m.payload); });
    ch.on('broadcast', { event: 'priv' }, function (m) { if (m.payload && m.payload.to === me.pid) onPriv(m.payload); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        C.ready = true; netEl.hidden = true;
        while (C.queue.length) ch.send({ type: 'broadcast', event: 'p', payload: C.queue.shift() });
        if (C.engine) C.engine.publish();
        else hello();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        C.ready = false;
        if (C.ch !== ch) return;
        netEl.textContent = 'Connexion perdue… reconnexion en cours';
        netEl.hidden = false;
      }
    });
  }
  function chSend(ev, payload) {
    if (!C.ch) return;
    if (!C.ready) { if (ev === 'p') C.queue.push(payload); return; }
    C.ch.send({ type: 'broadcast', event: ev, payload: payload });
  }
  function send(msg) {
    msg.pid = me.pid;
    if (C.engine) C.engine.handle(msg); else chSend('p', msg);
  }
  function cmd(c, extra) { var m = { t: 'cmd', c: c }; for (var k in extra) m[k] = extra[k]; if (C.tv) { m.pid = ''; C.engine.handle(m); } else send(m); }

  function hello() {
    C.gotFresh = false; send({ t: 'hello' });
    clearInterval(C.helloTimer); C.silent = 0;
    C.helloTimer = setInterval(function () {
      if (C.gotFresh) { clearInterval(C.helloTimer); return; }
      send({ t: 'hello' });
      if (++C.silent >= 3) {
        netEl.innerHTML = 'L\'hôte ne répond pas. <button type="button" class="netbtn" id="takeover">Reprendre la partie ici</button>';
        netEl.hidden = false;
        var b = $('takeover'); if (b) b.onclick = takeOver;
      }
    }, 3000);
  }

  // Le téléphone devient l'hôte quand la télé est perdue (état relu depuis la base).
  function takeOver() {
    netEl.textContent = 'Reprise de la partie…';
    fetchRoom(C.code).then(function (r) {
      if (r.error || !isMine(r.data)) { netEl.textContent = 'Impossible de reprendre la partie.'; return; }
      var st = r.data.state;
      C.engine = makeEngine(C.code, st);
      var sess = lsGet('my_sess') || { code: C.code, tv: false };
      sess.engine = true; lsSet('my_sess', sess);
      connect();
      netEl.hidden = true;
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !C.code) return;
    keepAwake();
    if (C.engine) C.engine.publish(); else if (C.ready) hello();
  });
  setInterval(function () { if (C.code && C.S && !C.tv && findP(me.pid) && C.S.phase !== 'closed') send({ t: 'ping' }); }, 8000);
  var lock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || (lock && !lock.released)) return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
  }
  document.addEventListener('pointerdown', keepAwake);

  // ---------- état local privé (main, indices, carnet) ----------
  function loadLocal(state) {
    var h = lsGet('my_hand');
    if (h && h.code === C.code) C.hand = h; else C.hand = null;
    var n = lsGet('my_notes');
    C.notes = n && n.code === C.code ? n : { code: C.code, gid: '', marks: {} };
  }
  function onPriv(m) {
    var p = m.p || {};
    if (m.ev === 'hand') {
      var prev = C.hand;
      var gid = p.gid || '';
      C.hand = { code: p.code, gid: gid, cards: p.cards || [], shown: p.shown || [] };
      if (!C.notes || C.notes.gid !== gid) C.notes = { code: p.code, gid: gid, marks: {} };
      lsSet('my_hand', C.hand); lsSet('my_notes', C.notes);
      if (!prev || prev.gid !== gid) buzz(60);
      C.view = ''; render();
    } else if (m.ev === 'show') {
      if (!C.hand) return;
      var dup = false;
      for (var i = 0; i < C.hand.shown.length; i++) if (C.hand.shown[i].card === p.card && C.hand.shown[i].by === p.by) dup = true;
      if (!dup) C.hand.shown.push({ card: p.card, by: p.by, byName: p.byName, round: p.round });
      lsSet('my_hand', C.hand);
      C.tab = 'carnet'; C.flash = p;
      buzz([80, 60, 80]); C.view = ''; render();
    } else if (m.ev === 'err') {
      alertMsg(p.msg);
    }
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function alertMsg(t) { var o = document.createElement('div'); o.className = 'net'; o.textContent = t; document.body.appendChild(o); setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 3500); }
  function saveNotes() { lsSet('my_notes', C.notes); }

  // ---------- réception de l'état public ----------
  function onState(p) {
    if (!p || !p.s) return;
    var S = p.s, prev = C.S;
    C.S = S;
    C.endAt = Date.now() + (p.rem || 0);
    C.gotFresh = true; C.silent = 0;
    if (C.ready) netEl.hidden = true;
    if (S.phase === 'closed' && !C.engine) return showClosed(S.closedBy);
    // alertes téléphone
    if (!C.tv && prev) {
      var turnKey = S.phase + ':' + S.round + ':' + S.turn;
      if (S.phase === 'play' && S.step === 'refute' && S.refuter === me.pid && !(prev.step === 'refute' && prev.refuter === me.pid)) buzz([200, 100, 200]);
      if (S.phase === 'play' && myTurn() && !(prev.phase === 'play' && prev.turn === S.turn && prev.round === S.round)) { buzz(250); C.tab = 'tour'; C.sel = null; C.accuse = null; }
    }
    render();
  }

  function showClosed(by) {
    document.body.className = 'phone';
    lsDel('my_sess'); clearInterval(C.helloTimer);
    app.innerHTML = '<div class="ph"><h1>SOIRÉE MYSTÈRE</h1><div class="grow"></div><div class="panel" style="text-align:center">La partie est terminée' +
      (by ? ' (arrêtée par ' + esc(by) + ')' : '') + '.</div><div class="grow"></div><button class="btn" id="home">Accueil</button></div>';
    on('home', 'click', function () { location.href = location.pathname; });
  }

  // ---------- rendu ----------
  function render() {
    if (!C.S) return;
    if (C.tv) { renderTv(); } else { renderPhone(); }
  }

  // ================= TÉLÉPHONE =================
  function showHome() {
    document.body.className = 'phone';
    var url = location.search.indexOf('tv') >= 0;
    app.innerHTML = '<div class="ph"><h1>SOIRÉE MYSTÈRE</h1><div class="sub">Le réacteur a été saboté. Qui ? Où ? Avec quoi ?</div>' +
      '<div class="lbl">Code de la partie</div><input class="inp code" id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD">' +
      '<button class="btn" id="go">REJOINDRE</button><div class="grow"></div>' +
      '<div class="lbl" style="text-align:center">Sur la télé</div><a class="btn ghost" style="text-align:center;text-decoration:none" href="?tv">Créer une partie (écran télé)</a></div>';
    var inp = $('code');
    inp.addEventListener('input', function () { inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    on('go', 'click', function () { if (inp.value.length === 4) openJoin(inp.value); });
    inp.addEventListener('keydown', function (e) { if (e.keyCode === 13 && inp.value.length === 4) openJoin(inp.value); });
  }

  function renderPhone() {
    var S = C.S, p = findP(me.pid);
    if (!p) return phoneJoin();
    if (S.phase === 'lobby') return phoneLobby();
    if (S.phase === 'over') return phoneOver();
    phonePlay();
  }

  function takenSids() { var o = {}; (C.S.players || []).forEach(function (p) { o[p.sid] = p.pid; }); return o; }

  function bpickHtml(selSid, mineSid) {
    var tk = takenSids(), h = '<div class="bpick">';
    for (var i = 0; i < 6; i++) {
      var taken = tk[i] !== undefined && tk[i] !== me.pid;
      h += '<button data-sid="' + i + '" class="' + (selSid === i ? 'sel ' : '') + (taken ? 'tk' : '') + '" style="--c:' + SCOL[i] + '"' + (taken ? ' disabled' : '') + '><span class="it">' +
        badge(i, 64) + '<span class="n">' + esc(E.SUSPECTS[i]) + '</span></span></button>';
    }
    return h + '</div>';
  }

  function phoneJoin() {
    if (C.view === 'join') return;
    C.view = 'join';
    var sel = me.sid >= 0 && !takenSids()[me.sid] ? me.sid : -1;
    if (sel < 0) { for (var i = 0; i < 6; i++) if (takenSids()[i] === undefined) { sel = i; break; } }
    app.innerHTML = '<div class="ph"><h1>SOIRÉE MYSTÈRE</h1><div class="sub">Partie ' + esc(C.code) + '</div>' +
      '<div class="lbl">Ton prénom</div><input class="inp" id="nm" maxlength="14" value="' + esc(me.name) + '" placeholder="Prénom">' +
      '<div class="lbl">Ton badge</div><div id="bp">' + bpickHtml(sel) + '</div>' +
      '<div class="grow"></div><button class="btn" id="join">MONTER À BORD</button><button class="btn ghost" id="back">Retour</button></div>';
    var cur = sel;
    function bind() { onAll('#bp button', 'click', function (b) { cur = +b.getAttribute('data-sid'); $('bp').innerHTML = bpickHtml(cur); bind(); }); }
    bind();
    on('join', 'click', function () {
      var nm = $('nm').value.replace(/\s+/g, ' ').trim();
      if (!nm) { $('nm').focus(); return; }
      me.name = nm; me.sid = cur; lsSet('my_me', me);
      if (C.S.phase !== 'lobby') { alertMsg('La partie a déjà commencé.'); return; }
      var sess = lsGet('my_sess') || { code: C.code, tv: false, engine: false };
      sess.code = C.code; sess.tv = false; lsSet('my_sess', sess);
      send({ t: 'join', name: nm, sid: cur });
    });
    on('back', 'click', function () { lsDel('my_sess'); location.href = location.pathname; });
  }

  function phoneHeader(p) {
    return '<div class="hdr">' + badge(p.sid, 44) + '<div class="who">' + esc(p.name) + '</div><div class="rc">' + esc(C.code) + '</div></div>';
  }
  function crewHtml(S) {
    var h = '<div class="crew">';
    S.players.forEach(function (q) {
      h += '<div class="ch' + (q.online ? '' : ' off') + (q.out ? ' out' : '') + '">' + badge(q.sid, 30) + esc(q.name) + (q.pid === S.captain ? ' ★' : '') + '</div>';
    });
    return h + '</div>';
  }

  function phoneLobby() {
    var S = C.S, p = findP(me.pid), cap = S.captain === me.pid;
    C.view = 'lobby:' + S.players.length;
    var h = '<div class="ph">' + phoneHeader(p) + '<div class="lbl">Équipage (' + S.players.length + '/6)</div>' + crewHtml(S) +
      '<div class="lbl">Change de badge</div><div id="bp">' + bpickHtml(p.sid) + '</div><div class="grow"></div>';
    if (cap) {
      h += '<div class="panel"><div class="lbl" style="margin-top:0">Chrono du tour</div><div class="row">' +
        [0, 30, 45, 60, 90].map(function (t) { return '<button class="btn ghost tm" data-t="' + t + '" style="margin:2px;padding:8px 4px;' + (S.settings.timer === t ? 'border-color:var(--amber);color:var(--amber)' : '') + '">' + (t ? t + ' s' : 'Sans') + '</button>'; }).join('') +
        '</div></div>' +
        '<button class="btn amber" id="start"' + (S.players.length < 3 ? ' disabled' : '') + '>LANCER L\'ENQUÊTE</button>' +
        (S.players.length < 3 ? '<div class="sub" style="margin:6px 0 0">Il faut au moins 3 joueurs.</div>' : '');
    } else h += '<div class="sub">En attente du capitaine ★ ' + esc(pName(S.captain)) + '…</div>';
    h += '<button class="btn ghost" id="quit">Quitter</button></div>';
    app.innerHTML = h;
    onAll('#bp button', 'click', function (b) { var sid = +b.getAttribute('data-sid'); me.sid = sid; lsSet('my_me', me); send({ t: 'badge', sid: sid }); });
    onAll('.tm', 'click', function (b) { var t = +b.getAttribute('data-t'); send({ t: 'cmd', c: 'settings', timer: t, refuteTimer: t ? Math.max(20, Math.min(40, t - 15)) : 0 }); });
    on('start', 'click', function () { send({ t: 'cmd', c: 'start' }); });
    on('quit', 'click', function () { send({ t: 'leave' }); lsDel('my_sess'); lsDel('my_hand'); setTimeout(function () { location.href = location.pathname; }, 300); });
  }

  function navHtml(S) {
    var needMe = myTurn() || (S.step === 'refute' && S.refuter === me.pid);
    function b(k, l, dot) { return '<button data-tab="' + k + '" class="' + (C.tab === k ? 'on' : '') + '">' + l + (dot ? '<i class="dot"></i>' : '') + '</button>'; }
    return '<div class="nav">' + b('carnet', 'CARNET', C.flash) + b('tour', 'MON TOUR', needMe && C.tab !== 'tour') + b('journal', 'JOURNAL', false) + '</div>';
  }

  function phonePlay() {
    var S = C.S, p = findP(me.pid), body;
    if (S.step === 'refute' && S.refuter === me.pid) C.tab = 'tour';
    if (C.tab === 'carnet') body = viewCarnet(S, p);
    else if (C.tab === 'journal') body = viewJournal(S);
    else body = viewTour(S, p);
    app.innerHTML = '<div class="ph" id="scr">' + phoneHeader(p) + body + '</div>' + navHtml(S);
    bindPlay(S, p);
    var t = $('tmr'); if (t) tickTimers();
  }

  function marksOf(c) {
    var auto = null, note = '';
    if (C.hand && C.hand.cards.indexOf(c) >= 0) { auto = 'x'; note = 'MAIN'; }
    else if (C.hand) {
      for (var i = 0; i < C.hand.shown.length; i++) if (C.hand.shown[i].card === c) { auto = 'x'; note = 'MONTRÉ PAR ' + String(C.hand.shown[i].byName || '').toUpperCase(); }
    }
    return { auto: auto, note: note, m: auto || (C.notes && C.notes.marks[c]) || '' };
  }
  var MK = { '': '', x: '✕', q: '?', o: '◎' };

  function viewCarnet(S, p) {
    var h = '', i;
    if (myTurn() || (S.step === 'refute' && S.refuter === me.pid)) h += '<button class="btn amber" style="margin:0 0 10px" data-tab="tour">' + (S.step === 'refute' && S.refuter === me.pid ? 'ON T\'INTERROGE → RÉPONDRE' : 'C\'EST TOUJOURS TON TOUR → CONTINUER') + '</button>';
    h += '<div class="lbl" style="margin-top:0">Ma main</div><div class="hand">';
    ((C.hand && C.hand.cards) || []).forEach(function (c) { h += '<div class="hc ' + kindClass(c) + '">' + esc(E.cardName(c)) + '</div>'; });
    h += '</div>';
    if (C.flash) {
      h += '<div class="alert" style="margin-bottom:8px;border-color:var(--green);background:rgba(125,224,160,.08)"><div class="lbl" style="margin:0;color:var(--green)">Indice reçu de ' + esc(C.flash.byName) + '</div><div class="big">' + esc(E.cardName(C.flash.card)) + '</div></div>';
      C.flash = null;
    }
    h += '<div class="nbk">';
    var groups = [['QUI ?', 0, 6], ['OÙ ?', 6, 12], ['AVEC QUOI ?', 12, 18]];
    groups.forEach(function (g) {
      h += '<div class="grp">' + g[0] + '</div>';
      for (i = g[1]; i < g[2]; i++) {
        var mk = marksOf(i);
        h += '<div class="nr">' + (i < 6 ? badge(i, 36) : '<span style="width:46px"></span>') + '<div class="nm">' + esc(E.cardName(i)) + '</div>' +
          (mk.note ? '<div class="nt">' + esc(mk.note) + '</div>' : '') +
          '<button class="mk ' + mk.m + (mk.auto ? ' lock' : '') + '" data-card="' + i + '"' + (mk.auto ? ' disabled' : '') + '>' + MK[mk.m] + '</button></div>';
      }
    });
    return h + '</div><div class="sub" style="margin-top:12px">Touche la case pour noter ✕ éliminé · ? piste · ◎ suspect fort. Ta main et les indices reçus se remplissent tout seuls.</div>';
  }

  function viewJournal(S) {
    var h = '<div class="lbl" style="margin-top:0">Journal de bord</div><div class="logl">';
    S.log.slice().reverse().forEach(function (l) { h += '<div class="' + l.k + '"><small>' + hhmm(l.at) + '</small>' + esc(l.t) + '</div>'; });
    return h + '</div>';
  }

  function rollHtml(tag, key, items, idx, locked) {
    var it = items[idx], c = it.c || 'var(--line)';
    return '<div class="col"><div class="tag">' + tag + '</div><button class="arrow" data-roll="' + key + '" data-d="-1"' + (locked ? ' disabled' : '') + '>▲</button>' +
      '<div class="win" style="--c:' + c + '">' + (it.badge || '') + '<span style="margin-top:6px">' + esc(it.n) + '</span>' + (locked ? '<small class="mono" style="color:var(--dim)">VERROUILLÉ</small>' : '') + '</div>' +
      '<button class="arrow" data-roll="' + key + '" data-d="1"' + (locked ? ' disabled' : '') + '>▼</button></div>';
  }
  function whoItems() { var a = []; for (var i = 0; i < 6; i++) a.push({ n: E.SUSPECTS[i], c: SCOL[i], badge: badge(i, 46) }); return a; }
  function whereItems() { var a = []; for (var i = 0; i < 6; i++) a.push({ n: E.MODULES[i], c: 'var(--amber)' }); return a; }
  function whatItems() { var a = []; for (var i = 0; i < 6; i++) a.push({ n: E.MEANS[i], c: 'var(--violet)' }); return a; }

  function lastLine(S) {
    var L = S.last; if (!L) return '';
    return '<div class="panel" style="margin-top:10px"><div class="lbl" style="margin-top:0">Dernier soupçon · ' + esc(pName(L.pid)) + '</div><div class="trio">' +
      '<span class="who">' + esc(E.SUSPECTS[L.s]) + '</span><span class="where">' + esc(E.cardName(L.m)) + '</span><span class="what">' + esc(E.cardName(L.w)) + '</span></div>' +
      '<div style="margin-top:6px;font-size:14px;color:var(--dim)">' + (L.none ? 'Personne ne peut réfuter.' : L.by && S.step === 'refute' ? esc(pName(L.by)) + ' réfléchit…' : L.shownBy ? esc(pName(L.shownBy)) + ' a montré un indice.' : '') + '</div></div>';
  }

  function timerHtml(S) { return S.deadline ? '<span class="timer" id="tmr">' + clock(C.endAt - Date.now()) + '</span>' : ''; }

  function viewTour(S, p) {
    var cur = curPlayer(), h = '', i;
    // réfuter ?
    if (S.step === 'refute' && S.refuter === me.pid) {
      var L = S.last, opts = [];
      [L.s, L.m, L.w].forEach(function (c) { if (C.hand && C.hand.cards.indexOf(c) >= 0) opts.push(c); });
      h += '<div class="alert"><h2>ON T\'INTERROGE !</h2>' + esc(pName(L.pid)) + ' soupçonne</div>' +
        '<div class="trio" style="margin-top:10px"><span class="who">' + esc(E.SUSPECTS[L.s]) + '</span><span class="where">' + esc(E.cardName(L.m)) + '</span><span class="what">' + esc(E.cardName(L.w)) + '</span></div>' +
        '<div style="margin-top:10px">Tu as ' + opts.length + ' carte' + (opts.length > 1 ? 's' : '') + ' qui correspond' + (opts.length > 1 ? 'ent' : '') + '. Touche celle que tu veux montrer : ' + esc(pName(L.pid)) + ' sera le seul à la voir.</div>' +
        '<div class="rcards">' + opts.map(function (c) { return '<button data-ref="' + c + '" class="' + kindClass(c) + '"><small>' + (c < 6 ? 'QUI' : c < 12 ? 'OÙ' : 'QUOI') + '</small>' + esc(E.cardName(c)) + '</button>'; }).join('') + '</div>' +
        '<div style="text-align:center;margin-top:8px">' + timerHtml(S) + '</div><div class="sub" style="margin-top:8px">Les autres verront seulement « indice montré ». À 0:00, une carte est montrée toute seule.</div>';
      return h;
    }
    if (!myTurn() || S.step === 'refute') {
      h += '<div class="panel"><div class="lbl" style="margin-top:0">En ce moment</div><div class="row">' + badge(cur.sid, 56) + '<div style="margin-left:12px"><div class="big">' + esc(cur.name) + '</div>' +
        '<div style="color:var(--amber);font-size:15px">' + (STEPLBL[S.step] || '') + (S.step === 'refute' ? ' · ' + esc(pName(S.refuter)) : '') + '</div></div><div class="grow"></div>' + timerHtml(S) + '</div></div>' + lastLine(S);
      h += '<div class="sub" style="margin-top:14px">' + (myTurn() ? 'Ton soupçon est en cours de vérification…' : 'Ce n\'est pas ton tour. Garde un œil sur ton carnet !') + '</div>';
      if (p.out) h += '<div class="sub">Tu as accusé à tort : tu continues d\'enquêter et de réfuter.</div>';
      return h;
    }
    // mon tour
    var key = S.round + ':' + S.step;
    if (C.selKey !== S.round + '') { C.selKey = S.round + ''; C.sel = { s: p.sid, w: 12, aS: 0, aM: 6, aW: 12 }; C.accuse = null; }
    var step = S.step, room = S.pawns[p.sid];
    h += '<div class="row" style="margin-bottom:8px"><div class="big" style="margin-right:10px">À TOI DE JOUER</div><div class="grow"></div>' + timerHtml(S) + '</div>';
    h += '<div class="steps"><span class="' + (step === 'move' ? 'on' : 'ok') + '">1 · DÉPLACER' + (step !== 'move' ? ' ✓' : '') + '</span><span class="' + (step === 'suspect' ? 'on' : step === 'after' ? 'ok' : '') + '">2 · SOUPÇONNER' + (step === 'after' ? ' ✓' : '') + '</span><span class="' + (step === 'after' ? 'on' : '') + '">3 · ACCUSER</span></div>';
    if (C.accuse) return h + accuseHtml(S, p);
    if (step === 'move') {
      var nb = E.neighbors(room);
      h += '<div class="rooms6">';
      for (i = 0; i < 6; i++) {
        var ok = i === room || nb.indexOf(i) >= 0, vent = E.VENTS[room] === i && i !== (room + 1) % 6 && i !== (room + 5) % 6;
        h += '<button data-room="' + i + '" class="' + (i === room ? 'here' : ok ? 'ok' : '') + '"' + (ok ? '' : ' disabled') + '><span class="it">' + esc(E.MODULES[i]) + '<small>' + (i === room ? 'ICI · RESTER' : vent ? 'PAR LES CONDUITS' : ok ? 'ACCÈS DIRECT' : 'TROP LOIN') + '</small></span></button>';
      }
      h += '</div><button class="btn ghost" id="accuseBtn"' + (p.out ? ' disabled' : '') + '>Accuser… (une seule fois par partie)</button>';
      return h;
    }
    if (step === 'suspect') {
      var sel = C.sel;
      h += '<div class="roll">' + rollHtml('QUI', 'who', whoItems(), sel.s, false) + rollHtml('OÙ', 'where', [{ n: E.MODULES[room], c: 'var(--amber)' }], 0, true) + rollHtml('QUOI', 'what', whatItems(), sel.w - 12, false) + '</div>';
      h += '<div class="panel" style="margin-top:10px;font-size:16px">Je soupçonne <b>' + esc(E.SUSPECTS[sel.s]) + '</b>, en <b>' + esc(E.MODULES[room]) + '</b>, avec <b>' + esc(E.MEANS[sel.w - 12]) + '</b>.</div>';
      h += '<button class="btn amber" id="doSuspect">JE SOUPÇONNE !</button><button class="btn ghost" id="accuseBtn"' + (p.out ? ' disabled' : '') + '>Accuser… (une seule fois par partie)</button><button class="btn ghost" id="endTurn">Passer mon tour</button>';
      return h;
    }
    // after
    h += lastLine(S);
    h += '<div class="sub" style="margin-top:12px">Tu peux accuser maintenant, ou terminer ton tour.</div><button class="btn" id="endTurn">FIN DE TOUR</button><button class="btn ghost" id="accuseBtn"' + (p.out ? ' disabled' : '') + '>Accuser… (une seule fois par partie)</button>';
    return h;
  }

  function accuseHtml(S, p) {
    var a = C.sel;
    var h = '<div class="alert" style="margin-bottom:10px"><h2>ACCUSATION</h2>Si tu te trompes, tu ne pourras plus accuser.</div>' +
      '<div class="roll">' + rollHtml('QUI', 'aS', whoItems(), a.aS, false) + rollHtml('OÙ', 'aM', whereItems(), a.aM - 6, false) + rollHtml('QUOI', 'aW', whatItems(), a.aW - 12, false) + '</div>' +
      '<div class="panel" style="margin-top:10px">J\'accuse <b>' + esc(E.SUSPECTS[a.aS]) + '</b>, en <b>' + esc(E.MODULES[a.aM - 6]) + '</b>, avec <b>' + esc(E.MEANS[a.aW - 12]) + '</b>.</div>';
    if (C.accuse === 2) h += '<button class="btn rose" id="accuseGo">OUI, J\'ACCUSE !</button>';
    else h += '<button class="btn rose" id="accuseOk">ACCUSER</button>';
    return h + '<button class="btn ghost" id="accuseNo">Annuler</button>';
  }

  function bindPlay(S, p) {
    onAll('[data-tab]', 'click', function (b) { C.tab = b.getAttribute('data-tab'); render(); });
    onAll('.mk', 'click', function (b) {
      var c = +b.getAttribute('data-card'), cur = C.notes.marks[c] || '', order = ['', 'x', 'q', 'o'];
      C.notes.marks[c] = order[(order.indexOf(cur) + 1) % 4]; saveNotes(); render();
    });
    onAll('[data-ref]', 'click', function (b) { send({ t: 'refute', card: +b.getAttribute('data-ref') }); });
    onAll('[data-room]', 'click', function (b) { send({ t: 'move', room: +b.getAttribute('data-room') }); });
    onAll('[data-roll]', 'click', function (b) {
      var k = b.getAttribute('data-roll'), d = +b.getAttribute('data-d'), a = C.sel;
      if (k === 'who') a.s = (a.s + d + 6) % 6;
      if (k === 'what') a.w = 12 + (a.w - 12 + d + 6) % 6;
      if (k === 'aS') a.aS = (a.aS + d + 6) % 6;
      if (k === 'aM') a.aM = 6 + (a.aM - 6 + d + 6) % 6;
      if (k === 'aW') a.aW = 12 + (a.aW - 12 + d + 6) % 6;
      C.accuse = C.accuse ? 1 : C.accuse; render();
    });
    on('doSuspect', 'click', function () { send({ t: 'suspect', s: C.sel.s, w: C.sel.w }); });
    on('endTurn', 'click', function () { send({ t: 'endturn' }); });
    on('accuseBtn', 'click', function () { C.accuse = 1; render(); });
    on('accuseNo', 'click', function () { C.accuse = null; render(); });
    on('accuseOk', 'click', function () { C.accuse = 2; render(); });
    on('accuseGo', 'click', function () { var a = C.sel; C.accuse = null; send({ t: 'accuse', s: a.aS, m: a.aM, w: a.aW }); });
  }

  function phoneOver() {
    var S = C.S, p = findP(me.pid), cap = S.captain === me.pid, win = S.winner;
    var r = S.reveal || [0, 6, 12];
    C.view = 'over';
    app.innerHTML = '<div class="ph">' + phoneHeader(p) + '<div class="alert" style="border-color:var(--green);background:rgba(125,224,160,.08)"><h2 style="color:var(--green)">' +
      (win ? (win === me.pid ? 'BRAVO, TU AS RÉSOLU L\'ENQUÊTE !' : esc(pName(win)) + ' A RÉSOLU L\'ENQUÊTE !') : 'ENQUÊTE NON RÉSOLUE') + '</h2>' +
      (win ? 'Le réacteur est réparé.' : 'Personne n\'a trouvé la solution.') + '</div>' +
      '<div class="lbl">La solution</div><div class="trio"><span class="who">' + esc(E.SUSPECTS[r[0]]) + '</span><span class="where">' + esc(E.cardName(r[1])) + '</span><span class="what">' + esc(E.cardName(r[2])) + '</span></div>' +
      '<div class="lbl">Journal</div><div class="logl">' + S.log.slice(-8).reverse().map(function (l) { return '<div class="' + l.k + '">' + esc(l.t) + '</div>'; }).join('') + '</div>' +
      '<div class="grow"></div>' + (cap ? '<button class="btn amber" id="again">REJOUER</button><button class="btn ghost" id="stop">Arrêter la partie</button>' : '<div class="sub">Le capitaine peut relancer une partie.</div>') + '</div>';
    on('again', 'click', function () { send({ t: 'cmd', c: 'lobby' }); });
    on('stop', 'click', function () { send({ t: 'cmd', c: 'close' }); });
  }

  setInterval(tickTimers, 500);
  function tickTimers() {
    if (!C.S || !C.S.deadline) return;
    var left = C.endAt - Date.now(), els = document.querySelectorAll('#tmr,#tvtmr');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = clock(left);
      var low = left < 10000;
      if (els[i].className.indexOf('low') >= 0 !== low) els[i].className = els[i].className.replace(' low', '') + (low ? ' low' : '');
    }
  }

  // ================= TÉLÉ =================
  function sizeTv() {
    var k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    var st = document.getElementById('stage');
    C.tvScale = k;
    if (st) { st.style.webkitTransform = st.style.transform = 'scale(' + k + ')'; }
  }
  var RPOS = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
  function roomXY(i) { return { x: 28 + RPOS[i][0] * 280, y: 100 + RPOS[i][1] * 310 }; }

  function renderTv() {
    var S = C.S, h;
    if (S.phase === 'lobby') h = tvLobby(S);
    else if (S.phase === 'over') h = tvOver(S);
    else h = tvPlay(S);
    app.innerHTML = '<div class="stage" id="stage">' + h + '</div>';
    sizeTv();
    on('tvStart', 'click', function () { cmd('start'); });
    on('tvAgain', 'click', function () { cmd('lobby'); });
    var b = $('tvStart') || $('tvAgain'); if (b) { try { b.focus(); } catch (e) {} }
  }
  document.addEventListener('keydown', function (e) {
    if (!C.tv || !C.S) return;
    if (e.keyCode === 13) { var b = $('tvStart') || $('tvAgain'); if (b) b.click(); }
  });

  function tvHeader(S, act) {
    var h = '<div class="tvh"><div class="wm">SOIRÉE <i>MYSTÈRE</i></div><div class="crewbar">';
    S.players.forEach(function (q) {
      h += '<div class="ch' + (act && act.pid === q.pid ? ' act' : '') + (q.online ? '' : ' off') + (q.out ? ' out' : '') + '">' + badge(q.sid, 36) + esc(q.name) + '</div>';
    });
    return h + '</div><div class="rc">' + esc(C.code) + '</div></div>';
  }

  function joinUrl() { return location.origin + location.pathname.replace(/[^\/]*$/, '') + '?r=' + C.code; }
  function qrSvg(text) {
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  function tvLobby(S) {
    var h = tvHeader(S, null);
    h += '<div class="tvbig" style="top:100px"><div style="font-size:22px;color:var(--dim);letter-spacing:.1em">Le réacteur a été saboté. Qui ? Où ? Avec quoi ?</div></div>';
    h += '<div style="position:absolute;left:60px;top:170px;width:300px;text-align:center"><div style="background:#fff;padding:14px;border-radius:10px;width:260px;height:260px;margin:0 auto">' + qrSvg(joinUrl()).replace('<svg', '<svg style="width:232px;height:232px"') + '</div>' +
      '<div class="mono" style="margin-top:14px;font-size:14px;color:var(--dim);letter-spacing:.08em">SCANNE OU SAISIS LE CODE</div><div class="mono" style="font-size:64px;font-weight:700;letter-spacing:.2em;color:var(--cyan)">' + esc(C.code) + '</div></div>';
    for (var i = 0; i < 6; i++) {
      var q = S.players[i], x = 420 + (i % 3) * 210, y = 170 + Math.floor(i / 3) * 170;
      h += '<div class="slot' + (q ? '' : ' empty') + '" style="left:' + x + 'px;top:' + y + 'px;' + (q ? 'border-color:' + SCOL[q.sid] : '') + '">' +
        (q ? badge(q.sid, 78) + esc(q.name) + '<small>' + esc(E.SUSPECTS[q.sid]) + (q.pid === S.captain ? ' · ★ CAPITAINE' : '') + '</small>' : '<span class="bdai" style="width:78px;height:78px;display:flex;margin:0 auto 6px;--c:#1F4A66;font-size:30px">?</span>EN ATTENTE') + '</div>';
    }
    h += '<div style="position:absolute;left:420px;top:520px;width:600px;color:var(--dim);font-size:17px;line-height:1.35">Chrono du tour : <b style="color:var(--amber)">' + (S.settings.timer ? S.settings.timer + ' s' : 'sans') + '</b> · 3 à 6 joueurs · le capitaine ★ règle le chrono depuis son téléphone.</div>';
    h += '<div style="position:absolute;left:420px;width:610px;top:600px;text-align:center"><button class="tvbtn" id="tvStart"' + (S.players.length < 3 ? ' disabled style="opacity:.4"' : '') + '>' + (S.players.length < 3 ? 'IL FAUT 3 JOUEURS' : 'LANCER L\'ENQUÊTE') + '</button></div>';
    return h;
  }

  function tvPlay(S) {
    var cur = curPlayer(), h = tvHeader(S, cur), i, L = S.last;
    // couloirs
    h += '<div class="cor" style="left:268px;top:225px;width:40px;height:10px"></div><div class="cor" style="left:548px;top:225px;width:40px;height:10px"></div>' +
      '<div class="cor" style="left:268px;top:535px;width:40px;height:10px"></div><div class="cor" style="left:548px;top:535px;width:40px;height:10px"></div>' +
      '<div class="cor" style="left:143px;top:370px;width:10px;height:40px"></div><div class="cor" style="left:703px;top:370px;width:10px;height:40px"></div>' +
      '<div class="cor v2" style="left:425px;top:370px;width:6px;height:40px"></div>';
    var pawnRoom = S.pawns;
    for (i = 0; i < 6; i++) {
      var xy = roomXY(i), act = cur && pawnRoom[cur.sid] === i, hit = L && L.m === 6 + i && S.step === 'refute';
      var ppl = '';
      for (var s = 0; s < 6; s++) if (pawnRoom[s] === i) ppl += badge(s, 58, '');
      var vent = E.VENTS[i] !== undefined ? '⇄ conduit : ' + E.MODULES[E.VENTS[i]] : '';
      h += '<div class="room' + (act ? ' act' : '') + (hit ? ' hit' : '') + '" style="left:' + xy.x + 'px;top:' + xy.y + 'px"><div class="rn">' + esc(E.MODULES[i]) + '</div><div class="rv">' + esc(vent.toUpperCase()) + '</div><div class="pw">' + ppl + '</div></div>';
    }
    // panneaux
    h += '<div class="pnl" style="top:96px;height:150px"><div class="t">TOUR EN COURS</div><div class="who" style="color:' + SCOL[cur.sid] + '">' + esc(cur.name) + '</div><div class="step">' + (STEPLBL[S.step] || '') + (S.step === 'refute' ? ' · ' + esc(pName(S.refuter)) : '') + '</div>' + (S.deadline ? '<div class="tm" id="tvtmr">' + clock(C.endAt - Date.now()) + '</div>' : '') + '<div class="mono" style="font-size:12px;color:var(--dim);margin-top:8px">TOUR ' + S.round + '</div></div>';
    h += '<div class="pnl" style="top:258px;height:182px"><div class="t">DERNIER SOUPÇON</div>';
    if (L) h += '<div class="txt"><b>' + esc(pName(L.pid)) + '</b> : <span style="color:var(--cyan)">' + esc(E.SUSPECTS[L.s]) + '</span> · <span style="color:var(--amber)">' + esc(E.cardName(L.m)) + '</span> · <span style="color:var(--violet)">' + esc(E.cardName(L.w)) + '</span></div>' +
      '<div class="txt" style="margin-top:10px;color:var(--rose)">' + (L.none ? 'Personne ne peut réfuter.' : S.step === 'refute' ? esc(pName(L.by)) + ' montre un indice à ' + esc(pName(L.pid)) + '…' : L.shownBy ? 'Indice montré par ' + esc(pName(L.shownBy)) + '.' : '') + '</div>';
    else h += '<div class="txt" style="color:var(--dim)">Aucun soupçon pour l\'instant.</div>';
    h += '</div><div class="pnl" style="top:452px;height:240px"><div class="t">JOURNAL DE BORD</div><div class="jl">';
    S.log.slice(-7).reverse().forEach(function (l) { h += '<div class="' + l.k + '"><small>' + hhmm(l.at) + '</small>' + esc(l.t) + '</div>'; });
    return h + '</div></div>';
  }

  function tvOver(S) {
    var r = S.reveal || [0, 6, 12], win = S.winner ? findP(S.winner) : null;
    var h = tvHeader(S, win);
    h += '<div class="tvbig" style="top:120px;font-size:54px;font-weight:700;color:var(--green);letter-spacing:.08em">' + (win ? esc(win.name).toUpperCase() + ' A RÉSOLU L\'ENQUÊTE !' : 'ENQUÊTE NON RÉSOLUE') + '</div>';
    h += '<div class="tvbig" style="top:195px;font-size:22px;color:var(--dim)">' + (win ? 'Le réacteur est réparé.' : 'Personne n\'a trouvé : voici la vérité.') + '</div>';
    h += '<div class="tvbig" style="top:270px"><div class="rvc" style="--c:' + SCOL[r[0]] + '"><small>QUI</small>' + esc(E.SUSPECTS[r[0]]) + '</div><div class="rvc" style="--c:var(--amber)"><small>OÙ</small>' + esc(E.cardName(r[1])) + '</div><div class="rvc" style="--c:var(--violet)"><small>AVEC QUOI</small>' + esc(E.cardName(r[2])) + '</div></div>';
    h += '<div class="tvbig" style="top:480px;padding:0 200px"><div class="jl" style="height:100px;text-align:left">' + S.log.slice(-4).reverse().map(function (l) { return '<div class="' + l.k + '">' + esc(l.t) + '</div>'; }).join('') + '</div></div>';
    h += '<div class="tvbig" style="top:610px"><button class="tvbtn" id="tvAgain">REJOUER</button></div>';
    return h;
  }

  init();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
