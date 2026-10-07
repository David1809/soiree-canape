// Dé-lire — remplit progressivement la réserve de questions à partir d'OpenQuizzDB
// (quiz téléchargeables librement, licence CC BY-SA 4.0 ; API en option si une clé est configurée).
// Appelée par la base (réserve presque vide) et par une tâche planifiée quotidienne.
// Aucune donnée n'est renvoyée au navigateur : la fonction écrit seulement dans quiz_sources / quiz_pool.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://www.openquizzdb.org';
const UA = 'Mozilla/5.0 (compatible; De-lire family quiz; +https://david1809.github.io/soiree-canape/)';
const ALLOWED = new Set(['ANIMAUX', 'ARCHEOLOGIE', 'ARTS', 'BD', 'CELEBRITES', 'CINEMA', 'CULTURE', 'GASTRONOMIE',
  'GEOGRAPHIE', 'HISTOIRE', 'INFORMATIQUE', 'LITTERATURE', 'LOISIRS', 'MUSIQUE', 'NATURE', 'MONDE',
  'QUOTIDIEN', 'SCIENCES', 'SPORTS', 'TELEVISION', 'TOURISME', 'WEB']);
// QUADRIQUIZZ : énigmes « avec un C, il faut… » où les 4 propositions conviennent -> inutilisables en QCM
const SKIP = new Set(['ADULTES', 'MOTSCROISES', 'ORTHOQUIZZ', 'DEFI', 'ALPHAQUIZZ', 'QUADRIQUIZZ']);
const PER_RUN = 15;          // quiz téléchargés par appel (≈ 4 questions chacun)
const POOL_CAP = 6000;       // taille maximale de la réserve
const MIN_GAP_MS = 30_000;   // un remplissage au plus toutes les 30 s
const CATALOG_TTL_MS = 7 * 24 * 3600_000;
const API_BUDGET = 190;      // clé gratuite : 200 appels au total

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
}
const clean = (s: unknown) => decode(String(s ?? '')).replace(/\s+([?!:;»])/g, ' $1').replace(/«\s+/g, '« ');

async function getMeta(key: string) {
  const { data } = await sb.from('meta').select('value').eq('key', key).maybeSingle();
  return (data?.value ?? null) as Record<string, unknown> | null;
}
async function setMeta(key: string, value: unknown) {
  await sb.from('meta').upsert({ key, value, updated_at: new Date().toISOString() });
}

