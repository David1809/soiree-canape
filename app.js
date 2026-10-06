// Soirée Canapé — interface (télé + téléphones) et synchronisation Supabase.
(function () {
  'use strict';

  var SB_URL = 'https://qsyrrcrknxdkdsxkoooa.supabase.co';
  var SB_KEY = 'sb_publishable_whJtaOQEsL6Q1YqsxtLU5w_mLhX3Ocz';
  var COLORS = ['#FFC93C', '#FF7A6B', '#5AA2FF', '#3FD49A', '#FF8FD0', '#F5F3FF'];
  var COLOR_NAMES = ['Jaune', 'Corail', 'Bleu', 'Vert', 'Rose', 'Blanc'];
  var LETTERS = ['A', 'B', 'C', 'D'];
  var LETTERS2 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var GAMES = SCEngine.GAMES;
  var STALE_MS = 12 * 3600 * 1000;

  var app = document.getElementById('app');
  var netEl = document.getElementById('net');
  var sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  // ---------- utilitaires ----------
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { try { return Number(n).toLocaleString('fr-FR'); } catch (e) { return String(n); } }
  function ord(n) { return n === 1 ? '1ᵉʳ' : n + 'ᵉ'; }
  function $(id) { return document.getElementById(id); }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }

  var me = lsGet('sc_me');
  if (!me || !me.pid) { me = { pid: uid(), name: '', color: null }; lsSet('sc_me', me); }

  var C = {
    code: null, tv: false, engine: null, ch: null, ready: false, queue: [],
    S: null, endAt: 0, view: '', myRound: -1, myAns: null, gotFresh: false,
    helloTimer: null, editing: false, pick: null, lock: null
  };

  // ---------- démarrage ----------
  function init() {
    var params = new URLSearchParams(location.search);
    var r = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '');
    var sess = lsGet('sc_sess');
    if (params.has('tv')) {
      if (sess && sess.tv) return resume(sess, function () { createRoom(true); });
      return createRoom(true);
    }
    if (r.length === 4) {
      if (sess && sess.code === r && !sess.tv) return resume(sess, function () { openJoin(r); });
      return openJoin(r);
    }
    if (sess && !sess.tv) return resume(sess, showHome);
    showHome();
  }

  function fetchRoom(code) {
    return sb.from('rooms').select('state, updated_at').eq('code', code).maybeSingle();
  }

  function resume(sess, fallback) {
    boot('Reconnexion…');
    fetchRoom(sess.code).then(function (r) {
      var row = r.data;
      if (r.error || !row || Date.now() - Date.parse(row.updated_at) > STALE_MS) {
        lsDel('sc_sess');
        return fallback();
      }
      var st = row.state;
      if (st.phase === 'closed') { lsDel('sc_sess'); return fallback(); }
      if (!sess.tv && (st.phase === 'draw' || st.phase === 'question' || st.phase === 'vote' || st.phase === 'reveal')) {
        return showResumeChoice(sess, st);
      }
      start(sess, st);
    });
  }

  function showResumeChoice(sess, st) {
    document.body.className = 'phone';
    C.view = 'resume';
    var mine = null;
    (st.players || []).forEach(function (p) { if (p.pid === me.pid) mine = p; });
    app.innerHTML = '<div class="ph"><h1 class="title">Soirée Canapé</h1><div class="grow"></div>' +
      '<div class="card stack" style="text-align:center"><span class="label">Partie en cours</span>' +
      '<span class="display" style="font-size:34px;letter-spacing:.2em">' + esc(sess.code) + '</span>' +
      '<span class="muted">Épreuve ' + st.round + ' / ' + (st.deck || []).length + (mine ? ' · tu as ' + mine.score + ' pts' : '') + '</span></div>' +
      '<div class="grow"></div>' +
      '<button class="btn" id="resume">Reprendre la partie</button>' +
      '<button class="btn ghost" id="drop">' + (sess.engine ? 'Arrêter la partie pour tout le monde' : 'Quitter la partie') + '</button></div>';
    fit();
    on('resume', 'click', function () { start(sess, st); });
    on('drop', 'click', function () {
      if (sess.engine) return closeRemote(sess.code, st);
      // on prévient l'hôte qu'on part, puis retour à l'accueil
      var ch = sb.channel('sc-' + sess.code, { config: { broadcast: { self: false } } });
      ch.subscribe(function (status) {
        if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'p', payload: { t: 'leave', pid: me.pid } });
      });
      goHome(600);
    });
  }

  // Ferme une partie qu'on hébergeait, sans la relancer.
  function closeRemote(code, st) {
    st.phase = 'closed';
    st.closedBy = me.name || '';
    sb.from('rooms').upsert({ code: code, state: st, updated_at: new Date().toISOString() }).then(function () {});
    var ch = sb.channel('sc-' + code, { config: { broadcast: { self: false } } });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 's', payload: { s: SCEngine.publicView(st), rem: 0 } });
    });
    goHome(800);
  }

  function goHome(delay) {
    lsDel('sc_sess');
    boot('Retour à l\'accueil…');
    setTimeout(function () { location.href = location.pathname; }, delay || 0);
  }

  function openJoin(code) {
    boot('Recherche de la partie…');
    fetchRoom(code).then(function (r) {
      if (r.error || !r.data) return showError('Partie « ' + code + ' » introuvable. Vérifie le code.');
      start({ code: code, tv: false, engine: false }, r.data.state);
    });
  }

  function createRoom(asTv) {
    boot('Création de la partie…');
    var tries = 0;
    (function attempt() {
      var code = '';
      for (var i = 0; i < 4; i++) code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
      var st = SCEngine.newState(code, asTv);
      sb.from('rooms').insert({ code: code, state: st }).then(function (r) {
        if (r.error) {
          if (++tries < 5) return attempt();
          return showError('Impossible de créer la partie (' + r.error.message + ').');
        }
        var sess = { code: code, tv: asTv, engine: true };
        lsSet('sc_sess', sess);
        start(sess, st);
      });
    })();
  }

  function start(sess, state) {
    C.code = sess.code;
    C.tv = !!sess.tv;
    document.body.className = C.tv ? 'tv' : 'phone';
    if (C.tv) { sizeTv(); window.addEventListener('resize', sizeTv); }
    try { history.replaceState(null, '', C.tv ? '?tv' : '?r=' + sess.code); } catch (e) {}
    if (sess.engine) C.engine = makeEngine(sess.code, state, sess.tv);
    connect();
    if (C.engine) C.engine.publish(false);
    else if (state) {
      var rem = 0;
      if (state.phase === 'question' && state.cur) rem = state.cur.deadline - Date.now();
      if (state.phase === 'draw') rem = state.drawUntil - Date.now();
      onState({ s: SCEngine.publicView(state), rem: Math.max(0, rem) });
    }
  }

  function makeEngine(code, state, hasTv) {
    var played = {}, persistT = null;
    sb.from('played').select('qid').then(function (r) {
      (r.data || []).forEach(function (x) { played[x.qid] = true; });
    });
    return new SCEngine.Engine({
      code: code, hasTv: hasTv, state: state, bank: QUESTIONS,
      broadcast: function (view, rem) {
        chSend('s', { s: view, rem: rem });
        onState({ s: view, rem: rem });
      },
      persist: function (st) {
        clearTimeout(persistT);
        persistT = setTimeout(function () {
          sb.from('rooms').upsert({ code: code, state: st, updated_at: new Date().toISOString() })
            .then(function (r) { if (r.error) console.warn('persist', r.error); });
        }, 250);
      },
      markPlayed: function (id) {
        played[id] = true;
        sb.from('played').upsert({ qid: id }, { ignoreDuplicates: true }).then(function () {});
      },
      getPlayed: function () { return played; }
    });
  }

  // ---------- temps réel ----------
  function connect() {
    var ch = sb.channel('sc-' + C.code, { config: { broadcast: { self: false } } });
    C.ch = ch;
    if (C.engine) ch.on('broadcast', { event: 'p' }, function (m) { C.engine.handle(m.payload); });
    else ch.on('broadcast', { event: 's' }, function (m) { onState(m.payload); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        C.ready = true;
        netEl.hidden = true;
        while (C.queue.length) ch.send({ type: 'broadcast', event: 'p', payload: C.queue.shift() });
        if (C.engine) C.engine.publish(false);
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
    if (C.engine) C.engine.handle(msg);
    else chSend('p', msg);
  }

  function hello() {
    C.gotFresh = false;
    send({ t: 'hello' });
    clearInterval(C.helloTimer);
    C.silent = 0;
    C.helloTimer = setInterval(function () {
      if (C.gotFresh) { clearInterval(C.helloTimer); return; }
      send({ t: 'hello' });
      if (++C.silent >= 3) {
        netEl.innerHTML = 'L\'hôte de la partie ne répond pas. <button type="button" data-quit class="netbtn">Quitter</button>';
        netEl.hidden = false;
      }
    }, 3000);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !C.code) return;
    keepAwake();
    if (C.engine) C.engine.publish(false);
    else if (C.ready) hello();
  });

  function keepAwake() {
    if (!('wakeLock' in navigator) || (C.lock && !C.lock.released)) return;
    navigator.wakeLock.request('screen').then(function (l) { C.lock = l; }).catch(function () {});
  }
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-quit]') : null;
    if (b) leave();
  });

  function onState(p) {
    if (!p || !p.s) return;
    var S = p.s;
    C.S = S;
    C.endAt = Date.now() + (p.rem || 0);
    C.gotFresh = true;
    C.silent = 0;
    if (C.ready) netEl.hidden = true;
    if (S.round !== C.myRound) { C.myRound = S.round; C.myAns = null; C.myVote = null; C.lieSent = false; C.rejN = 0; C.ordre = null; }
    if (S.phase === 'closed' && !C.engine) return showClosed(S.closedBy);
    render();
  }

  // ---------- chrono ----------
  setInterval(tickTimers, 200);
  function tickTimers() {
    if (!C.S) return;
    var left = Math.max(0, C.endAt - Date.now());
    var total = (C.S.cur && C.S.cur.time) || 1;
    var i, els = document.querySelectorAll('[data-sec]');
    for (i = 0; i < els.length; i++) els[i].textContent = Math.ceil(left / 1000);
    els = document.querySelectorAll('[data-bar]');
    for (i = 0; i < els.length; i++) els[i].style.width = Math.min(100, left / total * 100) + '%';
    els = document.querySelectorAll('[data-ring]');
    for (i = 0; i < els.length; i++) els[i].style.setProperty('--p', Math.min(1, left / total));
  }

  // ---------- rendu ----------
  function boot(msg) { C.view = ''; app.innerHTML = '<div class="boot"><div style="text-align:center">Soirée Canapé<div class="muted" style="font-size:16px;font-family:var(--body);font-weight:500;margin-top:10px">' + esc(msg) + '</div></div></div>'; }

  function setView(key, html) {
    if (C.view === key) return false;
    C.view = key;
    app.innerHTML = html;
    window.scrollTo(0, 0);
    tickTimers();
    setTimeout(fit, 0);
    return true;
  }

  // Ajuste l'écran téléphone à la hauteur réellement disponible (barre du navigateur
  // affichée ou non, polices chargées ou non) : jamais de défilement.
  function fit() {
    if (C.tv) return;
    var h = window.innerHeight;
    document.documentElement.style.setProperty('--app-h', h + 'px');
    var el = app.firstElementChild;
    if (!el || !el.classList || !el.classList.contains('ph')) return;
    el.style.zoom = '';
    el.style.minHeight = '';
    var sh = el.scrollHeight;
    if (sh > h + 1) {
      var z = Math.max(0.7, h / sh);
      el.style.zoom = z;
      el.style.minHeight = (h / z) + 'px';
    }
  }
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function render() {
    if (!C.S) return;
    if (C.tv) renderTv(); else renderPhone();
  }

  function findP(pid) {
    var ps = C.S.players;
    for (var i = 0; i < ps.length; i++) if (ps[i].pid === pid) return ps[i];
    return null;
  }
  function capName() { var p = findP(C.S.captain); return p ? p.name : 'le capitaine'; }
  function ranked() { return C.S.players.slice().sort(function (a, b) { return b.score - a.score; }); }
  function initial(p) { return esc((p.name || '?').charAt(0).toUpperCase()); }
  function av(p, px) {
    return '<span class="av" style="width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px * 0.45) + 'px;background:' + COLORS[p.color] + '">' + initial(p) + '</span>';
  }
  function avR(p, rem, ghost) {
    return '<span class="av' + (ghost ? ' ghost' : '') + '" style="width:' + rem + 'rem;height:' + rem + 'rem;font-size:' + (rem * 0.45) + 'rem;background:' + COLORS[p.color] + '">' + initial(p) + '</span>';
  }
  function answeredSet() {
    var o = {};
    (C.S.answered || []).forEach(function (pid) { o[pid] = true; });
    return o;
  }
  function gameName(g) { return GAMES[g] ? GAMES[g].name : g; }
  function joinUrl() { return location.origin + location.pathname + '?r=' + C.code; }
  function qrSvg(text) {
    var q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  // ================= TÉLÉPHONE =================
  function renderPhone() {
    var S = C.S, p = findP(me.pid);
    if (!p || C.editing) return phoneJoin();
    if (S.phase === 'lobby') return phoneLobby();
    if (S.phase === 'draw') return phoneDraw();
    if (S.phase === 'question') return phoneQuestion();
    if (S.phase === 'vote') return phoneVote();
    if (S.phase === 'reveal') return phoneReveal();
    if (S.phase === 'final') return phoneFinal();
  }

  function topbar() {
    var p = findP(me.pid);
    if (!p) return '';
    return '<div class="topbar">' + av(p, 40) + '<span class="name">' + esc(p.name) + '</span><span class="pts">' + p.score + ' pts</span>' +
      '<button type="button" class="qx" data-quit aria-label="Quitter la partie"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
  }

  function takenColors() {
    var t = {};
    C.S.players.forEach(function (p) { if (p.pid !== me.pid) t[p.color] = p.name; });
    return t;
  }

  function phoneJoin() {
    var taken = takenColors();
    if (C.pick == null || taken[C.pick] !== undefined) {
      C.pick = (me.color != null && taken[me.color] === undefined) ? me.color : null;
      for (var c = 0; C.pick == null && c < COLORS.length; c++) if (taken[c] === undefined) C.pick = c;
    }
    var full = C.S.players.length >= 6 && !findP(me.pid);
    var fresh = setView('join', '<div class="ph">' +
      '<div><h1 class="title">Soirée Canapé</h1><div class="muted">Partie <b>' + esc(C.code) + '</b></div></div>' +
      '<div class="stack"><label class="label" for="nm">Ton prénom</label><input id="nm" class="input" maxlength="14" autocomplete="off" value="' + esc(me.name) + '"></div>' +
      '<div class="stack"><span class="label">Ta couleur</span><div class="colors" id="cols"></div></div>' +
      '<div class="grow"></div>' +
      '<div class="note" id="full"' + (full ? '' : ' hidden') + '>La partie est complète (6 joueurs).</div>' +
      '<button class="btn" id="go"' + (full ? ' disabled' : '') + '>' + (C.editing ? 'Valider' : 'Rejoindre') + '</button>' +
      '<button class="linkbtn" id="back">' + (C.editing ? 'Annuler' : 'Retour à l\'accueil') + '</button>' +
      '</div>');
    // couleurs : mises à jour sans effacer le prénom en cours de saisie
    var html = '';
    COLORS.forEach(function (hex, i) {
      var t = taken[i] !== undefined;
      html += '<button type="button" data-c="' + i + '" class="' + (C.pick === i ? 'sel' : '') + '" style="background:' + hex + '"' +
        (t ? ' disabled aria-label="' + COLOR_NAMES[i] + ', pris par ' + esc(taken[i]) + '"' : ' aria-label="' + COLOR_NAMES[i] + '"') + '></button>';
    });
    $('cols').innerHTML = html;
    $('full').hidden = !full;
    $('go').disabled = full;
    if (!fresh) return;
    $('cols').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : e.target;
      if (!b || b.disabled || b.getAttribute('data-c') == null) return;
      C.pick = Number(b.getAttribute('data-c'));
      var bs = $('cols').querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].className = Number(bs[i].getAttribute('data-c')) === C.pick ? 'sel' : '';
    });
    on('go', 'click', function () {
      var name = $('nm').value.replace(/\s+/g, ' ').trim();
      if (!name) { $('nm').focus(); return; }
      me.name = name.slice(0, 14);
      me.color = C.pick;
      lsSet('sc_me', me);
      lsSet('sc_sess', { code: C.code, tv: false, engine: !!C.engine });
      C.editing = false;
      C.view = '';
      send({ t: 'join', name: me.name, color: me.color });
      keepAwake();
    });
    on('back', 'click', function () {
      if (C.editing) { C.editing = false; C.view = ''; render(); return; }
      leave();
    });
  }

  function leave() {
    var S = C.S, inGame = S && S.phase !== 'lobby' && S.phase !== 'final';
    if (C.engine && S && !S.hasTv) {
      if (S.players.length > 1 && !window.confirm('La partie tourne sur ton téléphone : si tu quittes, elle s\'arrête pour tout le monde. Quitter ?')) return;
      C.engine.close(me.name);
      return goHome(500);
    }
    if (inGame && !window.confirm('Quitter la partie en cours ? Tes points seront perdus.')) return;
    send({ t: 'leave' });
    goHome(400);
  }

  function phoneLobby() {
    var S = C.S, cap = S.captain === me.pid, st = S.settings;
    var key = 'lobby|' + JSON.stringify([S.players, S.captain, st]);
    var chips = S.players.map(function (p) {
      var tag = p.pid === S.captain ? 'capitaine' : (p.pid === me.pid ? 'toi' : '');
      if (p.pid === S.captain && p.pid === me.pid) tag = 'toi · capitaine';
      return '<div class="pchip">' + av(p, 32) + '<span class="n">' + esc(p.name) + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</span></div>';
    }).join('');
    var qr = '';
    if (!S.hasTv && C.engine) {
      qr = '<div class="card qrmini"><div class="qrbox sm">' + qrSvg(joinUrl()) + '</div><div class="stack" style="gap:4px">' +
        '<span style="font-weight:700;font-size:17px">Faites scanner ce QR code</span><span class="muted" style="font-size:13px">ou tapez le code ' + esc(C.code) + ' sur l\'accueil du jeu</span></div></div>';
    }
    var settings;
    if (cap) {
      var seg = [10, 15, 25].map(function (n) { return '<button type="button" data-n="' + n + '" class="' + (st.count === n ? 'on' : '') + '">' + n + '</button>'; }).join('');
      var games = Object.keys(GAMES).map(function (g) {
        var onG = st.games.indexOf(g) >= 0;
        return '<button type="button" class="tog' + (onG ? ' on' : '') + '" data-g="' + g + '" aria-pressed="' + onG + '">' + esc(GAMES[g].name) + '</button>';
      }).join('');
      settings = '<div class="card stack" style="gap:12px">' +
        '<div class="setrow"><span class="label">Épreuves</span><div class="seg grow" id="seg">' + seg + '</div></div>' +
        '<div class="toggles" id="games">' + games +
        '<button type="button" class="tog' + (st.finale ? ' on' : '') + '" data-f="1" aria-pressed="' + st.finale + '">Finale ×2</button></div></div>';
    } else {
      settings = '<div class="note">C\'est ' + esc(capName()) + ' qui lance la partie</div>';
    }
    if (!setView(key, '<div class="ph">' +
      '<div class="hd"><div><h1 class="title" style="font-size:28px">Soirée Canapé</h1><div class="muted" style="font-size:14px">' + S.players.length + ' joueur' + (S.players.length > 1 ? 's' : '') + ' dans la partie</div></div>' +
      '<span class="codepill">' + esc(C.code) + '</span></div>' +
      qr + '<div class="pgrid">' + chips + '</div>' + settings +
      '<div class="grow"></div>' +
      (cap ? '<button class="btn" id="start">Lancer la partie</button>' : '') +
      '<div class="links"><button class="linkbtn" id="edit">Modifier mon profil</button><button class="linkbtn" id="quit">Quitter</button></div></div>')) return;

    on('seg', 'click', function (e) {
      var n = e.target.getAttribute && e.target.getAttribute('data-n');
      if (!n) return;
      send({ t: 'cmd', cmd: 'settings', settings: { count: Number(n), games: st.games, finale: st.finale } });
    });
    on('games', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var s = { count: st.count, games: st.games.slice(), finale: st.finale };
      if (b.getAttribute('data-f')) s.finale = !s.finale;
      else {
        var g = b.getAttribute('data-g'), i = s.games.indexOf(g);
        if (i >= 0) { if (s.games.length === 1) return; s.games.splice(i, 1); } else s.games.push(g);
      }
      send({ t: 'cmd', cmd: 'settings', settings: s });
    });
    on('start', 'click', function () { keepAwake(); send({ t: 'cmd', cmd: 'start', settings: st }); });
    on('edit', 'click', function () { C.editing = true; C.view = ''; render(); });
    on('quit', 'click', leave);
  }

  function x2chip() { return C.S.mult > 1 ? ' <span class="chip x2">Finale ×2</span>' : ''; }

  function phoneDraw() {
    var S = C.S, g = S.deck[S.round - 1];
    setView('draw|' + S.round, '<div class="ph">' + topbar() +
      '<div class="drawcard"><span class="k">Épreuve ' + S.round + ' / ' + S.deck.length + '</span><span class="g">' + esc(gameName(g)) + '</span>' +
      (S.mult > 1 ? '<span><span class="chip x2">Finale : points doubles</span></span>' : '') + '</div></div>');
  }

  function phoneHead(sub) {
    var S = C.S, cur = S.cur;
    return topbar() +
      '<div class="stack" style="gap:8px"><div class="rowx"><span>' + esc(gameName(cur.g)) + (sub ? ' · ' + sub : '') + ' · ' + S.round + '/' + S.deck.length + (S.mult > 1 ? ' · ×2' : '') + '</span>' +
      '<b style="color:var(--ink)"><span data-sec></span> s</b></div><div class="bar"><i data-bar></i></div></div>' +
      '<h2>' + esc(cur.q) + '</h2>';
  }

  function phoneQuestion() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    var rej = (S.reject || {})[me.pid];
    if (cur.g === 'bluff' && rej && rej.n !== C.rejN) { C.rejN = rej.n; C.lieSent = false; }
    var done = cur.g === 'bluff' ? (C.lieSent || ans[me.pid]) : (C.myAns != null || ans[me.pid]);
    var key = 'q|' + S.round + '|' + (done ? 1 : 0) + '|' + C.rejN;
    var body = '';
    if (cur.g === 'culture') {
      body = '<div class="stack" id="opts">' + cur.c.map(function (t, i) {
        var cls = 'choice';
        if (done) cls += (C.myAns === i ? ' sel' : ' dim');
        return '<button type="button" class="' + cls + '" data-i="' + i + '"' + (done ? ' disabled' : '') + '><span class="letter">' + LETTERS[i] + '</span><span>' + esc(t) + '</span></button>';
      }).join('') + '</div>';
    } else if (cur.g === 'estimation') {
      if (!done) {
        body = '<div class="stack"><input id="num" class="input big" inputmode="decimal" autocomplete="off" placeholder="Ta réponse">' +
          (cur.u ? '<div class="muted" style="text-align:center">en ' + esc(cur.u) + '</div>' : '') +
          '<button class="btn" id="send">Valider</button></div>';
      } else {
        body = '<div class="card" style="text-align:center"><div class="label">Ta réponse</div><div class="display" style="font-size:34px;margin-top:6px">' +
          (C.myAns != null ? esc(fmt(C.myAns)) + (cur.u ? ' <span style="font-size:20px">' + esc(cur.u) + '</span>' : '') : 'envoyée') + '</div></div>';
      }
    } else if (cur.g === 'bluff') {
      if (!done) {
        body = '<div class="stack"><input id="lie" class="input" maxlength="60" autocomplete="off" placeholder="Ta fausse réponse" value="' + esc(C.myAns || '') + '">' +
          (rej ? '<div class="note warn">' + (rej.why === 'truth' ? 'Bien vu, c\'est la vraie réponse ! Invente plutôt un mensonge.' : 'Quelqu\'un a déjà écrit ça. Trouve autre chose.') + '</div>' :
            '<div class="muted" style="font-size:14px;text-align:center">Invente une fausse réponse crédible pour piéger les autres</div>') +
          '<button class="btn" id="sendlie">Envoyer mon mensonge</button></div>';
      } else {
        body = '<div class="card" style="text-align:center"><div class="label">Ton mensonge</div><div style="font-size:22px;font-weight:700;margin-top:6px">' + esc(C.myAns || 'envoyé') + '</div></div>';
      }
    } else if (cur.g === 'ordre') {
      if (!C.ordre) C.ordre = cur.items.map(function (_, i) { return i; });
      body = '<div class="olist' + (done ? ' done' : '') + '" id="olist">' + ordreItems() + '</div>' +
        (done ? '' : '<button class="btn" id="sendordre">Valider mon ordre</button>');
    }
    var fresh = setView(key, '<div class="ph">' + phoneHead() + body + '<div class="grow"></div><div class="note" id="stat"></div></div>');
    var n = (S.answered || []).length;
    $('stat').textContent = done ? 'Réponse envoyée · ' + n + '/' + S.players.length + ' ont répondu' :
      (cur.g === 'ordre' ? 'Fais glisser les cartes pour les classer' : 'Réponds avant la fin du chrono');
    fit();
    if (!fresh) return;
    on('opts', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      C.myAns = Number(b.getAttribute('data-i'));
      send({ t: 'answer', round: S.round, val: C.myAns });
      render();
    });
    function submit() {
      var raw = $('num').value.replace(/\s/g, '').replace(',', '.');
      var v = parseFloat(raw);
      if (!isFinite(v)) { $('num').focus(); return; }
      C.myAns = v;
      send({ t: 'answer', round: S.round, val: v });
      render();
    }
    on('send', 'click', submit);
    on('num', 'keydown', function (e) { if (e.key === 'Enter') submit(); });
    function sendLie() {
      var v = $('lie').value.replace(/\s+/g, ' ').trim();
      if (!v) { $('lie').focus(); return; }
      C.myAns = v.slice(0, 60);
      C.lieSent = true;
      send({ t: 'answer', round: S.round, val: C.myAns });
      render();
    }
    on('sendlie', 'click', sendLie);
    on('lie', 'keydown', function (e) { if (e.key === 'Enter') sendLie(); });
    on('sendordre', 'click', function () {
      C.myAns = C.ordre.slice();
      send({ t: 'answer', round: S.round, val: C.myAns });
      render();
    });
    if (cur.g === 'ordre' && !done) bindDrag($('olist'));
  }

  function ordreItems() {
    var items = C.S.cur.items;
    return C.ordre.map(function (k, pos) {
      return '<div class="oitem" data-pos="' + pos + '"><span class="letter">' + (pos + 1) + '</span><span class="t">' + esc(items[k].t) + '</span>' +
        '<svg class="grip" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></div>';
    }).join('');
  }

  // Glisser-déposer au doigt pour réordonner les cartes.
  function bindDrag(list) {
    if (!list) return;
    var drag = null;
    list.addEventListener('pointerdown', function (e) {
      var el = e.target.closest ? e.target.closest('.oitem') : null;
      if (!el) return;
      e.preventDefault();
      var els = list.querySelectorAll('.oitem');
      var step = els.length > 1 ? els[1].getBoundingClientRect().top - els[0].getBoundingClientRect().top : el.offsetHeight;
      drag = { el: el, els: els, from: Number(el.getAttribute('data-pos')), to: Number(el.getAttribute('data-pos')), y: e.clientY, step: step, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('drag');
    });
    list.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y, n = drag.els.length;
      drag.to = Math.max(0, Math.min(n - 1, drag.from + Math.round(dy / drag.step)));
      drag.el.style.transform = 'translateY(' + dy + 'px)';
      for (var j = 0; j < n; j++) {
        if (j === drag.from) continue;
        var shift = 0;
        if (drag.from < drag.to && j > drag.from && j <= drag.to) shift = -drag.step;
        if (drag.from > drag.to && j < drag.from && j >= drag.to) shift = drag.step;
        drag.els[j].style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      }
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var moved = C.ordre.splice(drag.from, 1)[0];
      C.ordre.splice(drag.to, 0, moved);
      drag = null;
      list.innerHTML = ordreItems();
    }
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
  }

  function phoneVote() {
    var S = C.S, ans = answeredSet();
    var voted = C.myVote != null || ans[me.pid];
    var mine = C.myAns ? String(C.myAns) : null;
    var key = 'v|' + S.round + '|' + (voted ? 1 : 0);
    var opts = (S.options || []).map(function (o, i) {
      var own = mine && o.text === mine;
      var cls = 'choice' + (voted ? (C.myVote === o.id ? ' sel' : ' dim') : '') + (own ? ' own' : '');
      return '<button type="button" class="' + cls + '" data-o="' + o.id + '"' + (voted || own ? ' disabled' : '') + '><span class="letter">' + LETTERS2[i] + '</span><span class="grow">' + esc(o.text) + '</span>' +
        (own ? '<span class="tag">ton mensonge</span>' : '') + '</button>';
    }).join('');
    var fresh = setView(key, '<div class="ph">' + phoneHead('vote') +
      '<div class="muted" style="font-size:14px;margin-top:-6px">Laquelle est la vraie réponse ?</div><div class="stack" id="vopts">' + opts + '</div>' +
      '<div class="grow"></div><div class="note" id="stat"></div></div>');
    var n = (S.answered || []).length;
    $('stat').textContent = voted ? 'Vote envoyé · ' + n + '/' + S.players.length + ' ont voté' : 'Vote avant la fin du chrono';
    fit();
    if (!fresh) return;
    on('vopts', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      C.myVote = b.getAttribute('data-o');
      send({ t: 'vote', round: S.round, opt: C.myVote });
      render();
    });
  }

  function rankingRows(withGain) {
    var res = C.S.result || {};
    return '<div class="plist">' + ranked().map(function (p, i) {
      var g = withGain && res[p.pid] && res[p.pid].pts ? '<span class="g">+' + res[p.pid].pts + '</span>' : '';
      return '<div class="prow"><span class="muted" style="width:22px;font-weight:700">' + (i + 1) + '</span>' + av(p, 36) +
        '<span class="n">' + esc(p.name) + (p.pid === me.pid ? ' <span class="muted" style="font-size:14px">(toi)</span>' : '') + '</span>' + g + '<span class="r">' + p.score + '</span></div>';
    }).join('') + '</div>';
  }

  function phoneReveal() {
    var S = C.S, cur = S.cur, r = (S.result || {})[me.pid] || { v: null, pts: 0 };
    var verdict = '', extra = '';
    if (cur.g === 'culture') {
      var good = cur.c[cur.a];
      if (r.ok) verdict = '<div class="verdict ok"><span>Bonne réponse !' + (r.fast ? ' Le plus rapide' : '') + '</span><span class="big">+' + r.pts + '</span><span>' + esc(good) + '</span></div>';
      else verdict = '<div class="verdict ko"><span class="big">' + (r.v == null ? 'Pas de réponse' : 'Raté') + '</span><span class="muted">La bonne réponse</span><span style="font-size:22px;font-weight:700">' + esc(good) + '</span></div>';
    } else if (cur.g === 'estimation') {
      var unit = cur.u ? ' ' + esc(cur.u) : '';
      verdict = '<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span' + (r.pts ? '' : ' class="muted"') + '>Bonne réponse</span><span class="big">' + esc(fmt(cur.a)) + unit + '</span>' +
        (r.v == null ? '<span>Pas de réponse</span>' : '<span>Toi : ' + esc(fmt(r.v)) + ' · écart ' + esc(fmt(r.diff)) + (r.pts ? ' · +' + r.pts : '') + '</span>') + '</div>';
    } else if (cur.g === 'bluff') {
      var truth = '', byOpt = {};
      (S.options || []).forEach(function (o) { byOpt[o.id] = o; if (o.by === null) truth = o.text; });
      var head;
      if (r.found) head = 'Bien vu, c\'était la vérité !';
      else if (r.voted && byOpt[r.voted] && byOpt[r.voted].by) {
        var liar = findP(byOpt[r.voted].by);
        head = 'Piégé par ' + esc(liar ? liar.name : 'un menteur') + ' !';
      } else head = 'Pas de vote';
      verdict = '<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big" style="font-size:26px">' + head + '</span>' +
        (r.fooled ? '<span>Ton mensonge a piégé ' + r.fooled + ' joueur' + (r.fooled > 1 ? 's' : '') + '</span>' : '') +
        (r.pts ? '<span style="font-weight:800;font-size:22px">+' + r.pts + '</span>' : '') +
        '<span' + (r.pts ? '' : ' class="muted"') + '>La vérité : <b>' + esc(truth) + '</b></span></div>';
    } else if (cur.g === 'ordre') {
      var n = cur.order.length;
      verdict = '<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big">' + (r.v == null ? 'Pas de réponse' : (r.good || 0) + ' / ' + n + ' bien placés') + '</span>' +
        (r.pts ? '<span>+' + r.pts + (r.good === n ? ' · sans faute !' : '') + '</span>' : '') + '</div>';
      extra = '<div class="stack" style="gap:6px">' + cur.order.map(function (k, pos) {
        var ok = r.v && r.v[pos] === k;
        return '<div class="prow"><span class="letter" style="width:30px;height:30px;border-radius:9px;font-size:15px">' + (pos + 1) + '</span><span class="n">' + esc(cur.items[k].t) +
          (cur.vals[k] ? ' <span class="muted" style="font-size:13px;font-weight:500">' + esc(cur.vals[k]) + '</span>' : '') + '</span>' +
          (r.v ? '<span class="' + (ok ? 'okmark' : 'komark') + '">' + (ok ? '✓' : '✗') + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    var last = S.round >= S.deck.length;
    var ctrl = S.captain === me.pid ?
      '<button class="btn" id="next">' + (last ? 'Voir le classement final' : 'Épreuve suivante') + '</button>' :
      '<div class="note">' + esc(capName()) + ' passe à la suite</div>';
    if (!setView('rev|' + S.round, '<div class="ph">' + topbar() + verdict + extra + rankingRows(true) + '<div class="grow"></div>' + ctrl + '</div>')) return;
    on('next', 'click', function () { send({ t: 'cmd', cmd: 'next' }); });
  }

  function phoneFinal() {
    var S = C.S, rk = ranked(), pos = 1;
    for (var i = 0; i < rk.length; i++) if (rk[i].pid === me.pid) pos = i + 1;
    var ctrl = S.captain === me.pid ?
      '<button class="btn" id="again">Revanche</button><button class="btn ghost" id="lobby">Retour au salon</button>' :
      '<div class="note">' + esc(capName()) + ' choisit la suite</div>';
    if (!setView('fin|' + JSON.stringify(S.players), '<div class="ph"><div class="verdict ' + (pos === 1 ? 'ok' : 'ko') + '"><span>Partie terminée</span><span class="big">' +
      (pos === 1 ? 'Tu gagnes !' : 'Tu termines ' + ord(pos)) + '</span></div>' + rankingRows(false) + '<div class="grow"></div>' + ctrl +
      '<button class="linkbtn" id="quit">Quitter la partie</button></div>')) return;
    on('again', 'click', function () { send({ t: 'cmd', cmd: 'rematch' }); });
    on('lobby', 'click', function () { send({ t: 'cmd', cmd: 'lobby' }); });
    on('quit', 'click', leave);
  }

  // ================= TÉLÉ =================
  function sizeTv() {
    var fs = Math.min(window.innerWidth / 80, window.innerHeight / 45);
    document.documentElement.style.fontSize = fs + 'px';
  }

  function renderTv() {
    var S = C.S;
    if (S.phase === 'lobby') return tvLobby();
    if (S.phase === 'draw') return tvDraw();
    if (S.phase === 'question') return tvQuestion();
    if (S.phase === 'vote') return tvVote();
    if (S.phase === 'reveal') return tvReveal();
    if (S.phase === 'final') return tvFinal();
  }

  function tvLobby() {
    var S = C.S, st = S.settings;
    var key = 'tlobby|' + JSON.stringify([S.players, S.captain, st]);
    var rows = S.players.map(function (p) {
      return '<div class="prow2">' + avR(p, 3.4) + '<span style="flex:1">' + esc(p.name) + '</span>' +
        (p.pid === S.captain ? '<span class="chip" style="font-size:1rem">capitaine</span>' : '') + '</div>';
    }).join('');
    if (S.players.length < 4) rows += '<div class="prow2 empty"><span class="av ghost" style="width:3.4rem;height:3.4rem"></span>En attente des joueurs…</div>';
    var chips = '<span class="chip">' + st.count + ' épreuves</span>' +
      st.games.map(function (g) { return '<span class="chip">' + esc(gameName(g)) + '</span>'; }).join('') +
      (st.finale ? '<span class="chip">Finale ×2</span>' : '');
    var who = S.captain ? esc(capName()) + ' lance la partie depuis son téléphone' : 'Le premier joueur arrivé lancera la partie';
    var tiles = C.code.split('').map(function (c) { return '<span>' + c + '</span>'; }).join('');
    setView(key, '<div class="tvw"><div class="lobby"><div class="l">' +
      '<div><p class="brand-k">Soirée jeux</p><h1 class="brand">Soirée Canapé</h1></div>' +
      '<div class="qrrow"><div class="qr">' + qrSvg(joinUrl()) + '</div><div style="display:flex;flex-direction:column;gap:1rem">' +
      '<div style="font-size:1.7rem;font-weight:600">Scannez avec votre téléphone</div>' +
      '<div class="muted" style="font-size:1.25rem">ou ouvrez ' + esc(location.host) + ' et entrez le code</div><div class="tiles">' + tiles + '</div></div></div></div>' +
      '<div class="players"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.4rem"><h2 class="display" style="margin:0;font-size:2.4rem">Joueurs</h2>' +
      '<span class="muted" style="font-size:1.4rem">' + S.players.length + ' / 6</span></div>' + rows +
      '<div style="margin-top:auto;display:flex;flex-direction:column;gap:1rem"><div style="display:flex;gap:.6rem;flex-wrap:wrap">' + chips + '</div>' +
      '<div class="muted" style="font-size:1.25rem">' + who + '</div></div></div></div></div>');
  }

  function tvBar(withRing, sub) {
    var S = C.S, cur = S.cur;
    return '<div class="tbar"><div class="l"><span class="chip accent">' + esc(gameName(cur.g)) + '</span>' + (sub ? '<span class="chip">' + esc(sub) + '</span>' : '') +
      '<span class="muted">Épreuve ' + S.round + ' / ' + S.deck.length + '</span>' + x2chip() + '</div>' +
      (withRing ? '<div class="ring" data-ring><span data-sec></span></div>' : '') + '</div>';
  }

  function tvDraw() {
    var S = C.S, g = S.deck[S.round - 1];
    setView('tdraw|' + S.round, '<div class="tvw"><div class="drawc"><span class="k">Épreuve ' + S.round + ' / ' + S.deck.length + '</span>' +
      '<span class="g">' + esc(gameName(g)) + '</span>' + (S.mult > 1 ? '<span><span class="chip x2">Finale : points doubles</span></span>' : '') + '</div></div>');
  }

  function tvWho(label) {
    var ans = answeredSet();
    return '<span class="muted">' + (label || 'Ont répondu') + '</span>' + C.S.players.map(function (p) {
      var ok = ans[p.pid];
      return '<span class="who-it' + (ok ? '' : ' off') + '">' + avR(p, 2.8, !ok) + esc(p.name) + '</span>';
    }).join('');
  }

  function tvQuestion() {
    var S = C.S, cur = S.cur, body = '';
    if (cur.g === 'culture') {
      body = '<div class="grid2">' + cur.c.map(function (t, i) {
        return '<div class="opt"><span class="letter">' + LETTERS[i] + '</span><span class="t">' + esc(t) + '</span></div>';
      }).join('') + '</div>';
    } else if (cur.g === 'estimation') {
      body = '<div class="muted" style="font-size:1.8rem">Tapez un nombre sur votre téléphone' + (cur.u ? ' — réponse en ' + esc(cur.u) : '') + '</div>';
    } else if (cur.g === 'bluff') {
      body = '<div class="muted" style="font-size:1.8rem">Inventez une fausse réponse crédible sur votre téléphone</div>';
    } else if (cur.g === 'ordre') {
      body = '<div class="grid4">' + cur.items.map(function (it) {
        return '<div class="ocard"><span class="t">' + esc(it.t) + '</span></div>';
      }).join('') + '</div><div class="muted" style="font-size:1.4rem">Classez les cartes sur votre téléphone</div>';
    }
    setView('tq|' + S.round, '<div class="tvw">' + tvBar(true) + '<h1 class="q">' + esc(cur.q) + '</h1>' + body + '<div class="foot" id="who"></div></div>');
    $('who').innerHTML = tvWho();
  }

  function tvVote() {
    var S = C.S, cur = S.cur;
    var opts = (S.options || []).map(function (o, i) {
      return '<div class="opt"><span class="letter">' + LETTERS2[i] + '</span><span class="t">' + esc(o.text) + '</span></div>';
    }).join('');
    setView('tv|' + S.round, '<div class="tvw">' + tvBar(true, 'Votez !') + '<h1 class="q" style="font-size:2.6rem">' + esc(cur.q) + '</h1>' +
      '<div class="grid2 small">' + opts + '</div><div class="foot" id="who"></div></div>');
    $('who').innerHTML = tvWho('Ont voté');
  }

  function tvSide() {
    var res = C.S.result || {};
    return '<div class="side"><h3>Classement</h3>' + ranked().map(function (p, i) {
      var g = res[p.pid] && res[p.pid].pts ? '+' + res[p.pid].pts : '';
      return '<div class="srow"><span class="muted" style="width:1.6rem">' + (i + 1) + '</span>' + avR(p, 2.6) + '<span class="n">' + esc(p.name) + '</span><span class="g">' + g + '</span><span class="p">' + p.score + '</span></div>';
    }).join('') + '</div>';
  }

  function tvReveal() {
    var S = C.S, cur = S.cur, res = S.result || {}, body = '';
    if (cur.g === 'culture') {
      body = '<div class="grid2">' + cur.c.map(function (t, i) {
        var pickers = S.players.filter(function (p) { return res[p.pid] && res[p.pid].v === i; });
        return '<div class="opt ' + (i === cur.a ? 'good' : 'bad') + '"><span class="letter">' + LETTERS[i] + '</span><span class="t">' + esc(t) + '</span>' +
          '<span class="who">' + pickers.map(function (p) { return avR(p, 2.4); }).join('') + '</span></div>';
      }).join('') + '</div>';
    } else if (cur.g === 'estimation') {
      var unit = cur.u ? ' <span style="font-size:2rem">' + esc(cur.u) + '</span>' : '';
      var rows = S.players.slice().sort(function (a, b) {
        var ra = res[a.pid], rb = res[b.pid];
        var da = ra && ra.v != null ? ra.diff : Infinity, db = rb && rb.v != null ? rb.diff : Infinity;
        return da - db;
      }).map(function (p) {
        var r = res[p.pid] || {};
        return '<div class="erow">' + avR(p, 2.6) + '<span class="n">' + esc(p.name) + '</span><span class="v">' + (r.v == null ? '—' : esc(fmt(r.v))) + '</span>' +
          '<span class="d">' + (r.v == null ? 'pas de réponse' : (r.exact ? 'pile !' : 'écart ' + esc(fmt(r.diff)))) + '</span><span class="g">' + (r.pts ? '+' + r.pts : '') + '</span></div>';
      }).join('');
      body = '<div><div class="muted" style="font-size:1.4rem;margin-bottom:.6rem">Bonne réponse</div><div class="truth">' + esc(fmt(cur.a)) + unit + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:.7rem">' + rows + '</div>';
    }
    else if (cur.g === 'bluff') {
      body = '<div class="grid2 small">' + (S.options || []).map(function (o, i) {
        var voters = S.players.filter(function (p) { return res[p.pid] && res[p.pid].voted === o.id; });
        var liar = o.by ? findP(o.by) : null;
        var tag = o.by === null ? '<span class="truthtag">La vérité</span>' :
          '<span class="liartag">' + (liar ? avR(liar, 1.8) + 'mensonge de ' + esc(liar.name) : 'mensonge') + '</span>';
        return '<div class="opt col ' + (o.by === null ? 'good' : '') + '"><div style="display:flex;align-items:center;gap:1rem"><span class="letter">' + LETTERS2[i] + '</span><span class="t">' + esc(o.text) + '</span></div>' +
          '<div class="meta">' + tag + '<span class="who">' + voters.map(function (p) { return avR(p, 2); }).join('') + '</span></div></div>';
      }).join('') + '</div>';
    } else if (cur.g === 'ordre') {
      var rows = S.players.map(function (p) {
        var r = res[p.pid] || {};
        var marks = cur.order.map(function (k, pos) { return '<i class="' + (r.v && r.v[pos] === k ? 'on' : '') + '"></i>'; }).join('');
        return '<div class="erow">' + avR(p, 2.6) + '<span class="n">' + esc(p.name) + '</span><span class="marks">' + marks + '</span>' +
          '<span class="d">' + (r.v ? r.good + ' / ' + cur.order.length : 'pas de réponse') + '</span><span class="g">' + (r.pts ? '+' + r.pts : '') + '</span></div>';
      }).join('');
      body = '<div class="grid4">' + cur.order.map(function (k, pos) {
        return '<div class="ocard good"><span class="num">' + (pos + 1) + '</span><span class="t">' + esc(cur.items[k].t) + '</span>' + (cur.vals[k] ? '<span class="v">' + esc(cur.vals[k]) + '</span>' : '') + '</div>';
      }).join('') + '</div><div style="display:flex;flex-direction:column;gap:.6rem">' + rows + '</div>';
    }
    var next = S.round >= S.deck.length ? 'le classement final' : 'l\'épreuve suivante';
    setView('trev|' + S.round, '<div class="tvw"><div class="split"><div style="flex:1;display:flex;flex-direction:column;gap:1.6rem;min-width:0">' + tvBar(false) +
      '<h1 class="q" style="font-size:2.4rem">' + esc(cur.q) + '</h1>' + body +
      '<div class="foot muted">' + esc(capName()) + ' lance ' + next + ' depuis son téléphone</div></div>' + tvSide() + '</div></div>');
  }

  function tvFinal() {
    var S = C.S, rk = ranked(), n = rk.length;
    var html = '';
    // révélation à l'envers : du dernier au premier
    for (var i = n - 1; i >= 0; i--) {
      var p = rk[i], delay = (n - 1 - i) * 1.6;
      html += '<div class="pod' + (i === 0 ? ' first' : '') + '" style="animation-delay:' + delay + 's"><span class="rk">' + (i + 1) + '</span>' + avR(p, i === 0 ? 4.4 : 3.2) +
        '<span class="n">' + esc(p.name) + '</span><span class="s">' + p.score + ' pts</span></div>';
    }
    var conf = '', start = n * 1.6;
    for (var k = 0; k < 40; k++) {
      conf += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + COLORS[k % COLORS.length] + ';animation-delay:' + (start + Math.random() * 3).toFixed(2) + 's"></i>';
    }
    setView('tfin|' + JSON.stringify(S.players), '<div class="tvw"><h1 class="display" style="margin:0;font-size:3.4rem;text-align:center">Classement final</h1>' +
      '<div class="podium">' + html + '</div><div class="muted" style="text-align:center;font-size:1.3rem">' + esc(capName()) + ' choisit : revanche ou retour au salon</div></div>' +
      '<div class="confetti">' + conf + '</div>');
  }

  // ================= ACCUEIL =================
  function showHome() {
    document.body.className = 'phone';
    C.view = 'home';
    app.innerHTML = '<div class="ph"><div style="margin-top:6vh"><h1 class="title" style="font-size:46px">Soirée Canapé</h1><div class="muted" style="margin-top:8px">Le jeu de soirée de la famille</div></div>' +
      '<div class="grow"></div>' +
      '<div class="stack"><label class="label" for="code">Rejoindre une partie</label><input id="code" class="input code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters">' +
      '<button class="btn" id="join">Rejoindre</button></div>' +
      '<div class="stack" style="margin-top:14px"><button class="btn ghost col" id="mk"><span>Créer une partie ici</span><span class="sub">Sans télé : ce téléphone sert de plateau</span></button>' +
      '<button class="btn ghost col" id="tvb"><span>Ouvrir l\'écran télé</span><span class="sub">À lancer depuis le navigateur de la télé</span></button></div></div>';
    function go() {
      var c = $('code').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (c.length !== 4) { $('code').focus(); return; }
      openJoin(c);
    }
    on('join', 'click', go);
    on('code', 'keydown', function (e) { if (e.key === 'Enter') go(); });
    on('mk', 'click', function () { createRoom(false); });
    on('tvb', 'click', function () { location.href = location.pathname + '?tv'; });
    fit();
  }

  function showClosed(by) {
    lsDel('sc_sess');
    var ch = C.ch;
    C.ch = null;
    if (ch) { try { sb.removeChannel(ch); } catch (e) {} }
    clearInterval(C.helloTimer);
    document.body.className = 'phone';
    C.view = 'closed';
    app.innerHTML = '<div class="ph"><h1 class="title">Partie terminée</h1><div class="note">' +
      (by ? esc(by) + ' a arrêté la partie.' : 'La partie a été arrêtée.') + '</div><div class="grow"></div>' +
      '<button class="btn" id="home">Retour à l\'accueil</button></div>';
    on('home', 'click', function () { location.href = location.pathname; });
  }

  function showError(msg) {
    document.body.className = 'phone';
    C.view = 'err';
    app.innerHTML = '<div class="ph"><h1 class="title">Oups</h1><div class="note">' + esc(msg) + '</div><div class="grow"></div><button class="btn" id="home">Retour à l\'accueil</button></div>';
    on('home', 'click', function () { location.href = location.pathname; });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  init();
})();
