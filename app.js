// Dé-lire — interface (télé + téléphones) et synchronisation Supabase.
(function () {
  'use strict';

  var SB_URL = 'https://qsyrrcrknxdkdsxkoooa.supabase.co';
  var SB_KEY = 'sb_publishable_whJtaOQEsL6Q1YqsxtLU5w_mLhX3Ocz';
  var COLORS = ['#F6C90E', '#E94F37', '#3F88C5', '#44BBA4', '#F28CB8', '#9B7BD4'];
  var COLOR_NAMES = ['Jaune', 'Rouge', 'Bleu', 'Vert', 'Rose', 'Violet'];
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
    app.innerHTML = '<div class="ph"><h1 class="title">Dé-lire</h1><div class="grow"></div>' +
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
    loadSeason();
    connect();
    if (C.engine) C.engine.publish(false);
    else if (state) {
      var rem = 0;
      if (state.phase === 'question' && state.cur) rem = state.cur.deadline - Date.now();
      if (state.phase === 'draw') rem = state.drawUntil - Date.now();
      onState({ s: SCEngine.publicView(state), rem: Math.max(0, rem) });
    }
  }

  // ---------- banque, signalements, saison ----------
  var DATA = { played: {}, reports: {}, season: null };
  var PREFIX = { culture: 'cg', estimation: 'es', bluff: 'bl', ordre: 'or', pyramide: 'py', croquis: 'cq',
    imposteur: 'im', rebus: 'rb', petitbac: 'pb', reflexe: 'rx', memoire: 'me', geo: 'geo', chrono: 'ch' };
  // jeux sans vraie banque de questions (générés à la volée) : pas listés dans « Banque de questions »
  var GENERATED = { petitbac: 1, reflexe: 1, memoire: 1, chrono: 1 };
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function loadPlayed(cb) {
    sb.from('played').select('qid').then(function (r) {
      var o = {};
      (r.data || []).forEach(function (x) { o[x.qid] = true; });
      DATA.played = o;
      if (cb) cb();
    });
  }
  function loadReports(cb) {
    sb.from('reports').select('qid').then(function (r) {
      var o = {};
      (r.data || []).forEach(function (x) { o[x.qid] = true; });
      DATA.reports = o;
      if (cb) cb();
    });
  }

  function seasonStart(cfg) {
    var d = new Date(), start;
    if (cfg.dur === 'all') start = new Date(0);
    else if (cfg.dur === '3m') start = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    else start = new Date(d.getFullYear(), d.getMonth(), 1);
    if (cfg.resetAt && Date.parse(cfg.resetAt) > start.getTime()) start = new Date(cfg.resetAt);
    return start;
  }
  function seasonLabel(cfg) {
    var d = new Date();
    if (cfg.dur === 'all') return 'Depuis le début';
    if (cfg.dur === '3m') return 'Trimestre de ' + MONTHS[Math.floor(d.getMonth() / 3) * 3] + ' à ' + MONTHS[Math.floor(d.getMonth() / 3) * 3 + 2];
    return 'Saison de ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function loadSeason(cb) {
    sb.from('meta').select('value').eq('key', 'season').maybeSingle().then(function (m) {
      var cfg = (m && m.data && m.data.value) || { dur: '1m' };
      sb.from('games').select('finished_at, players').then(function (r) {
        var from = seasonStart(cfg).getTime(), rows = {};
        (r.data || []).forEach(function (g) {
          if (Date.parse(g.finished_at) < from) return;
          var ps = g.players || [], max = Math.max.apply(null, ps.map(function (p) { return p.score; }).concat([0]));
          ps.forEach(function (p) {
            var k = String(p.name || '').toLowerCase();
            var row = rows[k] || (rows[k] = { name: p.name, color: p.color, wins: 0, games: 0, pts: 0, best: 0 });
            row.games++; row.pts += p.score; row.color = p.color;
            if (p.score > row.best) row.best = p.score;
            if (p.score === max && max > 0) row.wins++;
          });
        });
        var list = Object.keys(rows).map(function (k) { return rows[k]; })
          .sort(function (a, b) { return b.wins - a.wins || b.pts - a.pts; });
        DATA.season = { cfg: cfg, rows: list, label: seasonLabel(cfg), stamp: Date.now(), games: (r.data || []).filter(function (g) { return Date.parse(g.finished_at) >= from; }).length };
        if (cb) cb();
        if (C.S && (C.tv || C.screen === 'season')) { C.view = ''; render(); }
      });
    });
  }

  function makeEngine(code, state, hasTv) {
    var persistT = null;
    loadPlayed(); loadReports();
    setInterval(function () { if (C.S && C.S.phase === 'lobby') { loadPlayed(); loadReports(); } }, 30000);
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
        DATA.played[id] = true;
        sb.from('played').upsert({ qid: id }, { ignoreDuplicates: true }).then(function () {});
      },
      getPlayed: function () { return DATA.played; },
      getExcluded: function () { return DATA.reports; },
      recordGame: function (players) {
        sb.from('games').insert({ code: code, players: players }).then(function () { loadSeason(); });
      }
    });
  }

  // ---------- temps réel ----------
  function connect() {
    var ch = sb.channel('sc-' + C.code, { config: { broadcast: { self: false } } });
    C.ch = ch;
    if (C.engine) ch.on('broadcast', { event: 'p' }, function (m) { C.engine.handle(m.payload); });
    else ch.on('broadcast', { event: 's' }, function (m) { onState(m.payload); });
    ch.on('broadcast', { event: 'd' }, function (m) { onDraw(m.payload, false); });
    ch.on('broadcast', { event: 'dfull' }, function (m) { onDraw(m.payload, true); });
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

  setInterval(function () {
    if (C.code && C.S && !C.tv && findP(me.pid) && C.S.phase !== 'closed') send({ t: 'ping' });
  }, 8000);

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
    // un plateau resté sur une ancienne version peut encore annoncer un jeu supprimé
    if (S.settings && S.settings.games) S.settings.games = S.settings.games.filter(function (g) { return GAMES[g]; });
    var prevS = C.S;
    C.S = S;
    sfxState(prevS, S);
    C.endAt = Date.now() + (p.rem || 0);
    C.gotFresh = true;
    C.silent = 0;
    if (C.ready) netEl.hidden = true;
    if (S.round !== C.myRound) { C.myRound = S.round; C.myAns = null; C.myVote = null; C.lieSent = false; C.rejN = 0; C.ordre = null; C.pick = null; C.dragging = false; }
    if (S.phase === 'closed' && !C.engine) return showClosed(S.closedBy);
    render();
  }

  // ---------- sons (synthétisés par le navigateur : aucun fichier à charger) ----------
  var SFX = { ctx: null, noise: null };
  function audio() {
    if (SFX.ctx) return SFX.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { SFX.ctx = new AC(); } catch (e) { return null; }
    return SFX.ctx;
  }
  // les téléphones n'autorisent le son qu'après un premier toucher
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { var a = audio(); if (a && a.state === 'suspended' && a.resume) a.resume(); }, true);
  });
  function tone(f, at, dur, o) {
    o = o || {};
    var a = audio();
    if (!a) return;
    var t = a.currentTime + at, osc = a.createOscillator(), g = a.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var v = (o.vol || 0.16) * (C.tv ? 1 : 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(a.destination);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function hiss(at, dur, vol, from, to) {
    var a = audio();
    if (!a) return;
    if (!SFX.noise) {
      SFX.noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
      var d = SFX.noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t = a.currentTime + at, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = SFX.noise; src.loop = true;
    f.type = 'bandpass'; f.frequency.setValueAtTime(from || 800, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    var v = (vol || 0.12) * (C.tv ? 1 : 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start(t); src.stop(t + dur + 0.05);
  }
  var SOUNDS = {
    // tirage de l'épreuve : petit arpège montant
    draw: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.08, 0.2, { type: 'triangle', vol: 0.14 }); }); },
    // début de l'épreuve ou d'une nouvelle étape
    start: function () { tone(660, 0, 0.1, { type: 'square', vol: 0.05 }); tone(990, 0.09, 0.18, { type: 'square', vol: 0.05 }); },
    // les 5 dernières secondes
    tick: function () { tone(1250, 0, 0.05, { type: 'square', vol: 0.04 }); },
    // quelqu'un a répondu
    blip: function () { tone(700, 0, 0.09, { type: 'triangle', vol: 0.09, to: 1100 }); },
    // quelqu'un a trouvé (Croquis, Rébus)
    found: function () { [1047, 1319, 1568].forEach(function (f, i) { tone(f, i * 0.06, 0.14, { type: 'triangle', vol: 0.11 }); }); },
    good: function () { tone(784, 0, 0.14, { type: 'triangle' }); tone(1175, 0.11, 0.32, { type: 'triangle' }); },
    bad: function () { tone(230, 0, 0.32, { type: 'sawtooth', vol: 0.07, to: 120 }); },
    nope: function () { tone(330, 0, 0.12, { type: 'square', vol: 0.04, to: 240 }); },
    // révélation : roulement puis accord
    reveal: function () { hiss(0, 0.55, 0.1, 400, 2400); [523, 659, 784].forEach(function (f) { tone(f, 0.55, 0.45, { type: 'triangle', vol: 0.09 }); }); },
    go: function () { tone(1000, 0, 0.22, { type: 'square', vol: 0.1 }); },
    // classement final : fanfare
    final: function () {
      [[523, 0, 0.12], [523, 0.14, 0.12], [523, 0.28, 0.12], [698, 0.42, 0.5], [880, 0.95, 0.18], [784, 1.15, 0.18], [1047, 1.35, 0.8]].forEach(function (n) {
        tone(n[0], n[1], n[2], { type: 'triangle', vol: 0.15 });
      });
      hiss(1.35, 0.9, 0.06, 3000, 6000);
    }
  };
  function sfx(name) {
    if (C.S && C.S.settings && C.S.settings.sound === false) return;
    if (window.__sfxLog) window.__sfxLog.push(name); // pour les tests
    try { SOUNDS[name](); } catch (e) {}
  }
  // Sons déclenchés par les changements d'état. L'écran principal (télé, ou le téléphone
  // qui sert de plateau) fait l'ambiance ; chaque téléphone joue son propre résultat.
  function sfxState(prev, S) {
    if (!prev || !S) return;
    var board = C.tv || (!S.hasTv && !!C.engine);
    if (S.phase !== prev.phase || S.round !== prev.round) {
      if (S.phase === 'draw') { if (board) sfx('draw'); }
      else if (S.phase === 'question' || S.phase === 'vote') { if (board) sfx('start'); }
      else if (S.phase === 'reveal') {
        if (C.tv) sfx('reveal');
        else { var r = (S.result || {})[me.pid]; if (r) sfx(r.pts > 0 ? 'good' : 'bad'); }
      } else if (S.phase === 'final') {
        if (board) sfx('final');
        else if (ranked()[0] && ranked()[0].pid === me.pid) sfx('good');
      }
      return;
    }
    if (S.phase !== 'question' && S.phase !== 'vote') return;
    if (S.cur && prev.cur && S.cur.step !== prev.cur.step) { if (board) sfx('start'); return; }
    if (C.tv) {
      var f1 = prev.cur && prev.cur.found ? prev.cur.found.length : 0, f2 = S.cur && S.cur.found ? S.cur.found.length : 0;
      if (f2 > f1) sfx('found');
      else if ((S.answered || []).length > (prev.answered || []).length) sfx('blip');
    } else {
      var fb = (S.fb || {})[me.pid], pfb = (prev.fb || {})[me.pid];
      if (fb && (!pfb || fb.n !== pfb.n)) sfx(fb.res === 'ok' ? 'good' : 'nope');
    }
  }

  // ---------- chrono ----------
  setInterval(tickTimers, 200);
  function tickTimers() {
    if (!C.S) return;
    var left = Math.max(0, C.endAt - Date.now());
    var total = (C.S.cur && C.S.cur.time) || 1;
    var sec = Math.ceil(left / 1000), S = C.S, g = S.cur && S.cur.g;
    if ((C.tv || (!S.hasTv && C.engine)) && (S.phase === 'question' || S.phase === 'vote') && sec > 0 && sec <= 5 &&
      g !== 'chrono' && g !== 'reflexe' && !(g === 'memoire' && S.cur.step === 'show') && C.lastTick !== S.round + ':' + sec) {
      C.lastTick = S.round + ':' + sec;
      sfx('tick');
    }
    var i, els = document.querySelectorAll('[data-sec]');
    for (i = 0; i < els.length; i++) els[i].textContent = Math.ceil(left / 1000);
    els = document.querySelectorAll('[data-bar]');
    for (i = 0; i < els.length; i++) els[i].style.width = Math.min(100, left / total * 100) + '%';
    els = document.querySelectorAll('[data-ring]');
    for (i = 0; i < els.length; i++) els[i].style.setProperty('--p', Math.min(1, left / total));
  }

  // ---------- rendu ----------
  function boot(msg) { C.view = ''; app.innerHTML = '<div class="boot"><div style="text-align:center">Dé-lire<div class="muted" style="font-size:16px;font-family:var(--body);font-weight:500;margin-top:10px">' + esc(msg) + '</div></div></div>'; }

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
    if (C.tv || C.dragging) return;
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
    // pendant qu'on fait glisser une carte, on ne redessine pas l'écran (sinon la carte « fige »)
    if (C.dragging) { C.renderLater = true; return; }
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
    if (S.phase !== 'lobby') C.screen = null;
    if (S.phase === 'lobby' && C.screen) return phoneScreen();
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
      '<div><h1 class="title">Dé-lire</h1><div class="muted">Partie <b>' + esc(C.code) + '</b></div></div>' +
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
    goHome(900); // laisse le temps au message de partir avant de quitter la page
  }

  // Pyramide et Croquis se jouent à 2 minimum : on prévient au lieu de lancer autre chose.
  function startBlock(S) {
    var n = S.players.length, st = S.settings;
    var ok = st.games.filter(function (g) { return !GAMES[g].min || n >= GAMES[g].min; });
    var ko = st.games.filter(function (g) { return GAMES[g].min && n < GAMES[g].min; });
    var note = '';
    if (ko.length) {
      note = '<div class="note warn">' + ko.map(function (g) { return esc(GAMES[g].name); }).join(' et ') +
        (ko.length > 1 ? ' se jouent' : ' se joue') + ' à 2 joueurs minimum' + (ok.length ? ' : ' + (ko.length > 1 ? 'ils seront sautés' : 'il sera sauté') + '.' : '. Attends un autre joueur.') + '</div>';
    }
    return note + '<button class="btn" id="start"' + (ok.length ? '' : ' disabled') + '>Lancer la partie</button>';
  }

  function phoneLobby() {
    var S = C.S, cap = S.captain === me.pid, st = S.settings;
    var key = 'lobby|' + JSON.stringify([S.players, S.captain, st]);
    var tf = st.teams ? SCEngine.teamsFor(S.players, st.teamOf) : null;
    var chips = S.players.map(function (p) {
      var tag = p.pid === S.captain ? 'capitaine' : (p.pid === me.pid ? 'toi' : '');
      if (p.pid === S.captain && p.pid === me.pid) tag = 'toi · capitaine';
      if (tf) tag = 'Équipe ' + 'AB'.charAt(tf[p.pid]) + (tag ? ' · ' + tag : '');
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
      var nG = Object.keys(GAMES).length;
      settings = '<div class="card stack" style="gap:12px">' +
        '<div class="setrow"><span class="label">Épreuves</span><div class="seg grow" id="seg">' + seg + '</div></div>' +
        '<div class="gsum"><span>' + (st.games.length === nG ? 'Les ' + nG + ' jeux' : st.games.length + ' jeu' + (st.games.length > 1 ? 'x' : '') + ' sur ' + nG) + '</span>' +
        '<button type="button" class="tog" id="pickg">Choisir les jeux</button></div>' +
        '<div class="toggles" id="games"><button type="button" class="tog' + (st.finale ? ' on' : '') + '" data-f="1" aria-pressed="' + st.finale + '">Finale ×2</button>' +
        '<button type="button" class="tog' + (st.teams ? ' on' : '') + '" data-t="1">2 équipes</button>' +
        (st.teams ? '<button type="button" class="tog" id="compo">Composer</button>' : '') + '</div></div>';
    } else {
      settings = '<div class="note">C\'est ' + esc(capName()) + ' qui lance la partie</div>';
    }
    if (!setView(key, '<div class="ph">' +
      '<div class="hd"><div><h1 class="title" style="font-size:28px">Dé-lire</h1><div class="muted" style="font-size:14px">' + S.players.length + ' joueur' + (S.players.length > 1 ? 's' : '') + ' dans la partie</div></div>' +
      '<span class="codepill">' + esc(C.code) + '</span></div>' +
      qr + '<div class="pgrid">' + chips + '</div>' + settings +
      '<div class="grow"></div>' +
      (cap ? startBlock(S) : '') +
      '<div class="pills">' + (cap ? '<button type="button" id="cfg">Réglages</button>' : '') + '<button type="button" id="season">Saison</button>' +
      '<button type="button" id="edit">Profil</button><button type="button" id="quit">Quitter</button></div></div>')) return;
    on('cfg', 'click', function () { C.screen = 'settings'; C.view = ''; render(); });
    on('pickg', 'click', function () { C.screen = 'games'; C.view = ''; render(); });
    on('season', 'click', function () { C.screen = 'season'; C.view = ''; loadSeason(); render(); });

    on('seg', 'click', function (e) {
      var n = e.target.getAttribute && e.target.getAttribute('data-n');
      if (!n) return;
      send({ t: 'cmd', cmd: 'settings', settings: { count: Number(n), games: st.games, finale: st.finale } });
    });
    on('games', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var s = { count: st.count, games: st.games.slice(), finale: st.finale };
      if (b.id === 'compo') { C.screen = 'teams'; C.view = ''; render(); return; }
      if (b.getAttribute('data-t')) { var nt = JSON.parse(JSON.stringify(st)); nt.teams = !st.teams; send({ t: 'cmd', cmd: 'settings', settings: nt }); return; }
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

  function seg(id, items, cur) {
    return '<div class="seg" id="' + id + '">' + items.map(function (it) {
      return '<button type="button" data-v="' + it[0] + '" class="' + (String(cur) === String(it[0]) ? 'on' : '') + '">' + it[1] + '</button>';
    }).join('') + '</div>';
  }

  function phoneScreen() {
    if (C.screen === 'settings' && C.S.captain === me.pid) return phoneSettings();
    if (C.screen === 'games' && C.S.captain === me.pid) return phoneGames();
    if (C.screen === 'teams' && C.S.captain === me.pid) return phoneTeams();
    if (C.screen === 'questions' && C.S.captain === me.pid) return phoneQuestions();
    if (C.screen === 'season') return phoneSeason();
    C.screen = null;
    return phoneLobby();
  }

  function screenHead(title) {
    return '<div class="hd"><h1 class="title" style="font-size:26px">' + esc(title) + '</h1><button type="button" class="qx" id="back" aria-label="Retour">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button></div>';
  }

  function backToLobby() { C.screen = null; C.view = ''; render(); }

  function phoneSettings() {
    var st = C.S.settings;
    if (!setView('settings|' + JSON.stringify(st), '<div class="ph">' + screenHead('Réglages de la partie') +
      '<div class="setgrid">' +
      '<span class="label">Mode</span>' + seg('s-mode', [['zapping', 'Zapping'], ['manches', 'Par manches']], st.mode || 'zapping') +
      '<span class="label">Épreuves</span>' + seg('s-count', [[10, '10'], [15, '15'], [25, '25'], [40, '40']], st.count) +
      '<span class="label">Rythme</span>' + seg('s-pace', [['calme', 'Calme'], ['normal', 'Normal'], ['rapide', 'Rapide']], st.pace || 'normal') +
      '<span class="label">Difficulté</span>' + seg('s-diff', [['facile', 'Facile'], ['mixte', 'Mixte'], ['difficile', 'Difficile']], st.diff || 'mixte') +
      '</div>' +
      '<div class="toggles"><button type="button" class="tog' + (st.finale ? ' on' : '') + '" id="s-fin">Finale ×2</button>' +
      '<button type="button" class="tog' + (st.teams ? ' on' : '') + '" id="s-teams">2 équipes</button>' +
      (st.teams ? '<button type="button" class="tog" id="s-compo">Composer les équipes</button>' : '') +
      '<button type="button" class="tog' + (st.sound !== false ? ' on' : '') + '" id="s-sound">Sons</button></div>' +
      '<button class="btn ghost small" id="topick">Choisir les jeux et leur fréquence</button>' +
      '<div class="grow"></div><button class="btn ghost small" id="toq">Banque de questions</button><button class="btn" id="done">Valider</button></div>')) return;
    function upd(patch) {
      var n = JSON.parse(JSON.stringify(st));
      for (var k in patch) n[k] = patch[k];
      send({ t: 'cmd', cmd: 'settings', settings: n });
    }
    function bindSeg(id, fn) {
      on(id, 'click', function (e) { var v = e.target.getAttribute && e.target.getAttribute('data-v'); if (v != null) fn(v); });
    }
    bindSeg('s-mode', function (v) { upd({ mode: v }); });
    bindSeg('s-count', function (v) { upd({ count: Number(v) }); });
    bindSeg('s-pace', function (v) { upd({ pace: v }); });
    bindSeg('s-diff', function (v) { upd({ diff: v }); });
    on('topick', 'click', function () { C.screen = 'games'; C.view = ''; render(); });
    on('s-fin', 'click', function () { upd({ finale: !st.finale }); });
    on('s-teams', 'click', function () { upd({ teams: !st.teams }); });
    on('s-compo', 'click', function () { C.screen = 'teams'; C.view = ''; render(); });
    on('s-sound', 'click', function () { upd({ sound: st.sound === false }); });
    on('toq', 'click', function () { C.screen = 'questions'; C.view = ''; loadPlayed(function () { loadReports(render); }); render(); });
    on('done', 'click', backToLobby);
    on('back', 'click', backToLobby);
  }

  // Composition des équipes : toucher un joueur le fait changer d'équipe
  function phoneTeams() {
    var S = C.S, st = S.settings, tf = SCEngine.teamsFor(S.players, st.teamOf);
    function col(t) {
      return '<div class="tcol t' + t + '"><b>Équipe ' + 'AB'.charAt(t) + '</b>' + S.players.filter(function (p) { return tf[p.pid] === t; }).map(function (p) {
        return '<button type="button" class="prow tp" data-p="' + p.pid + '">' + av(p, 30) + '<span class="n">' + esc(p.name) + '</span></button>';
      }).join('') + '</div>';
    }
    if (!setView('teams|' + JSON.stringify([tf, S.players.length]), '<div class="ph">' + screenHead('Les équipes') +
      '<div class="muted" style="font-size:13px;margin-top:-6px">Touche un joueur pour le changer d\'équipe. Les nouveaux arrivants rejoignent l\'équipe la plus petite.</div>' +
      '<div class="tcols" id="tcols">' + col(0) + col(1) + '</div><div class="grow"></div>' +
      '<div class="duo-btns"><button class="btn ghost" id="tmix">Mélanger</button><button class="btn" id="done">Valider</button></div></div>')) return;
    function save(map) {
      var nx = JSON.parse(JSON.stringify(st));
      nx.teamOf = map;
      send({ t: 'cmd', cmd: 'settings', settings: nx });
    }
    on('tcols', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var map = {};
      S.players.forEach(function (p) { map[p.pid] = tf[p.pid]; });
      var pid = b.getAttribute('data-p');
      map[pid] = 1 - map[pid];
      save(map);
    });
    on('tmix', 'click', function () {
      var ids = S.players.map(function (p) { return p.pid; }), map = {};
      for (var i = ids.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = ids[i]; ids[i] = ids[j]; ids[j] = x; }
      ids.forEach(function (pid, i) { map[pid] = i % 2; });
      save(map);
    });
    on('done', 'click', backToLobby);
    on('back', 'click', backToLobby);
  }

  // Choix des jeux : toucher une tuile fait défiler Normal → Beaucoup → Peu → Désactivé
  var FREQ_LABEL = ['Peu', 'Normal', 'Beaucoup'];
  function phoneGames() {
    var st = C.S.settings, freq = st.freq || {}, n = C.S.players.length;
    var tiles = Object.keys(GAMES).map(function (g) {
      var onG = st.games.indexOf(g) >= 0, f = freq[g] != null ? freq[g] : 1, min = GAMES[g].min;
      var lab = onG ? FREQ_LABEL[f] : 'Désactivé';
      if (min && n < min) lab += ' · dès ' + min;
      return '<button type="button" class="gtile ' + (onG ? 'f' + f : 'off') + '" data-g="' + g + '"><b>' + esc(GAMES[g].name) + '</b><span>' + lab + '</span></button>';
    }).join('');
    if (!setView('games|' + JSON.stringify([st.games, st.freq, n]), '<div class="ph">' + screenHead('Les jeux') +
      '<div class="muted" style="font-size:13px;margin-top:-6px">Touche un jeu : Normal → Beaucoup → Peu → Désactivé. Avec ' + st.count + ' épreuves, tous les jeux ne sortiront pas à chaque partie.</div>' +
      '<div class="gtiles" id="gtiles">' + tiles + '</div><div class="grow"></div>' +
      '<div class="duo-btns"><button class="btn ghost" id="gall">Tout activer</button><button class="btn" id="done">Valider</button></div></div>')) return;
    function upd(games, f) {
      var nx = JSON.parse(JSON.stringify(st));
      nx.games = games; nx.freq = f;
      send({ t: 'cmd', cmd: 'settings', settings: nx });
    }
    on('gtiles', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var g = b.getAttribute('data-g'), games = st.games.slice(), f = JSON.parse(JSON.stringify(freq)), i = games.indexOf(g);
      var cur = f[g] != null ? f[g] : 1;
      if (i < 0) { games.push(g); f[g] = 1; }
      else if (cur === 1) f[g] = 2;
      else if (cur === 2) f[g] = 0;
      else { if (games.length === 1) return; games.splice(i, 1); f[g] = 1; }
      upd(games, f);
    });
    on('gall', 'click', function () {
      var f = {};
      Object.keys(GAMES).forEach(function (g) { f[g] = 1; });
      upd(Object.keys(GAMES), f);
    });
    on('done', 'click', backToLobby);
    on('back', 'click', backToLobby);
  }

  function qLabel(g, q) {
    if (g === 'pyramide' || g === 'croquis' || g === 'geo') return q.a;
    if (g === 'imposteur') return q.a.join(' / ');
    if (g === 'rebus') return q.e + ' ' + q.a;
    return q.q;
  }

  function phoneQuestions() {
    var rows = Object.keys(GAMES).filter(function (g) { return !GENERATED[g]; }).map(function (g) {
      var all = (QUESTIONS[g] || []).filter(function (q) { return !DATA.reports[q.id]; });
      var done = all.filter(function (q) { return DATA.played[q.id]; }).length;
      var pct = all.length ? Math.round(done / all.length * 100) : 0;
      return '<div class="qrow"><div class="rowx" style="font-size:15px"><b style="color:var(--ink)">' + esc(GAMES[g].name) + '</b><span>' + done + ' / ' + all.length + ' joués</span></div>' +
        '<div class="gauge"><i style="width:' + pct + '%"></i></div>' + (done ? '<button type="button" class="linkbtn small" data-reset="' + g + '">Remettre à zéro</button>' : '') + '</div>';
    }).join('');
    var reps = [];
    Object.keys(GAMES).forEach(function (g) {
      (QUESTIONS[g] || []).forEach(function (q) { if (DATA.reports[q.id]) reps.push({ id: q.id, t: qLabel(g, q), g: g }); });
    });
    var repHtml = reps.length ? reps.map(function (r) {
      return '<div class="prow"><span class="n" style="font-size:14px;white-space:normal">' + esc(r.t) + '</span><button type="button" class="tog" data-restore="' + r.id + '">Rétablir</button></div>';
    }).join('') : '<div class="muted" style="font-size:14px">Aucune question signalée.</div>';
    if (!setView('questions|' + JSON.stringify([Object.keys(DATA.played).length, Object.keys(DATA.reports)]), '<div class="ph">' + screenHead('Banque de questions') +
      '<div class="stack" id="qrows" style="gap:10px">' + rows + '</div>' +
      '<span class="label">Questions signalées</span><div class="stack" id="reps" style="gap:6px">' + repHtml + '</div>' +
      '<div class="grow"></div><button class="btn" id="done">Retour aux réglages</button></div>')) return;
    on('qrows', 'click', function (e) {
      var g = e.target.getAttribute && e.target.getAttribute('data-reset');
      if (!g || !window.confirm('Remettre à zéro les questions déjà jouées de « ' + GAMES[g].name + ' » ?')) return;
      sb.from('played').delete().like('qid', PREFIX[g] + '%').then(function () {
        Object.keys(DATA.played).forEach(function (id) { if (id.indexOf(PREFIX[g]) === 0) delete DATA.played[id]; });
        C.view = ''; render();
      });
    });
    on('reps', 'click', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-restore');
      if (!id) return;
      sb.from('reports').delete().eq('qid', id).then(function () { delete DATA.reports[id]; C.view = ''; render(); });
    });
    on('done', 'click', function () { C.screen = 'settings'; C.view = ''; render(); });
    on('back', 'click', function () { C.screen = 'settings'; C.view = ''; render(); });
  }

  function seasonList(se) {
    if (!se) return '<div class="muted">Chargement…</div>';
    if (!se.rows.length) return '<div class="note">Aucune partie terminée pour l\'instant. La première victoire est à prendre !</div>';
    return '<div class="muted" style="font-size:13px">' + se.games + ' partie' + (se.games > 1 ? 's' : '') + ' jouée' + (se.games > 1 ? 's' : '') + ' cette saison</div>' + se.rows.map(function (r, i) {
      return '<div class="prow"><span class="muted" style="width:22px;font-weight:700">' + (i + 1) + '</span>' +
        '<span class="av" style="width:34px;height:34px;font-size:15px;background:' + COLORS[r.color || 0] + '">' + esc(String(r.name).charAt(0).toUpperCase()) + '</span>' +
        '<span class="n">' + esc(r.name) + '<span class="tag" style="display:block;font-size:12px;color:var(--muted);font-weight:600">' + r.games + ' partie' + (r.games > 1 ? 's' : '') +
        ' · moy. ' + Math.round(r.pts / r.games) + ' pts · record ' + r.best + '</span></span>' +
        '<span class="r">' + r.wins + ' <small style="font-size:12px;color:var(--muted)">vict.</small></span></div>';
    }).join('');
  }

  function phoneSeason() {
    var se = DATA.season, cap = C.S.captain === me.pid;
    var list = seasonList(se);
    var ctrl = cap && se ? '<div class="stack" style="gap:8px"><span class="label">Durée d\'une saison</span>' + seg('s-dur', [['1m', '1 mois'], ['3m', '3 mois'], ['all', 'Sans fin']], se.cfg.dur || '1m') +
      '<button class="linkbtn small" id="sreset">Remettre la saison à zéro</button></div>' : '';
    if (!setView('season|' + (se ? se.stamp : ''), '<div class="ph">' + screenHead(se ? se.label : 'Saison') +
      '<div class="plist">' + list + '</div><div class="grow"></div>' + ctrl + '<button class="btn" id="done">Retour au salon</button></div>')) return;
    function saveCfg(cfg) {
      sb.from('meta').upsert({ key: 'season', value: cfg, updated_at: new Date().toISOString() }).then(function () { loadSeason(); });
    }
    on('s-dur', 'click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-v');
      if (v) saveCfg({ dur: v, resetAt: se.cfg.resetAt || null });
    });
    on('sreset', 'click', function () {
      if (window.confirm('Remettre le classement de la saison à zéro ?')) saveCfg({ dur: se.cfg.dur || '1m', resetAt: new Date().toISOString() });
    });
    on('done', 'click', backToLobby);
    on('back', 'click', backToLobby);
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
    if (C.S.cur.g === 'pyramide') return phonePyr();
    if (C.S.cur.g === 'croquis') return phoneCroquis();
    var G = C.S.cur.g;
    if (G === 'imposteur') return phoneImp();
    if (G === 'rebus') return phoneRebus();
    if (G === 'petitbac') return phoneBac();
    if (G === 'reflexe') return phoneReflexe();
    if (G === 'memoire') return phoneMemo();
    if (G === 'geo') return phoneGeo();
    if (G === 'chrono') return phoneChrono();
    var S = C.S, cur = S.cur, ans = answeredSet();
    var rej = (S.reject || {})[me.pid];
    var writes = cur.g === 'bluff';
    if (writes && rej && rej.n !== C.rejN) { C.rejN = rej.n; C.lieSent = false; }
    var done = writes ? (C.lieSent || ans[me.pid]) : (C.myAns != null || ans[me.pid]);
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
    } else if (writes) {
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
      (cur.g === 'ordre' ? 'Fais glisser les cartes, ou touche deux cartes pour les échanger' : 'Réponds avant la fin du chrono');
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
      return '<div class="oitem' + (C.pick === pos ? ' picked' : '') + '" data-pos="' + pos + '"><span class="letter">' + (pos + 1) + '</span><span class="t">' + esc(items[k].t) + '</span>' +
        '<svg class="grip" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></div>';
    }).join('');
  }

  // Glisser-déposer au doigt pour réordonner les cartes, ou toucher deux cartes pour les échanger.
  function bindDrag(list) {
    if (!list) return;
    var drag = null;
    function zoom() { var z = parseFloat(app.firstElementChild && app.firstElementChild.style.zoom); return z > 0 ? z : 1; }
    function redraw() { list.innerHTML = ordreItems(); }
    function finish(commit) {
      var d = drag;
      drag = null;
      C.dragging = false;
      if (!d) return;
      try { d.el.releasePointerCapture(d.id); } catch (err) {}
      if (!d.moved) {
        // simple toucher : sélection, puis échange avec la deuxième carte touchée
        if (C.pick == null) C.pick = d.from;
        else if (C.pick === d.from) C.pick = null;
        else { var a = C.ordre[C.pick]; C.ordre[C.pick] = C.ordre[d.from]; C.ordre[d.from] = a; C.pick = null; }
      } else if (commit) {
        var moved = C.ordre.splice(d.from, 1)[0];
        C.ordre.splice(d.to, 0, moved);
        C.pick = null;
      }
      redraw();
      if (C.renderLater) { C.renderLater = false; render(); }
    }
    list.addEventListener('pointerdown', function (e) {
      if (drag) return; // un seul doigt à la fois
      var el = e.target.closest ? e.target.closest('.oitem') : null;
      if (!el) return;
      e.preventDefault();
      var els = list.querySelectorAll('.oitem');
      var step = els.length > 1 ? els[1].getBoundingClientRect().top - els[0].getBoundingClientRect().top : el.getBoundingClientRect().height;
      var pos = Number(el.getAttribute('data-pos'));
      drag = { el: el, els: els, from: pos, to: pos, y: e.clientY, step: step || 60, id: e.pointerId, moved: false, z: zoom() };
      C.dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    list.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y, n = drag.els.length;
      if (!drag.moved && Math.abs(dy) < 8) return;
      if (!drag.moved) { drag.moved = true; drag.el.classList.add('drag'); }
      drag.to = Math.max(0, Math.min(n - 1, drag.from + Math.round(dy / drag.step)));
      drag.el.style.transform = 'translateY(' + (dy / drag.z) + 'px)';
      for (var j = 0; j < n; j++) {
        if (j === drag.from) continue;
        var shift = 0;
        if (drag.from < drag.to && j > drag.from && j <= drag.to) shift = -drag.step / drag.z;
        if (drag.from > drag.to && j < drag.from && j >= drag.to) shift = drag.step / drag.z;
        drag.els[j].style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      }
    });
    list.addEventListener('pointerup', function (e) { if (drag && e.pointerId === drag.id) finish(true); });
    list.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.id) finish(drag.moved); });
    list.addEventListener('lostpointercapture', function (e) { if (drag && e.pointerId === drag.id) finish(drag.moved); });
    // filet de sécurité : doigt relâché hors de la liste, appli mise en arrière-plan
    window.addEventListener('pointerup', function () { if (drag) finish(true); });
    window.addEventListener('blur', function () { if (drag) finish(false); });
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

  function teamTotals() {
    var S = C.S, t = [{ pts: 0, names: [] }, { pts: 0, names: [] }], any = false;
    S.players.forEach(function (p) { if (p.team === 0 || p.team === 1) { any = true; t[p.team].pts += p.score; t[p.team].names.push(p.name); } });
    return any ? t : null;
  }

  function teamLine() {
    var t = teamTotals();
    if (!t) return '';
    return '<div class="teams">' + t.map(function (x, i) {
      return '<div class="team t' + i + '"><span>Équipe ' + 'AB'.charAt(i) + '</span><b>' + x.pts + '</b><small>' + esc(x.names.join(', ')) + '</small></div>';
    }).join('') + '</div>';
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
    else if (cur.g === 'pyramide') {
      var giver = findP(cur.giver), partner = findP(cur.partner), word = wordOf(cur);
      var mine = cur.giver === me.pid || cur.partner === me.pid;
      verdict = '<div class="verdict ' + (cur.ok ? 'ok' : 'ko') + '"><span class="big">' + (cur.ok ? 'Trouvé !' : 'Raté') + '</span>' +
        '<span>' + esc(giver ? giver.name : '?') + ' → ' + esc(partner ? partner.name : '?') + (cur.n ? ' · annonce ' + cur.n + ' indice' + (cur.n > 1 ? 's' : '') : '') + '</span>' +
        (cur.ok && mine ? '<span style="font-weight:800;font-size:22px">+' + r.pts + '</span>' : '') +
        '<span' + (cur.ok ? '' : ' class="muted"') + '>Le mot : <b>' + esc(word) + '</b></span></div>';
    } else if (cur.g === 'croquis') {
      var w = wordOf(cur), drawer = findP(cur.drawer);
      if (cur.drawer === me.pid) {
        verdict = '<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big">' + (r.finders ? r.finders + ' joueur' + (r.finders > 1 ? 's ont' : ' a') + ' trouvé' : 'Personne n\'a trouvé') + '</span>' +
          (r.pts ? '<span style="font-weight:800;font-size:22px">+' + r.pts + '</span>' : '') + '<span>Le mot : <b>' + esc(w) + '</b></span></div>';
      } else {
        verdict = '<div class="verdict ' + (r.found ? 'ok' : 'ko') + '"><span class="big">' + (r.found ? 'Trouvé en ' + ord(r.rank + 1) + ' !' : 'Pas trouvé') + '</span>' +
          (r.pts ? '<span style="font-weight:800;font-size:22px">+' + r.pts + '</span>' : '') +
          '<span' + (r.found ? '' : ' class="muted"') + '>Le dessin de ' + esc(drawer ? drawer.name : '?') + ' : <b>' + esc(w) + '</b></span></div>';
      }
    }
    var nv = newVerdict(cur, r);
    if (nv) { verdict = nv[0]; extra = nv[1] || ''; }
    var last = S.round >= S.deck.length;
    var ctrl = S.captain === me.pid ?
      '<button class="btn" id="next">' + (last ? 'Voir le classement final' : 'Épreuve suivante') + '</button>' :
      '<div class="note">' + esc(capName()) + ' passe à la suite</div>';
    var reported = DATA.reports[cur.id];
    if (!setView('rev|' + S.round, '<div class="ph">' + topbar() + verdict + extra + teamLine() + rankingRows(true) + '<div class="grow"></div>' + ctrl +
      '<button class="linkbtn small" id="report"' + (reported ? ' disabled' : '') + '>' + (reported ? 'Question signalée ✓' : 'Signaler cette question') + '</button></div>')) return;
    on('next', 'click', function () { send({ t: 'cmd', cmd: 'next' }); });
    on('report', 'click', function () {
      DATA.reports[cur.id] = true;
      sb.from('reports').upsert({ qid: cur.id }, { ignoreDuplicates: true }).then(function () {});
      $('report').textContent = 'Question signalée ✓';
      $('report').disabled = true;
    });
  }

  function phoneFinal() {
    var S = C.S, rk = ranked(), pos = 1;
    for (var i = 0; i < rk.length; i++) if (rk[i].pid === me.pid) pos = i + 1;
    var ctrl = S.captain === me.pid ?
      '<div class="duo-btns"><button class="btn ghost" id="lobby">Salon</button><button class="btn" id="again">Revanche</button></div>' :
      '<div class="note">' + esc(capName()) + ' choisit la suite</div>';
    var mine = (S.titles || {})[me.pid] || [];
    var teams = teamTotals(), myP = findP(me.pid), head;
    if (teams) {
      var win = teams[0].pts === teams[1].pts ? -1 : (teams[0].pts > teams[1].pts ? 0 : 1);
      head = win < 0 ? 'Égalité parfaite !' : (myP && myP.team === win ? 'Ton équipe gagne !' : 'Ton équipe a perdu');
    } else head = pos === 1 ? 'Tu gagnes !' : 'Tu termines ' + ord(pos);
    var titles = mine.length ? '<div class="titles">' + mine.map(function (t) { return '<div class="ttl"><b>' + esc(t.name) + '</b><span>' + esc(t.why) + '</span></div>'; }).join('') + '</div>' : '';
    if (!setView('fin|' + JSON.stringify(S.players), '<div class="ph"><div class="verdict ' + ((teams ? head.indexOf('gagne') > 0 : pos === 1) ? 'ok' : 'ko') + '"><span>Partie terminée</span><span class="big">' +
      head + '</span></div>' + titles + teamLine() + rankingRows(false) + '<div class="grow"></div>' + ctrl +
      '<button class="linkbtn" id="quit">Quitter la partie</button></div>')) return;
    on('again', 'click', function () { send({ t: 'cmd', cmd: 'rematch' }); });
    on('lobby', 'click', function () { send({ t: 'cmd', cmd: 'lobby' }); });
    on('quit', 'click', leave);
  }

  // ================= PYRAMIDE & CROQUIS (téléphone) =================
  function wordOf(cur) {
    var list = QUESTIONS[cur.g] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === cur.id) return list[i].a;
    return '?';
  }

  function headRow(label) {
    var S = C.S;
    return '<div class="stack" style="gap:8px"><div class="rowx"><span>' + esc(label) + ' · ' + S.round + '/' + S.deck.length + (S.mult > 1 ? ' · ×2' : '') + '</span>' +
      '<b style="color:var(--ink)"><span data-sec></span> s</b></div><div class="bar"><i data-bar></i></div></div>';
  }

  function wordCard(w, small) {
    return '<div class="wordcard' + (small ? ' small' : '') + '"><span class="k">Mot secret</span><span class="w">' + esc(w) + '</span></div>';
  }

  function phonePyr() {
    var S = C.S, cur = S.cur, giver = findP(cur.giver), partner = findP(cur.partner);
    var role = cur.giver === me.pid ? 'giver' : cur.partner === me.pid ? 'partner' : 'spec';
    var key = 'pyr|' + S.round + '|' + cur.step + '|' + role;
    var gName = esc(giver ? giver.name : '?'), pName = esc(partner ? partner.name : '?');
    var ann = cur.n ? 'Annonce : ' + cur.n + ' indice' + (cur.n > 1 ? 's' : '') + ' · ' + [0, 30, 20, 10][cur.n] + ' pts' : 'Annonce en cours…';
    var body = '';
    if (role === 'giver') {
      body = '<div class="duo">Tu fais deviner à ' + (partner ? av(partner, 30) : '') + ' <b>' + pName + '</b></div>' + wordCard(wordOf(cur));
      if (cur.step === 'announce') {
        body += '<div class="stack" style="gap:8px"><span class="label">En combien d\'indices ?</span><div class="annonce" id="ann">' +
          [1, 2, 3].map(function (n) { return '<button type="button" data-n="' + n + '"><b>' + n + ' indice' + (n > 1 ? 's' : '') + '</b><span>' + [0, 30, 20, 10][n] + ' pts</span></button>'; }).join('') +
          '</div><span class="muted" style="font-size:13px;text-align:center">Un seul mot par indice, à voix haute</span></div>';
      } else {
        body += '<div class="note">' + ann + '</div><div class="grow"></div><div class="duo-btns"><button class="btn ghost" id="ko">Raté</button><button class="btn good" id="ok">Trouvé</button></div>';
      }
    } else if (role === 'partner') {
      body = '<div class="grow"></div><div class="verdict ok" style="padding:24px 16px"><span class="big" style="font-size:30px">C\'est toi qui devines !</span>' +
        '<span>' + gName + ' te donne des indices d\'un seul mot. Réponds à voix haute.</span></div><div class="note">' + ann + '</div><div class="grow"></div>';
    } else {
      body = '<div class="duo">' + (giver ? av(giver, 30) : '') + ' <b>' + gName + '</b> fait deviner à ' + (partner ? av(partner, 30) : '') + ' <b>' + pName + '</b></div>' +
        wordCard(wordOf(cur), true) + '<div class="note">' + ann + '</div>' +
        '<span class="muted" style="font-size:14px;text-align:center">Surveillez : un seul mot par indice, et pas de mot de la même famille. Ne montrez pas votre écran !</span>';
    }
    if (!setView(key, '<div class="ph">' + topbar() + headRow('Pyramide') + body + (role === 'giver' && cur.step === 'play' ? '' : '<div class="grow"></div>') + '</div>')) return;
    on('ann', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      send({ t: 'announce', round: S.round, n: Number(b.getAttribute('data-n')) });
    });
    on('ok', 'click', function () { send({ t: 'pyr', round: S.round, ok: true }); });
    on('ko', 'click', function () { send({ t: 'pyr', round: S.round, ok: false }); });
  }

  function phoneCroquis() {
    var S = C.S, cur = S.cur, drawer = findP(cur.drawer), isDrawer = cur.drawer === me.pid;
    var found = (cur.found || []).some(function (f) { return f.pid === me.pid; });
    resetDraw(S.round);
    var key = 'cq|' + S.round + '|' + (isDrawer ? 'd' : found ? 'f' : 'g');
    var body;
    if (isDrawer) {
      body = '<div class="drawhead"><span class="muted">Dessine :</span> <b class="word">' + esc(wordOf(cur)) + '</b></div>' +
        '<div class="board"><canvas id="cv" class="pen"></canvas></div>' +
        '<div class="tools" id="tools">' + PEN_COLORS.map(function (c, i) { return '<button type="button" class="dot' + (C.pen.c === i ? ' on' : '') + '" data-c="' + i + '" style="background:' + c + '" aria-label="Couleur ' + (i + 1) + '"></button>'; }).join('') +
        '<button type="button" class="tool' + (C.pen.w ? ' on' : '') + '" data-w="1">Épais</button><button type="button" class="tool" data-clear="1">Effacer</button></div>' +
        '<div class="note" id="stat"></div>';
    } else {
      body = '<div class="drawhead">' + (drawer ? av(drawer, 26) : '') + ' <b>' + esc(drawer ? drawer.name : '?') + '</b> <span class="muted">dessine…</span></div>' +
        '<div class="board"><canvas id="cv"></canvas></div>' +
        (found ? '<div class="verdict ok" style="padding:12px"><span class="big" style="font-size:24px">Trouvé ! Bravo</span></div>' :
          '<div class="guessrow"><input id="gs" class="input" maxlength="30" autocomplete="off" placeholder="Ta proposition"><button class="btn" id="gsend" style="width:auto">OK</button></div>') +
        '<div class="note" id="stat"></div>';
    }
    var fresh = setView(key, '<div class="ph">' + headRow('Croquis') + body + '</div>');
    // mises à jour sans effacer le dessin ni la saisie
    var nf = (cur.found || []).length, guessers = S.players.filter(function (p) { return p.pid !== cur.drawer && !p.off; }).length;
    var fb = (S.fb || {})[me.pid];
    var msg = nf + '/' + guessers + ' ont trouvé';
    if (!isDrawer && !found && fb && fb.n !== C.fbN) { C.fbN = fb.n; C.fbMsg = fb.res === 'near' ? 'Presque ! Essaie encore' : 'Non… essaie encore'; }
    if (!isDrawer && !found && C.fbMsg) msg = C.fbMsg + ' · ' + msg;
    $('stat').textContent = msg;
    if (!fresh) return;
    setupCanvas($('cv'), isDrawer);
    if (isDrawer) {
      on('tools', 'click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        if (b.getAttribute('data-c') != null) C.pen.c = Number(b.getAttribute('data-c'));
        if (b.getAttribute('data-w')) C.pen.w = C.pen.w ? 0 : 1;
        if (b.getAttribute('data-clear')) { C.draw.strokes = {}; C.draw.order = []; paint(); sendFull(); }
        var bs = $('tools').querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) {
          var c = bs[i].getAttribute('data-c'), w = bs[i].getAttribute('data-w');
          if (c != null) bs[i].className = 'dot' + (Number(c) === C.pen.c ? ' on' : '');
          if (w) bs[i].className = 'tool' + (C.pen.w ? ' on' : '');
        }
      });
    } else {
      var go = function () {
        var v = $('gs').value.replace(/\s+/g, ' ').trim();
        if (!v) return;
        send({ t: 'guess', round: S.round, text: v });
        $('gs').value = '';
        $('gs').focus();
      };
      on('gsend', 'click', go);
      on('gs', 'keydown', function (e) { if (e.key === 'Enter') go(); });
    }
  }

  // Résultat personnel des nouveaux jeux : [verdict, complément]
  function plus(pts) { return pts ? '<span style="font-weight:800;font-size:22px">+' + pts + '</span>' : ''; }
  function newVerdict(cur, r) {
    var S = C.S, res = S.result || {};
    if (cur.g === 'imposteur') {
      var imp = findP(cur.imp), pair = qOf(cur).a || ['?', '?'];
      var head = r.role === 'imp' ? (cur.caught ? 'Démasqué !' : 'Pas vu, pas pris !') : (cur.caught ? 'Imposteur démasqué !' : 'L\'imposteur s\'en sort');
      return ['<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big" style="font-size:26px">' + head + '</span>' +
        '<span>' + (r.role === 'imp' ? 'C\'était toi, l\'imposteur' : 'L\'imposteur : <b>' + esc(imp ? imp.name : '?') + '</b>') + '</span>' + plus(r.pts) +
        '<span>Les autres : <b>' + esc(pair[cur.ci]) + '</b> · imposteur : <b>' + esc(pair[1 - cur.ci]) + '</b></span></div>'];
    }
    if (cur.g === 'rebus') {
      return ['<div class="verdict ' + (r.found ? 'ok' : 'ko') + '"><span class="emo" style="font-size:34px">' + esc(cur.e || '') + '</span><span class="big" style="font-size:26px">' + esc(cur.a) + '</span>' +
        '<span>' + (r.found ? 'Trouvé en ' + ord(r.rank + 1) : 'Pas trouvé') + '</span>' + plus(r.pts) + '</div>'];
    }
    if (cur.g === 'petitbac') {
      var marks = r.marks || [];
      var rows = cur.cats.map(function (c, i) {
        var m = marks[i] || { st: 'empty' };
        var lab = { unique: 'unique', shared: 'en double', rej: 'refusé', bad: 'mauvaise lettre', empty: '—' }[m.st];
        return '<div class="prow"><span class="n" style="font-size:14px"><span class="muted" style="font-weight:600">' + esc(c) + '</span><br>' + esc(m.w || '—') + '</span>' +
          '<span class="tag bac-' + m.st + '">' + lab + '</span><span class="r">' + (m.pts ? '+' + m.pts : '') + '</span></div>';
      }).join('');
      return ['<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big" style="font-size:26px">Lettre ' + esc(cur.l) + '</span>' + (r.pts ? plus(r.pts) : '<span>Aucun point</span>') + '</div>',
        '<div class="stack" style="gap:6px">' + rows + '</div>'];
    }
    if (cur.g === 'reflexe') {
      return ['<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big">' + (r.v == null ? 'Pas tapé' : r.early ? 'Faux départ' : r.v + ' ms') + '</span>' +
        (r.rank >= 0 && r.v != null && !r.early ? '<span>' + ord(r.rank + 1) + ' plus rapide</span>' : '') + plus(r.pts) + '</div>'];
    }
    if (cur.g === 'memoire') {
      return ['<div class="verdict ' + (r.ok ? 'ok' : 'ko') + '"><span class="big">' + (r.v == null ? 'Pas de réponse' : r.ok ? 'Bonne case !' : 'Raté') + '</span>' + plus(r.pts) + '</div>',
        '<div class="memo small">' + (cur.grid || []).map(function (e, i) { return '<span class="' + (i === cur.ans ? 'good' : i === r.v ? 'bad' : '') + '">' + e + '</span>'; }).join('') + '</div>'];
    }
    if (cur.g === 'geo') {
      var me2 = findP(me.pid), mk = [];
      if (r.v) mk.push({ x: r.v[0], y: r.v[1], c: COLORS[me2 ? me2.color : 0] });
      return ['<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="big" style="font-size:26px">' + esc(cur.q) + '</span>' +
        '<span>' + (r.v == null ? 'Pas de réponse' : r.inside ? 'En plein dedans !' : 'À ' + fmt(r.km) + ' km') + '</span>' + plus(r.pts) + '</div>',
        '<div class="mapbox">' + mapSvg('rmap', { hi: cur.k, marks: mk }) + '</div>'];
    }
    if (cur.g === 'chrono') {
      return ['<div class="verdict ' + (r.pts ? 'ok' : 'ko') + '"><span class="muted">Objectif : ' + cur.n + ' s</span><span class="big">' + (r.v == null ? 'Pas appuyé' : secs(r.v)) + '</span>' +
        (r.v != null ? '<span>' + (r.diff < 50 ? 'Pile-poil !' : 'écart ' + secs(r.diff)) + '</span>' : '') + plus(r.pts) + '</div>'];
    }
    return null;
  }

  // ================= NOUVEAUX JEUX (téléphone) =================
  function qOf(cur) {
    var list = QUESTIONS[cur.g] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === cur.id) return list[i];
    return {};
  }
  function myImpWord(cur) {
    var pair = qOf(cur).a || ['?', '?'];
    return cur.imp === me.pid ? pair[1 - cur.ci] : pair[cur.ci];
  }
  function statLine(done, n) {
    return done ? 'Envoyé · ' + n + '/' + C.S.players.length + ' ont répondu' : '';
  }

  // ---------- L'Imposteur ----------
  function phoneImp() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    var others = S.players.filter(function (p) { return p.pid !== me.pid; });
    var order = (cur.talk || []).map(function (pid, i) { var p = findP(pid); return p ? '<span class="ordp">' + (i + 1) + '. ' + esc(p.name) + '</span>' : ''; }).join('');
    var key = 'imp|' + S.round + '|' + cur.step + '|' + (ans[me.pid] ? 1 : 0) + '|' + (C.myVote || '');
    var body;
    if (cur.step === 'talk') {
      body = wordCard(myImpWord(cur)) +
        '<div class="note small">Un joueur a un mot différent… et ne le sait peut-être pas !</div>' +
        '<div class="stack" style="gap:6px"><span class="label">Chacun dit un mot, dans l\'ordre</span><div class="ordrow">' + order + '</div></div>' +
        '<div class="grow"></div>' +
        (ans[me.pid] ? '<div class="note" id="stat"></div>' : '<button class="btn" id="rdy">On passe au vote</button><div class="note" id="stat"></div>');
    } else {
      var voted = C.myVote || ans[me.pid];
      body = '<div class="wordcard small"><span class="k">Ton mot</span><span class="w">' + esc(myImpWord(cur)) + '</span></div>' +
        '<span class="label">Qui est l\'imposteur ?</span><div class="stack" id="ivote">' + others.map(function (p) {
          var cls = 'choice' + (voted ? (C.myVote === p.pid ? ' sel' : ' dim') : '');
          return '<button type="button" class="' + cls + '" data-p="' + p.pid + '"' + (voted ? ' disabled' : '') + '>' + av(p, 34) + '<span class="grow">' + esc(p.name) + '</span></button>';
        }).join('') + '</div><div class="grow"></div><div class="note" id="stat"></div>';
    }
    var fresh = setView(key, '<div class="ph">' + topbar() + headRow('L\'Imposteur' + (cur.step === 'vote' ? ' · vote' : '')) + body + '</div>');
    var n = (S.answered || []).length;
    $('stat').textContent = cur.step === 'talk' ? n + '/' + S.players.length + ' prêts à voter' : (ans[me.pid] || C.myVote ? 'Vote envoyé · ' : '') + n + '/' + S.players.length + ' ont voté';
    fit();
    if (!fresh) return;
    on('rdy', 'click', function () { send({ t: 'ready', round: S.round }); });
    on('ivote', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      C.myVote = b.getAttribute('data-p');
      send({ t: 'answer', round: S.round, val: C.myVote });
      render();
    });
  }

  // ---------- Rébus emoji ----------
  function phoneRebus() {
    var S = C.S, cur = S.cur;
    var found = (cur.found || []).some(function (f) { return f.pid === me.pid; });
    var key = 'rb|' + S.round + '|' + (found ? 1 : 0);
    var fresh = setView(key, '<div class="ph">' + topbar() + headRow('Rébus emoji') +
      '<div class="rebus"><span class="cat">' + esc(cur.cat || '') + '</span><span class="emo">' + esc(cur.e || '') + '</span></div>' +
      (found ? '<div class="verdict ok" style="padding:12px"><span class="big" style="font-size:24px">Trouvé ! Bravo</span></div>' :
        '<div class="guessrow"><input id="gs" class="input" maxlength="40" autocomplete="off" placeholder="Ta réponse"><button class="btn" id="gsend" style="width:auto">OK</button></div>') +
      '<div class="grow"></div><div class="note" id="stat"></div></div>');
    var nf = (cur.found || []).length, fb = (S.fb || {})[me.pid], msg = nf + '/' + S.players.length + ' ont trouvé';
    if (!found && fb && fb.n !== C.fbN) { C.fbN = fb.n; C.fbMsg = fb.res === 'near' ? 'Presque ! Essaie encore' : 'Non… essaie encore'; }
    if (!found && C.fbMsg) msg = C.fbMsg + ' · ' + msg;
    $('stat').textContent = msg;
    fit();
    if (!fresh || found) return;
    var go = function () {
      var v = $('gs').value.replace(/\s+/g, ' ').trim();
      if (!v) return;
      send({ t: 'guess', round: S.round, text: v });
      $('gs').value = '';
      $('gs').focus();
    };
    on('gsend', 'click', go);
    on('gs', 'keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  // ---------- Petit Bac ----------
  function phoneBac() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    if (!C.bac || C.bac.round !== S.round) C.bac = { round: S.round, w: cur.cats.map(function () { return ''; }), done: false };
    if (cur.step === 'write') {
      var done = C.bac.done || ans[me.pid];
      var key = 'pb|' + S.round + '|w|' + (done ? 1 : 0);
      var fresh = setView(key, '<div class="ph">' + topbar() + headRow('Petit Bac') +
        '<div class="bacletter"><span>Lettre</span><b>' + esc(cur.l) + '</b></div>' +
        '<div class="stack" id="bacf" style="gap:8px">' + cur.cats.map(function (c, i) {
          return '<label class="bacrow"><span>' + esc(c) + '</span><input class="input" data-i="' + i + '" maxlength="30" autocomplete="off" autocapitalize="sentences" value="' + esc(C.bac.w[i]) + '"' + (done ? ' disabled' : '') + '></label>';
        }).join('') + '</div><div class="grow"></div>' +
        (done ? '' : '<button class="btn" id="bdone">J\'ai fini</button>') + '<div class="note" id="stat"></div></div>');
      $('stat').textContent = done ? 'Grille envoyée · ' + (S.answered || []).length + '/' + S.players.length + ' ont fini' : 'Un mot par catégorie, qui commence par ' + cur.l;
      fit();
      if (!fresh || done) return;
      var t = null;
      var push = function (fin) {
        send({ t: 'answer', round: S.round, val: { w: C.bac.w.slice(), done: !!fin } });
      };
      on('bacf', 'input', function (e) {
        var i = e.target.getAttribute && e.target.getAttribute('data-i');
        if (i == null) return;
        C.bac.w[Number(i)] = e.target.value;
        clearTimeout(t);
        t = setTimeout(function () { push(false); }, 500);
      });
      on('bacf', 'keydown', function (e) {
        if (e.key !== 'Enter') return;
        var i = Number(e.target.getAttribute('data-i')), nx = document.querySelector('#bacf input[data-i="' + (i + 1) + '"]');
        if (nx) nx.focus(); else e.target.blur();
      });
      on('bdone', 'click', function () { clearTimeout(t); C.bac.done = true; push(true); render(); });
      return;
    }
    // vérification croisée
    var sheet = cur.sheet || {}, rej = S.bacRej || {}, checked = ans[me.pid];
    var keyC = 'pb|' + S.round + '|c|' + (checked ? 1 : 0) + '|' + JSON.stringify(rej);
    var rows = cur.cats.map(function (c, i) {
      var chips = S.players.map(function (p) {
        var x = (sheet[p.pid] || [])[i];
        if (!x || !x.w) return '';
        var k = p.pid + ':' + i, mineR = rej[k] && rej[k][me.pid], nR = rej[k] ? Object.keys(rej[k]).length : 0;
        var cls = 'bchip' + (x.ok ? '' : ' bad') + (mineR ? ' rej' : '') + (p.pid === me.pid ? ' own' : '');
        return '<button type="button" class="' + cls + '" data-k="' + k + '"' + (p.pid === me.pid || !x.ok || checked ? ' disabled' : '') + '>' +
          '<i style="background:' + COLORS[p.color] + '"></i>' + esc(x.w) + (nR ? ' <small>✗' + nR + '</small>' : '') + '</button>';
      }).join('');
      return '<div class="bacchk"><span class="label">' + esc(c) + '</span><div class="bchips">' + (chips || '<span class="muted" style="font-size:13px">personne</span>') + '</div></div>';
    }).join('');
    var freshC = setView(keyC, '<div class="ph">' + topbar() + headRow('Petit Bac · vérification') +
      '<div class="muted" style="font-size:13px;margin-top:-4px">Touchez un mot qui ne compte pas (inventé, hors sujet…). Barré par la moitié des joueurs, il ne rapporte rien.</div>' +
      '<div class="stack" id="bchk" style="gap:6px">' + rows + '</div><div class="grow"></div>' +
      (checked ? '' : '<button class="btn" id="cdone">C\'est bon pour moi</button>') + '<div class="note" id="stat"></div></div>');
    $('stat').textContent = (S.answered || []).length + '/' + S.players.length + ' ont vérifié';
    fit();
    if (!freshC) return;
    on('bchk', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      send({ t: 'bac', round: S.round, key: b.getAttribute('data-k') });
    });
    on('cdone', 'click', function () { send({ t: 'bac', round: S.round, done: true }); });
  }

  // ---------- Réflexe ----------
  function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function phoneReflexe() {
    var S = C.S, cur = S.cur;
    if (!C.rx || C.rx.round !== S.round) {
      C.rx = { round: S.round, start: nowMs(), state: 'wait', go: 0, sent: null };
      clearTimeout(C.rxT);
      C.rxT = setTimeout(function () {
        if (!C.rx || C.rx.round !== S.round || C.rx.state !== 'wait') return;
        C.rx.state = 'go';
        var pad = $('rxpad');
        if (pad) { pad.className = 'rxpad go'; pad.innerHTML = '<b>TAPE !</b>'; }
        C.rx.go = nowMs();
        sfx('go');
      }, cur.wait);
    }
    var rx = C.rx;
    var key = 'rx|' + S.round + '|' + (rx.sent != null ? 1 : 0);
    var inner = rx.sent != null ? (rx.sent < 0 ? '<b>Trop tôt !</b><span>Faux départ</span>' : '<b>' + Math.round(rx.sent) + ' ms</b><span>Envoyé</span>') :
      rx.state === 'go' ? '<b>TAPE !</b>' : '<b>Attends…</b><span>Tape dès que l\'écran devient rouge</span>';
    var fresh = setView(key, '<div class="ph">' + topbar() + headRow('Réflexe') +
      '<button type="button" id="rxpad" class="rxpad' + (rx.sent != null ? ' sent' : rx.state === 'go' ? ' go' : '') + '">' + inner + '</button>' +
      '<div class="note" id="stat"></div></div>');
    $('stat').textContent = (S.answered || []).length + '/' + S.players.length + ' ont tapé';
    fit();
    if (!fresh || rx.sent != null) return;
    $('rxpad').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (C.rx.sent != null) return;
      var v = C.rx.state === 'go' ? nowMs() - C.rx.go : -1;
      C.rx.sent = v;
      clearTimeout(C.rxT);
      send({ t: 'answer', round: S.round, val: v < 0 ? 0 : Math.round(v) });
      render();
    });
  }

  // ---------- Mémoire flash ----------
  function phoneMemo() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    var done = C.myAns != null || ans[me.pid];
    var key = 'me|' + S.round + '|' + cur.step + '|' + (done ? 1 : 0);
    var grid;
    if (cur.step === 'show') {
      grid = '<div class="memo">' + (cur.grid || []).map(function (e) { return '<span>' + e + '</span>'; }).join('') + '</div>';
    } else {
      grid = '<div class="memo ask" id="mgrid">' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
        return '<button type="button" data-i="' + i + '" class="' + (done && C.myAns === i ? 'sel' : '') + '"' + (done ? ' disabled' : '') + '>?</button>';
      }).join('') + '</div>';
    }
    var head = cur.step === 'show' ? '<div class="memohead">Mémorise la grille !</div>' : '<div class="memohead">Où était <span class="emo">' + esc(cur.target || '') + '</span> ?</div>';
    var fresh = setView(key, '<div class="ph">' + topbar() + headRow('Mémoire flash') + head + grid + '<div class="grow"></div><div class="note" id="stat"></div></div>');
    $('stat').textContent = cur.step === 'show' ? 'La grille va disparaître…' : done ? statLine(true, (S.answered || []).length) : 'Touche la bonne case';
    fit();
    if (!fresh || cur.step !== 'ask' || done) return;
    on('mgrid', 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      C.myAns = Number(b.getAttribute('data-i'));
      send({ t: 'answer', round: S.round, val: C.myAns });
      render();
    });
  }

  // ---------- Géo-Devine ----------
  function mapSvg(id, opts) {
    opts = opts || {};
    var hi = opts.hi;
    var paths = GEO.paths.map(function (p) {
      return '<path d="' + p[1] + '"' + (hi && p[0] === hi ? ' class="hi"' : '') + '/>';
    }).join('');
    var marks = (opts.marks || []).map(function (m) {
      return '<circle cx="' + m.x + '" cy="' + m.y + '" r="' + (m.r || 7) + '" fill="' + m.c + '" stroke="#1B1B1E" stroke-width="2"/>';
    }).join('');
    return '<svg id="' + id + '" class="map" viewBox="' + (opts.vb || ('0 0 ' + GEO.w + ' ' + GEO.h)) + '" preserveAspectRatio="xMidYMid meet"><rect x="-500" y="-500" width="2000" height="1400" class="sea"/>' +
      '<g class="land">' + paths + '</g><g id="' + id + 'm">' + marks + '</g></svg>';
  }
  function phoneGeo() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    if (!C.geo || C.geo.round !== S.round) C.geo = { round: S.round, zoom: null, pin: null, sent: false };
    var g = C.geo, done = g.sent || ans[me.pid];
    var key = 'geo|' + S.round + '|' + (done ? 1 : 0) + '|' + (g.zoom ? g.zoom.join(',') : '') + '|' + (g.pin ? 1 : 0);
    var vb = g.zoom ? g.zoom.join(' ') : null;
    var p = findP(me.pid);
    var marks = g.pin ? [{ x: g.pin[0], y: g.pin[1], c: COLORS[p ? p.color : 0], r: g.zoom ? 4 : 7 }] : [];
    var help = done ? 'Position envoyée' : !g.zoom ? '1. Touche la zone pour zoomer' : !g.pin ? '2. Touche l\'endroit exact' : 'Ça te va ?';
    var fresh = setView(key, '<div class="ph">' + topbar() + headRow('Géo-Devine') +
      '<div class="geoq"><span>Où se trouve</span><b>' + esc(cur.q) + '</b></div>' +
      '<div class="mapbox">' + mapSvg('gmap', { vb: vb, marks: marks }) + '</div>' +
      '<div class="muted" style="text-align:center;font-weight:700">' + help + '</div>' +
      (done ? '' : '<div class="duo-btns"><button class="btn ghost" id="gback"' + (g.zoom ? '' : ' disabled') + '>Dézoomer</button><button class="btn" id="gok"' + (g.pin ? '' : ' disabled') + '>Valider</button></div>') +
      '<div class="grow"></div><div class="note" id="stat"></div></div>');
    $('stat').textContent = done ? statLine(true, (S.answered || []).length) : 'Plus tu es près, plus tu marques';
    fit();
    if (!fresh || done) return;
    $('gmap').addEventListener('click', function (e) {
      var svg = $('gmap'), r = svg.getBoundingClientRect();
      var v = g.zoom || [0, 0, GEO.w, GEO.h];
      // la carte garde ses proportions dans le cadre : on retrouve la zone réellement dessinée
      var sc = Math.min(r.width / v[2], r.height / v[3]);
      var ox = (r.width - v[2] * sc) / 2, oy = (r.height - v[3] * sc) / 2;
      var x = v[0] + (e.clientX - r.left - ox) / sc, y = v[1] + (e.clientY - r.top - oy) / sc;
      if (!g.zoom) {
        var w = GEO.w / 3.2, h = GEO.h / 3.2;
        g.zoom = [Math.round(Math.max(0, Math.min(GEO.w - w, x - w / 2))), Math.round(Math.max(0, Math.min(GEO.h - h, y - h / 2))), Math.round(w), Math.round(h)];
      } else {
        g.pin = [Math.round(x), Math.round(y)];
      }
      render();
    });
    on('gback', 'click', function () { g.zoom = null; g.pin = null; render(); });
    on('gok', 'click', function () { if (!g.pin) return; g.sent = true; send({ t: 'answer', round: S.round, val: g.pin }); render(); });
  }

  // ---------- Pile-poil ----------
  function phoneChrono() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    if (!C.cl || C.cl.round !== S.round) C.cl = { round: S.round, start: nowMs(), sent: null };
    var cl = C.cl, done = cl.sent != null || ans[me.pid];
    var key = 'ch|' + S.round + '|' + (done ? 1 : 0);
    var fresh = setView(key, '<div class="ph">' + topbar() +
      '<div class="chronohead"><span>Compte dans ta tête</span><b>' + cur.n + ' secondes</b><span>et appuie au bon moment. Pas de triche avec une montre !</span></div>' +
      '<button type="button" id="clbtn" class="clbtn' + (done ? ' sent' : '') + '"' + (done ? ' disabled' : '') + '>' + (done ? 'Envoyé' : 'STOP') + '</button>' +
      '<div class="note" id="stat"></div></div>');
    $('stat').textContent = (S.answered || []).length + '/' + S.players.length + ' ont appuyé';
    fit();
    if (!fresh || done) return;
    $('clbtn').addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (C.cl.sent != null) return;
      C.cl.sent = nowMs() - C.cl.start;
      send({ t: 'answer', round: S.round, val: Math.round(C.cl.sent) });
      render();
    });
  }
  function secs(ms) { return (ms / 1000).toFixed(1).replace('.', ',') + ' s'; }

  // ---------- dessin partagé ----------
  var PEN_COLORS = ['#14121F', '#E5484D', '#2F7BFF', '#22A06B'];
  var PEN_W = [0.009, 0.024];
  C.pen = { c: 0, w: 0 };
  C.draw = { round: -1, strokes: {}, order: [] };
  C.cv = null;

  function resetDraw(round) {
    if (C.draw.round === round) return;
    C.draw = { round: round, strokes: {}, order: [] };
    C.fbN = 0; C.fbMsg = '';
  }

  function onDraw(p, full) {
    if (!p || !C.S || p.r !== C.S.round) return;
    resetDraw(p.r);
    if (C.S.cur && C.S.cur.drawer === me.pid && !C.tv) return; // c'est moi qui dessine
    if (full) {
      C.draw.strokes = {}; C.draw.order = [];
      (p.s || []).forEach(function (st) { C.draw.strokes[st.id] = { c: st.c, w: st.w, p: st.p.slice() }; C.draw.order.push(st.id); });
      paint();
      return;
    }
    (p.s || []).forEach(function (seg) {
      var st = C.draw.strokes[seg.id];
      if (!st) { st = C.draw.strokes[seg.id] = { c: seg.c, w: seg.w, p: [] }; C.draw.order.push(seg.id); }
      var from = st.p.length;
      for (var i = 0; i < seg.p.length; i++) st.p.push(seg.p[i]);
      paintStroke(st, Math.max(0, from - 2));
    });
  }

  function setupCanvas(cv, pen) {
    C.cv = cv;
    if (!cv) return;
    var size = function () {
      var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
      paint();
    };
    size();
    window.addEventListener('resize', size);
    if (pen) bindPen(cv);
  }

  function ctx2d() {
    if (!C.cv || !document.body.contains(C.cv)) return null;
    return C.cv.getContext('2d');
  }

  function paint() {
    var g = ctx2d();
    if (!g) return;
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, C.cv.width, C.cv.height);
    C.draw.order.forEach(function (id) { paintStroke(C.draw.strokes[id], 0); });
  }

  function paintStroke(st, from) {
    var g = ctx2d();
    if (!g || !st || st.p.length < 2) return;
    var W = C.cv.width, H = C.cv.height;
    g.strokeStyle = PEN_COLORS[st.c] || PEN_COLORS[0];
    g.lineWidth = Math.max(1.5, PEN_W[st.w ? 1 : 0] * W);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    var i = from - (from % 2);
    g.moveTo(st.p[i] * W, st.p[i + 1] * H);
    if (st.p.length === 2 || st.p.length - i <= 2) g.lineTo(st.p[i] * W + 0.1, st.p[i + 1] * H);
    for (i += 2; i < st.p.length; i += 2) g.lineTo(st.p[i] * W, st.p[i + 1] * H);
    g.stroke();
  }

  function sendFull() {
    var list = C.draw.order.map(function (id) { var st = C.draw.strokes[id]; return { id: id, c: st.c, w: st.w, p: st.p }; });
    chSend('dfull', { r: C.S.round, s: list });
  }

  function bindPen(cv) {
    var cur = null, pending = {}, n = 0, flushT = null;
    function pt(e) {
      var r = cv.getBoundingClientRect();
      return [Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 1000) / 1000,
              Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 1000) / 1000];
    }
    function flush() {
      flushT = null;
      var segs = Object.keys(pending).map(function (id) { return pending[id]; });
      pending = {};
      if (segs.length) chSend('d', { r: C.S.round, s: segs });
    }
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      var id = me.pid.slice(0, 4) + '-' + C.S.round + '-' + (++n);
      var p = pt(e);
      cur = { id: id, st: { c: C.pen.c, w: C.pen.w, p: [p[0], p[1]] } };
      C.draw.strokes[id] = cur.st; C.draw.order.push(id);
      pending[id] = { id: id, c: cur.st.c, w: cur.st.w, p: [p[0], p[1]] };
      paintStroke(cur.st, 0);
      if (!flushT) flushT = setTimeout(flush, 80);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!cur) return;
      var p = pt(e), st = cur.st;
      st.p.push(p[0], p[1]);
      var seg = pending[cur.id] || (pending[cur.id] = { id: cur.id, c: st.c, w: st.w, p: [] });
      seg.p.push(p[0], p[1]);
      paintStroke(st, st.p.length - 4);
      if (!flushT) flushT = setTimeout(flush, 80);
    });
    function up() { if (!cur) return; cur = null; flush(); sendFull(); }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    clearInterval(C.fullT);
    C.fullT = setInterval(function () {
      if (!C.S || C.S.phase !== 'question' || !C.S.cur || C.S.cur.drawer !== me.pid) { clearInterval(C.fullT); return; }
      sendFull();
    }, 2500);
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
    var key = 'tlobby|' + JSON.stringify([S.players, S.captain, st]) + '|' + (DATA.season ? DATA.season.stamp : '');
    var rows = S.players.map(function (p) {
      return '<div class="prow2">' + avR(p, 3.4) + '<span style="flex:1">' + esc(p.name) + '</span>' +
        (p.pid === S.captain ? '<span class="chip" style="font-size:1rem">capitaine</span>' : '') + '</div>';
    }).join('');
    if (S.players.length < 4) rows += '<div class="prow2 empty"><span class="av ghost" style="width:3.4rem;height:3.4rem"></span>En attente des joueurs…</div>';
    var gamesTxt = st.games.length === Object.keys(GAMES).length ? 'Les ' + st.games.length + ' jeux' :
      st.games.length > 2 ? st.games.length + ' jeux' : st.games.map(gameName).join(' + ');
    var chips = '<span class="chip">' + st.count + ' épreuves</span><span class="chip">' + esc(gamesTxt) + '</span>' +
      (st.mode === 'manches' ? '<span class="chip">Par manches</span>' : '') +
      (st.teams ? '<span class="chip">2 équipes</span>' : '') +
      (st.finale ? '<span class="chip">Finale ×2</span>' : '');
    var who = S.captain ? esc(capName()) + ' lance la partie depuis son téléphone' : 'Le premier joueur arrivé lancera la partie';
    if (DATA.season && DATA.season.rows.length) {
      var top = DATA.season.rows[0];
      who = esc(DATA.season.label) + ' · en tête : <b>' + esc(top.name) + '</b> (' + top.wins + ' victoire' + (top.wins > 1 ? 's' : '') + ')<br>' + who;
    }
    var tiles = C.code.split('').map(function (c) { return '<span>' + c + '</span>'; }).join('');
    setView(key, '<div class="tvw"><div class="lobby"><div class="l">' +
      '<div><p class="brand-k">Soirée jeux</p><h1 class="brand">Dé-lire</h1></div>' +
      '<div class="qrrow"><div class="qr">' + qrSvg(joinUrl()) + '</div><div style="display:flex;flex-direction:column;gap:1rem">' +
      '<div style="font-size:1.7rem;font-weight:600">Scannez avec votre téléphone</div>' +
      '<div class="muted" style="font-size:1.25rem">ou ouvrez ' + esc(location.host + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '')) + ' et entrez le code</div><div class="tiles">' + tiles + '</div></div></div></div>' +
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
    if (C.S.cur.g === 'pyramide') return tvPyr();
    if (C.S.cur.g === 'croquis') return tvCroquis();
    var G = C.S.cur.g;
    if (G === 'imposteur') return tvImp();
    if (G === 'rebus') return tvRebus();
    if (G === 'petitbac') return tvBac();
    if (G === 'reflexe') return tvReflexe();
    if (G === 'memoire') return tvMemo();
    if (G === 'geo') return tvGeo();
    if (G === 'chrono') return tvChrono();
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

  function tvPyr() {
    var S = C.S, cur = S.cur, gv = findP(cur.giver), pt = findP(cur.partner);
    var ann = cur.n ? 'En ' + cur.n + ' indice' + (cur.n > 1 ? 's' : '') + ' · ' + [0, 30, 20, 10][cur.n] + ' pts' : esc(gv ? gv.name : '') + ' choisit son annonce…';
    setView('tpyr|' + S.round + '|' + cur.step, '<div class="tvw">' + tvBar(true) +
      '<div class="pyrduo big">' + (gv ? avR(gv, 6) + '<span>' + esc(gv.name) + '</span>' : '') + '<span class="arrow">→</span>' + (pt ? avR(pt, 6) + '<span>' + esc(pt.name) + '</span>' : '') + '</div>' +
      '<div class="bigres">' + ann + '</div>' +
      '<div class="foot muted">Le mot est secret : tout le monde sauf ' + esc(pt ? pt.name : '') + ' le voit sur son téléphone</div></div>');
  }

  function tvCroquis() {
    var S = C.S, cur = S.cur, dr = findP(cur.drawer);
    resetDraw(S.round);
    var fresh = setView('tcq|' + S.round, '<div class="tvw"><div class="split"><div class="board tvboard"><canvas id="cv"></canvas></div>' +
      '<div class="side" id="cqside"></div></div></div>');
    var found = {};
    (cur.found || []).forEach(function (f) { found[f.pid] = true; });
    var feed = (S.feed || []).slice(-6).map(function (f) {
      var p = findP(f.pid);
      if (!p) return '';
      return '<div class="srow" style="font-size:1.2rem">' + avR(p, 2) + '<span class="n">' + (f.ok ? '<b style="color:var(--good-ink)">a trouvé !</b>' : esc(f.text) + (f.near ? ' <span class="muted">(presque)</span>' : '')) + '</span></div>';
    }).join('');
    $('cqside').innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between"><span class="chip accent">Croquis' + (S.mult > 1 ? ' ×2' : '') + '</span><div class="ring" data-ring style="width:4.6rem;height:4.6rem;font-size:1.8rem"><span data-sec></span></div></div>' +
      '<div style="font-size:1.4rem">' + (dr ? avR(dr, 2.4) + ' <b>' + esc(dr.name) + '</b> dessine' : '') + '</div>' +
      '<div class="muted" style="font-size:1.1rem">Tapez vos propositions sur votre téléphone</div>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' + S.players.filter(function (p) { return p.pid !== cur.drawer; }).map(function (p) { return avR(p, 2.4, !found[p.pid]); }).join('') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:.5rem;margin-top:auto">' + feed + '</div>';
    tickTimers();
    if (fresh) setupCanvas($('cv'));
  }

  // ================= NOUVEAUX JEUX (télé) =================
  function tvImp() {
    var S = C.S, cur = S.cur, ans = answeredSet();
    var order = (cur.talk || []).map(function (pid, i) {
      var p = findP(pid);
      return p ? '<div class="talk' + (ans[pid] ? ' ok' : '') + '"><span class="n1">' + (i + 1) + '</span>' + avR(p, 3) + '<span>' + esc(p.name) + '</span>' + (ans[pid] && cur.step === 'talk' ? '<span class="chip">prêt</span>' : '') + '</div>' : '';
    }).join('');
    setView('timp|' + S.round + '|' + cur.step, '<div class="tvw">' + tvBar(true) +
      (cur.step === 'talk' ?
        '<h1 class="q">Chacun dit un mot sur son mot secret, dans l\'ordre</h1><div class="talks" id="talks"></div>' +
        '<div class="foot muted">Un joueur a un mot différent… Quand tout le monde a parlé, appuyez sur « On passe au vote »</div>' :
        '<h1 class="q">Qui est l\'imposteur ?</h1><div class="muted" style="font-size:1.8rem">Votez sur votre téléphone</div><div class="foot" id="who"></div>') + '</div>');
    if ($('talks')) $('talks').innerHTML = order;
    if ($('who')) $('who').innerHTML = tvWho('Ont voté');
  }

  function tvRebus() {
    var S = C.S, cur = S.cur, found = {};
    (cur.found || []).forEach(function (f) { found[f.pid] = true; });
    setView('trb|' + S.round, '<div class="tvw">' + tvBar(true, cur.cat) + '<div class="rebus tv"><span class="emo">' + esc(cur.e || '') + '</span></div>' +
      '<div class="feed" id="feed"></div><div class="foot" id="who"></div></div>');
    $('feed').innerHTML = (S.feed || []).slice(-4).map(function (f) {
      var p = findP(f.pid);
      return p ? '<div class="srow">' + avR(p, 2.2) + '<span class="n">' + (f.ok ? '<b style="color:var(--good-ink)">a trouvé !</b>' : esc(f.text) + (f.near ? ' <span class="muted">(presque)</span>' : '')) + '</span></div>' : '';
    }).join('');
    $('who').innerHTML = '<span class="muted">Ont trouvé</span>' + S.players.map(function (p) {
      return '<span class="who-it' + (found[p.pid] ? '' : ' off') + '">' + avR(p, 2.8, !found[p.pid]) + esc(p.name) + '</span>';
    }).join('');
  }

  function bacTable(cur, opts) {
    var S = C.S, sheet = cur.sheet || {}, rej = S.bacRej || {}, res = opts.res;
    var ps = S.players.filter(function (p) { return sheet[p.pid] || (res && res[p.pid] && res[p.pid].marks); });
    var head = '<tr><th></th>' + ps.map(function (p) { return '<th>' + avR(p, 2) + ' ' + esc(p.name) + '</th>'; }).join('') + '</tr>';
    var rows = cur.cats.map(function (c, i) {
      return '<tr><td class="cat">' + esc(c) + '</td>' + ps.map(function (p) {
        if (res) {
          var m = ((res[p.pid] || {}).marks || [])[i] || { st: 'empty' };
          return '<td class="bac-' + m.st + '">' + esc(m.w || '—') + (m.pts ? ' <b>+' + m.pts + '</b>' : '') + '</td>';
        }
        var x = (sheet[p.pid] || [])[i] || {}, n = rej[p.pid + ':' + i] ? Object.keys(rej[p.pid + ':' + i]).length : 0;
        return '<td class="' + (!x.w ? 'bac-empty' : !x.ok ? 'bac-bad' : n ? 'bac-rej' : '') + '">' + esc(x.w || '—') + (n ? ' <small>✗' + n + '</small>' : '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var tot = res ? '<tr><td class="cat">Total</td>' + ps.map(function (p) { return '<td><b>+' + ((res[p.pid] || {}).pts || 0) + '</b></td>'; }).join('') + '</tr>' : '';
    return '<table class="bactab">' + head + rows + tot + '</table>';
  }

  function tvBac() {
    var S = C.S, cur = S.cur;
    if (cur.step === 'write') {
      setView('tpb|' + S.round + '|w', '<div class="tvw">' + tvBar(true) +
        '<div class="bacwrap"><div class="bacbig"><span>Lettre</span><b>' + esc(cur.l) + '</b></div><div class="baccats">' +
        cur.cats.map(function (c) { return '<div>' + esc(c) + '</div>'; }).join('') + '</div></div>' +
        '<div class="foot" id="who"></div></div>');
      $('who').innerHTML = tvWho('Ont fini');
      return;
    }
    setView('tpb|' + S.round + '|c|' + JSON.stringify(S.bacRej || {}) + '|' + (S.answered || []).length, '<div class="tvw">' + tvBar(true, 'Vérification · lettre ' + cur.l) +
      bacTable(cur, {}) + '<div class="foot muted">Barrez sur votre téléphone les mots qui ne comptent pas</div></div>');
  }

  function tvReflexe() {
    var S = C.S, cur = S.cur;
    var fresh = setView('trx|' + S.round, '<div class="tvw">' + tvBar(false) + '<div class="rxtv" id="rxtv"><b>Attendez le rouge…</b><span>puis tapez sur votre téléphone</span></div><div class="foot" id="who"></div></div>');
    $('who').innerHTML = tvWho('Ont tapé');
    if (fresh) {
      clearTimeout(C.rxTv);
      C.rxTv = setTimeout(function () { var el = $('rxtv'); if (el) { el.className = 'rxtv go'; el.innerHTML = '<b>TAPEZ !</b>'; sfx('go'); } }, cur.wait);
    }
  }

  function memoGrid(cells, cls) { return '<div class="memo ' + (cls || '') + '">' + cells.join('') + '</div>'; }

  function tvMemo() {
    var S = C.S, cur = S.cur;
    if (cur.step === 'show') {
      setView('tme|' + S.round + '|s', '<div class="tvw">' + tvBar(true) + '<h1 class="q" style="font-size:2.3rem">Mémorisez la grille !</h1>' +
        memoGrid((cur.grid || []).map(function (e) { return '<span>' + e + '</span>'; }), 'tv') + '</div>');
      return;
    }
    setView('tme|' + S.round + '|a', '<div class="tvw">' + tvBar(true) + '<h1 class="q" style="font-size:2.3rem">Où était <span class="emo">' + esc(cur.target || '') + '</span> ?</h1>' +
      memoGrid([0, 1, 2, 3, 4, 5, 6, 7, 8].map(function () { return '<span class="q">?</span>'; }), 'tv') + '<div class="foot" id="who"></div></div>');
    $('who').innerHTML = tvWho();
  }

  function tvGeo() {
    var S = C.S, cur = S.cur;
    setView('tgeo|' + S.round, '<div class="tvw">' + tvBar(true) + '<div class="geoq tv"><span>Où se trouve</span><b>' + esc(cur.q) + '</b></div>' +
      '<div class="mapbox tv">' + mapSvg('tmap') + '</div><div class="foot" id="who"></div></div>');
    $('who').innerHTML = tvWho();
  }

  function tvChrono() {
    var S = C.S, cur = S.cur;
    setView('tch|' + S.round, '<div class="tvw">' + tvBar(false) + '<div class="chronotv"><span>Comptez dans votre tête</span><b>' + cur.n + ' secondes</b>' +
      '<span>et appuyez sur STOP au bon moment</span></div><div class="foot" id="who"></div></div>');
    $('who').innerHTML = tvWho('Ont appuyé');
  }

  // Résultats des nouveaux jeux sur la télé (corps de l'écran)
  function tvNewReveal(cur, res) {
    var S = C.S;
    function rows(list, cells, two) {
      return '<div class="erows' + (two || list.length > 4 ? ' two' : '') + '">' + list.map(function (p) {
        var r = res[p.pid] || {};
        return '<div class="erow">' + avR(p, 2.6) + '<span class="n">' + esc(p.name) + '</span>' + cells(r, p) + '<span class="g">' + (r.pts ? '+' + r.pts : '') + '</span></div>';
      }).join('') + '</div>';
    }
    if (cur.g === 'imposteur') {
      var imp = findP(cur.imp), pair = qOf(cur).a || ['?', '?'];
      return '<div class="imprev"><div class="impw"><span>Le mot des autres</span><b>' + esc(pair[cur.ci]) + '</b></div><div class="impw imp"><span>Le mot de l\'imposteur</span><b>' + esc(pair[1 - cur.ci]) + '</b></div></div>' +
        '<div class="bigres ' + (cur.caught ? 'good' : '') + '">' + (imp ? avR(imp, 3) + ' ' : '') + esc(imp ? imp.name : '?') + (cur.caught ? ' est démasqué !' : ' s\'en sort !') + '</div>' +
        rows(S.players, function (r) { var v = r.vote ? findP(r.vote) : null; return '<span class="d">' + (v ? 'vote ' + esc(v.name) : 'pas de vote') + '</span>'; });
    }
    if (cur.g === 'rebus') {
      var finders = (cur.found || []).map(function (f) { var p = findP(f.pid); return p ? '<div class="srow">' + avR(p, 2.4) + '<span class="n">' + esc(p.name) + '</span><span class="g">+' + ((res[f.pid] || {}).pts || 0) + '</span></div>' : ''; }).join('');
      return '<div class="rebus tv sm"><span class="emo">' + esc(cur.e || '') + '</span></div><div class="truth">' + esc(cur.a) + '</div>' +
        (finders || '<div class="muted" style="font-size:1.4rem">Personne n\'a trouvé</div>');
    }
    if (cur.g === 'petitbac') return bacTable(cur, { res: res });
    if (cur.g === 'reflexe') {
      var listR = S.players.slice().sort(function (a, b) {
        var ra = res[a.pid] || {}, rb = res[b.pid] || {};
        var va = ra.v == null || ra.early ? 1e9 : ra.v, vb = rb.v == null || rb.early ? 1e9 : rb.v;
        return va - vb;
      });
      return rows(listR, function (r) { return '<span class="v">' + (r.v == null ? '—' : r.early ? 'faux départ' : r.v + ' ms') + '</span>'; });
    }
    if (cur.g === 'memoire') {
      return '<div class="memorev">' + memoGrid((cur.grid || []).map(function (e, i) {
        var pk = S.players.filter(function (p) { return res[p.pid] && res[p.pid].v === i; });
        return '<span class="' + (i === cur.ans ? 'good' : '') + '">' + e + '<i>' + pk.map(function (p) { return avR(p, 1.6); }).join('') + '</i></span>';
      }), 'tv sm') + '</div>';
    }
    if (cur.g === 'geo') {
      var mk = S.players.filter(function (p) { return res[p.pid] && res[p.pid].v; }).map(function (p) { return { x: res[p.pid].v[0], y: res[p.pid].v[1], c: COLORS[p.color] }; });
      if (cur.c2) mk.push({ x: cur.c2[0], y: cur.c2[1], c: '#FFFFFF', r: 4 });
      var listG = S.players.slice().sort(function (a, b) { return ((res[a.pid] || {}).km == null ? 1e9 : res[a.pid].km) - ((res[b.pid] || {}).km == null ? 1e9 : res[b.pid].km); });
      return '<div class="georev"><div class="mapbox tv">' + mapSvg('rmap', { hi: cur.k, marks: mk }) + '</div>' +
        rows(listG, function (r) { return '<span class="v">' + (r.v == null ? '—' : r.inside ? 'dedans !' : fmt(r.km) + ' km') + '</span>'; }, true) + '</div>';
    }
    if (cur.g === 'chrono') {
      var listC = S.players.slice().sort(function (a, b) { return ((res[a.pid] || {}).diff == null ? 1e9 : res[a.pid].diff) - ((res[b.pid] || {}).diff == null ? 1e9 : res[b.pid].diff); });
      return '<div class="truth">' + cur.n + ' s</div>' + rows(listC, function (r) { return '<span class="v">' + (r.v == null ? '—' : secs(r.v)) + '</span><span class="d">' + (r.v == null ? '' : r.diff < 50 ? 'pile-poil !' : 'écart ' + secs(r.diff)) + '</span>'; });
    }
    return null;
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
    var res = C.S.result || {}, t = teamTotals();
    var teams = t ? '<div style="display:flex;gap:.6rem;margin-bottom:.4rem">' + t.map(function (x, i) {
      return '<div class="tteam t' + i + '"><span>Équipe ' + 'AB'.charAt(i) + '</span><b>' + x.pts + '</b></div>';
    }).join('') + '</div>' : '';
    return '<div class="side"><h3>Classement</h3>' + teams + ranked().map(function (p, i) {
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
      }).join('') + '</div><div class="erows' + (S.players.length > 3 ? ' two' : '') + '">' + rows + '</div>';
    }
    else if (cur.g === 'pyramide') {
      var gv = findP(cur.giver), pt = findP(cur.partner);
      body = '<div class="pyrduo">' + (gv ? avR(gv, 4) + '<span>' + esc(gv.name) + '</span>' : '') + '<span class="arrow">→</span>' + (pt ? avR(pt, 4) + '<span>' + esc(pt.name) + '</span>' : '') + '</div>' +
        '<div><div class="muted" style="font-size:1.4rem;margin-bottom:.6rem">Le mot</div><div class="truth">' + esc(wordOf(cur)) + '</div></div>' +
        '<div class="bigres ' + (cur.ok ? 'good' : '') + '">' + (cur.ok ? 'Trouvé ! +' + ((res[cur.giver] || {}).pts || 0) + ' chacun' : 'Raté') +
        (cur.n ? ' <span class="muted">· annonce : ' + cur.n + ' indice' + (cur.n > 1 ? 's' : '') + '</span>' : '') + '</div>';
    } else if (cur.g === 'croquis') {
      var dr = findP(cur.drawer);
      var finders = (cur.found || []).map(function (f, i) {
        var p = findP(f.pid);
        return p ? '<div class="srow">' + avR(p, 2.4) + '<span class="n">' + esc(p.name) + '</span><span class="g">+' + ((res[f.pid] || {}).pts || 0) + '</span></div>' : '';
      }).join('');
      body = '<div class="cqrev"><div class="board"><canvas id="cv"></canvas></div><div style="flex:1;display:flex;flex-direction:column;gap:1rem">' +
        '<div class="muted" style="font-size:1.3rem">Le dessin de ' + esc(dr ? dr.name : '?') + '</div><div class="truth" style="font-size:3.4rem">' + esc(wordOf(cur)) + '</div>' +
        (finders || '<div class="muted" style="font-size:1.4rem">Personne n\'a trouvé</div>') +
        (dr && (res[cur.drawer] || {}).pts ? '<div class="srow">' + avR(dr, 2.4) + '<span class="n">' + esc(dr.name) + ' (dessin)</span><span class="g">+' + res[cur.drawer].pts + '</span></div>' : '') + '</div></div>';
    }
    var next = S.round >= S.deck.length ? 'le classement final' : 'l\'épreuve suivante';
    var nb = tvNewReveal(cur, res);
    if (nb != null) {
      body = nb;
      var head = cur.g === 'geo' ? '<div class="geoq tv"><b style="font-size:2.6rem">' + esc(cur.q) + '</b></div>' : '';
      setView('trev|' + S.round, '<div class="tvw"><div class="split"><div style="flex:1;display:flex;flex-direction:column;gap:1.6rem;min-width:0">' + tvBar(false) + head + body +
        '<div class="foot muted">' + esc(capName()) + ' lance ' + next + ' depuis son téléphone</div></div>' + tvSide() + '</div></div>');
      return;
    }
    if (cur.g === 'pyramide' || cur.g === 'croquis') {
      setView('trev|' + S.round, '<div class="tvw"><div class="split"><div style="flex:1;display:flex;flex-direction:column;gap:1.6rem;min-width:0">' + tvBar(false) + body +
        '<div class="foot muted">' + esc(capName()) + ' lance ' + next + ' depuis son téléphone</div></div>' + tvSide() + '</div></div>');
      if (cur.g === 'croquis') setupCanvas($('cv'));
      return;
    }
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
      var tt = ((S.titles || {})[p.pid] || []).map(function (t) { return t.name; }).join(' · ');
      html += '<div class="pod' + (i === 0 ? ' first' : '') + '" style="animation-delay:' + delay + 's"><span class="rk">' + (i + 1) + '</span>' + avR(p, i === 0 ? 4.4 : 3.2) +
        '<span class="n">' + esc(p.name) + (tt ? '<span class="ttl">' + esc(tt) + '</span>' : '') + '</span><span class="s">' + p.score + ' pts</span></div>';
    }
    var conf = '', start = n * 1.6;
    for (var k = 0; k < 40; k++) {
      conf += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + COLORS[k % COLORS.length] + ';animation-delay:' + (start + Math.random() * 3).toFixed(2) + 's"></i>';
    }
    var t = teamTotals(), title = 'Classement final';
    if (t) title = t[0].pts === t[1].pts ? 'Égalité entre les équipes !' : 'Victoire de l\'équipe ' + (t[0].pts > t[1].pts ? 'A' : 'B') + ' !';
    var champ = DATA.season && DATA.season.rows.length ? DATA.season.label + ' · en tête : ' + DATA.season.rows[0].name + ' (' + DATA.season.rows[0].wins + ' victoire' + (DATA.season.rows[0].wins > 1 ? 's' : '') + ')' : '';
    setView('tfin|' + JSON.stringify(S.players) + '|' + (DATA.season ? DATA.season.stamp : ''), '<div class="tvw"><h1 class="display" style="margin:0;font-size:3.4rem;text-align:center">' + esc(title) + '</h1>' +
      (t ? '<div style="display:flex;gap:1rem;justify-content:center">' + t.map(function (x, i) { return '<div class="tteam t' + i + '"><span>Équipe ' + 'AB'.charAt(i) + ' · ' + esc(x.names.join(', ')) + '</span><b>' + x.pts + '</b></div>'; }).join('') + '</div>' : '') +
      '<div class="podium">' + html + '</div><div class="muted" style="text-align:center;font-size:1.3rem">' + (champ ? esc(champ) + ' — ' : '') + esc(capName()) + ' choisit : revanche ou retour au salon</div></div>' +
      '<div class="confetti">' + conf + '</div>');
  }

  // ================= ACCUEIL =================
  function showHome() {
    document.body.className = 'phone';
    C.view = 'home';
    app.innerHTML = '<div class="ph"><div style="margin-top:6vh"><h1 class="title" style="font-size:46px">Dé-lire</h1><div class="muted" style="margin-top:8px">Le jeu de soirée de la famille</div></div>' +
      '<div class="grow homedie"></div>' +
      '<div class="stack"><label class="label" for="code">Rejoindre une partie</label><input id="code" class="input code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters">' +
      '<button class="btn" id="join">Rejoindre</button></div>' +
      '<div class="stack" style="margin-top:14px"><button class="btn ghost col" id="mk"><span>Créer une partie ici</span><span class="sub">Sans télé : ce téléphone sert de plateau</span></button>' +
      '<button class="btn ghost col" id="tvb"><span>Ouvrir l\'écran télé</span><span class="sub">À lancer depuis le navigateur de la télé</span></button>' +
      '<button class="linkbtn" id="hseason">🏆 Classement de la saison</button></div></div>';
    function go() {
      var c = $('code').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (c.length !== 4) { $('code').focus(); return; }
      openJoin(c);
    }
    on('join', 'click', go);
    on('code', 'keydown', function (e) { if (e.key === 'Enter') go(); });
    on('mk', 'click', function () { createRoom(false); });
    on('tvb', 'click', function () { location.href = location.pathname + '?tv'; });
    on('hseason', 'click', showSeasonHome);
    fit();
  }

  // Classement de la saison, consultable sans partie en cours
  function showSeasonHome() {
    document.body.className = 'phone';
    C.view = 'hseason';
    var draw = function () {
      if (C.view !== 'hseason') return;
      var se = DATA.season;
      app.innerHTML = '<div class="ph">' + screenHead(se ? se.label : 'Saison') + '<div class="plist">' + seasonList(se) + '</div>' +
        '<div class="grow"></div><button class="btn" id="done">Retour à l\'accueil</button></div>';
      on('done', 'click', showHome);
      on('back', 'click', showHome);
      fit();
    };
    draw();
    loadSeason(draw);
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