// ---------- catalogue ----------
async function refreshCatalog() {
  const r = await fetch(BASE + '/listing/', { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('listing ' + r.status);
  const html = await r.text();
  const re = /<div id="([A-Z]+)"><\/div>|title="Cliquez ici pour t[^"]*r[ée]dig[ée] par ([^"]*)" onclick="goq\((\d+)\)">([^<]*)</g;
  const found = new Map<number, { cats: Set<string>; title: string; author: string }>();
  let cat = '';
  for (const m of html.matchAll(re)) {
    if (m[1]) { cat = m[1]; continue; }
    const id = +m[3];
    const e = found.get(id) ?? { cats: new Set<string>(), title: decode(m[4]), author: decode(m[2]) };
    if (cat) e.cats.add(cat);
    found.set(id, e);
  }
  const { data: known } = await sb.from('quiz_sources').select('id');
  const have = new Set((known ?? []).map((x) => x.id));
  const rows = [...found.entries()].filter(([id]) => !have.has(id)).map(([id, e]) => {
    const cats = [...e.cats];
    const bad = cats.some((c) => SKIP.has(c)) || !cats.some((c) => ALLOWED.has(c)) || /^quadriquizz/i.test(e.title);
    const categ = cats.find((c) => ALLOWED.has(c)) ?? cats[0] ?? null;
    return { id, categ, title: e.title.slice(0, 120), author: e.author.slice(0, 80), status: bad ? 'skip' : 'todo' };
  });
  for (let i = 0; i < rows.length; i += 200) await sb.from('quiz_sources').insert(rows.slice(i, i + 200));
  await setMeta('oq_catalog', { at: new Date().toISOString(), total: found.size, added: rows.length });
  return rows.length;
}

// ---------- conversion d'une question ----------
const NUM = /^-?\d{1,3}(?:[\s  .]\d{3})+$|^-?\d+$/;
const toInt = (s: string) => parseInt(s.replace(/[\s  .]/g, ''), 10);
function shuffle<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

type Raw = { question?: string; propositions?: string[]; ['réponse']?: string; anecdote?: string };
function convert(raw: Raw, id: string, extra: { source: number | null; categ: string | null; theme: string; author: string; d?: number }) {
  const q = clean(raw.question);
  const props = (raw.propositions ?? []).map(clean).filter(Boolean);
  const rep = clean(raw['réponse']);
  if (q.length < 8 || q.length > 170 || props.length !== 4 || new Set(props.map((p) => p.toLowerCase())).size !== 4) return null;
  if (!props.includes(rep) || props.some((p) => p.length > 45)) return null;
  if (/\b(ce quiz|cette image|cette photo|ci-dessous|ci-contre)\b/i.test(q)) return null;
  const anec = clean(raw.anecdote).replace(/^-$/, '').slice(0, 260) || null;
  const base = { id, source: extra.source, categ: extra.categ, theme: extra.theme, author: extra.author, d: extra.d ?? 2, anec };
  // réponse numérique et question ouverte -> Estimation
  if (props.every((p) => NUM.test(p)) && !/\b(parmi|lequel|laquelle|lesquel|duquel|ces)\b/i.test(q)) {
    const a = toInt(rep);
    if (Number.isFinite(a) && Math.abs(a) >= 3) {
      const m = /^combien (?:de |d['’])([a-zà-ÿœ-]+)/i.exec(q);
      const u = m && !/^(fois|temps)$/i.test(m[1]) ? m[1].toLowerCase() : '';
      return { ...base, kind: 'estimation', q, c: null, a, u };
    }
  }
  const c = shuffle(props.slice());
  return { ...base, kind: 'culture', q, c, a: c.indexOf(rep), u: '' };
}

// ---------- téléchargement d'un quiz ----------
async function fetchQuiz(src: { id: number; categ: string | null; title: string; author: string }) {
  const page = await fetch(BASE + '/download.php', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'id=' + src.id,
  });
  if (!page.ok) throw new Error('download.php ' + page.status);
  const html = await page.text();
  const link = /https:\/\/download\.openquizzdb\.org\/[^"'\s]+\.json/.exec(html)?.[0];
  if (!link) throw new Error('pas de lien JSON');
  await sleep(400);
  const r = await fetch(link, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('json ' + r.status);
  const txt = (await r.text()).replace(/^﻿/, '');
  const j = JSON.parse(txt);
  const theme = clean(j['thème'] ?? src.title).slice(0, 120);
  const author = clean(j['rédacteur'] ?? src.author).slice(0, 80);
  const list: Raw[] = Array.isArray(j.quizz) ? j.quizz : [];
  return list.map((raw, i) => convert(raw, `oq${src.id}-${i + 1}`, { source: src.id, categ: src.categ, theme, author }))
    .filter(Boolean);
}

// ---------- API officielle (facultative) ----------
async function fromApi(key: string, max: number) {
  const st = (await getMeta('oq_api')) ?? { calls: 0 };
  let calls = Number(st.calls) || 0, got = 0;
  const rows = [];
  for (let i = 0; i < max && calls < API_BUDGET; i++) {
    calls++;
    const r = await fetch(`https://api.openquizzdb.org/?key=${encodeURIComponent(key)}&lang=fr&choice=4`, { headers: { 'User-Agent': UA } });
    const j = await r.json().catch(() => null);
    if (!j || j.response_code !== 0 || !j.results?.length) { st.last_error = j?.response_code ?? r.status; break; }
    const x = j.results[0];
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(x.question))))
      .slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
    const d = /expert/i.test(x.difficulte) ? 3 : /d[ée]butant/i.test(x.difficulte) ? 1 : 2;
    const props = [x.reponse_correcte, ...(x.autres_choix ?? []).filter((p: string) => p !== x.reponse_correcte)].slice(0, 4);
    const row = convert({ question: x.question, propositions: props, ['réponse']: x.reponse_correcte, anecdote: x.anecdote },
      'oqa-' + hash, { source: null, categ: x.categorie ?? null, theme: x.theme ?? '', author: 'OpenQuizzDB', d });
    if (row) { rows.push(row); got++; }
    await sleep(300);
  }
  if (rows.length) await sb.from('quiz_pool').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  await setMeta('oq_api', { ...st, calls, at: new Date().toISOString() });
  return got;
}

Deno.serve(async (req) => {
  const out: Record<string, unknown> = {};
  try {
    const last = await getMeta('oq_refill');
    if (last?.at && Date.now() - Date.parse(String(last.at)) < MIN_GAP_MS) {
      return Response.json({ skipped: 'trop tôt' });
    }
    await setMeta('oq_refill', { ...(last ?? {}), at: new Date().toISOString(), running: true });

    const cat = await getMeta('oq_catalog');
    if (!cat?.at || Date.now() - Date.parse(String(cat.at)) > CATALOG_TTL_MS) out.catalogAdded = await refreshCatalog();

    const { count } = await sb.from('quiz_pool').select('id', { count: 'exact', head: true });
    out.poolBefore = count ?? 0;
    let added = 0, quizzes = 0;
    const errors: string[] = [];
    if ((count ?? 0) < POOL_CAP) {
      const { data: todo } = await sb.from('quiz_sources').select('id, categ, title, author').eq('status', 'todo').limit(400);
      const pick = shuffle(todo ?? []).slice(0, PER_RUN);
      for (const src of pick) {
        try {
          const rows = await fetchQuiz(src);
          if (rows.length) await sb.from('quiz_pool').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
          await sb.from('quiz_sources').update({ status: 'done', n: rows.length, fetched_at: new Date().toISOString() }).eq('id', src.id);
          added += rows.length; quizzes++;
        } catch (e) {
          errors.push(src.id + ': ' + (e as Error).message);
          await sb.from('quiz_sources').update({ status: 'error', fetched_at: new Date().toISOString() }).eq('id', src.id);
        }
        await sleep(600);
      }
    }
    const key = Deno.env.get('OQDB_KEY');
    if (key) out.fromApi = await fromApi(key, 10);
    Object.assign(out, { quizzes, added, errors });
    await setMeta('oq_refill', { at: new Date().toISOString(), ...out });
    return Response.json(out);
  } catch (e) {
    out.error = (e as Error).message;
    await setMeta('oq_refill', { at: new Date().toISOString(), ...out });
    return Response.json(out, { status: 500 });
  }
});
