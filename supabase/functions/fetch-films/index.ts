// Dé-lire — collecte des films pour le jeu « Titres de films » (données TMDB, mention obligatoire).
// Prend des films très connus dont le titre français diffère du titre d'origine, et enregistre leurs titres
// dans des pays à alphabet latin. Aucune IA : la traduction et la vérification sont faites ensuite, hors de cette fonction.
// Appel : POST { "limit": 50 }  (clé TMDB dans le secret TMDB_API_KEY)
import { createClient } from 'npm:@supabase/supabase-js@2';

const TMDB = 'https://api.themoviedb.org/3';
const KEY = Deno.env.get('TMDB_API_KEY') ?? '';
const MAX_PER_CALL = 60;
const MIN_GAP_MS = 20_000;
const MIN_VOTES = 3000;          // films vraiment connus
const MIN_TITLES = 3;            // au moins 3 titres étrangers distincts (bonnes réponses + mauvaises réponses)
// Pays à alphabet latin : titres lisibles et vérifiables. Les autres (JP, CN, KR, RU…) viendront plus tard.
const COUNTRIES = ['DE', 'ES', 'MX', 'AR', 'IT', 'PT', 'BR', 'NL', 'PL', 'SE', 'DK', 'NO', 'FI', 'TR', 'HU', 'CZ', 'RO', 'HR', 'ID'];

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

async function tmdb(path: string, params: Record<string, string> = {}) {
  const u = new URL(TMDB + path);
  u.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error('TMDB ' + path + ' ' + r.status);
  return await r.json();
}

Deno.serve(async (req) => {
  if (!KEY) return json({ error: 'TMDB_API_KEY manquante' }, 500);
  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(MAX_PER_CALL, Number(body.limit) || 50));
  const lang = String(body.original_language || 'en');

  const { data: last } = await sb.from('meta').select('value').eq('key', 'films:last').maybeSingle();
  const lastAt = Number((last?.value as { at?: number } | null)?.at || 0);
  if (Date.now() - lastAt < MIN_GAP_MS) return json({ error: 'trop tôt, réessayez dans quelques secondes' }, 429);
  await sb.from('meta').upsert({ key: 'films:last', value: { at: Date.now() }, updated_at: new Date().toISOString() });

  const { data: known } = await sb.from('films').select('tmdb_id');
  const have = new Set((known ?? []).map((x) => x.tmdb_id as number));
  let added = 0, seen = 0, skipped = 0;
  const films: string[] = [];

  for (let page = 1; page <= 40 && added < limit; page++) {
    const list = await tmdb('/discover/movie', {
      language: 'fr-FR', sort_by: 'vote_count.desc', with_original_language: lang,
      'vote_count.gte': String(MIN_VOTES), page: String(page), include_adult: 'false',
    });
    if (!list.results?.length) break;
    for (const m of list.results) {
      if (added >= limit) break;
      if (have.has(m.id)) continue;
      seen++;
      const orig = String(m.original_title || '');
      const fr = String(m.title || '');
      if (!orig || !fr || norm(orig) === norm(fr)) { skipped++; continue; }       // titre gardé tel quel en France
      const tr = await tmdb('/movie/' + m.id + '/translations');
      const titles = new Map<string, { country: string; lang: string; title: string }>();
      for (const t of tr.translations ?? []) {
        const country = String(t.iso_3166_1 || ''), title = String(t.data?.title || '').trim();
        if (!COUNTRIES.includes(country) || !title) continue;
        const n = norm(title);
        if (!n || n === norm(orig) || n === norm(fr)) continue;                   // identique à l'original ou au français
        if (!titles.has(n)) titles.set(n, { country, lang: String(t.iso_639_1 || ''), title });
      }
      if (titles.size < MIN_TITLES) { skipped++; continue; }
      const year = Number(String(m.release_date || '').slice(0, 4)) || null;
      const { error: e1 } = await sb.from('films').upsert({
        tmdb_id: m.id, title_fr: fr, title_orig: orig, year, poster_path: m.poster_path ?? null,
        popularity: m.popularity ?? null, votes: m.vote_count ?? null, status: 'new',
      });
      if (e1) throw new Error('films: ' + e1.message);
      const rows = [...titles.values()].map((t) => ({ tmdb_id: m.id, country: t.country, lang: t.lang, title: t.title, status: 'new' }));
      const { error: e2 } = await sb.from('film_titles').upsert(rows, { onConflict: 'tmdb_id,country,title', ignoreDuplicates: true });
      if (e2) throw new Error('film_titles: ' + e2.message);
      added++; films.push(fr + ' (' + orig + ')');
    }
  }
  return json({ added, seen, skipped, films });
});
