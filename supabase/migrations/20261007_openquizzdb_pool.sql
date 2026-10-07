-- Dé-lire — réserve de questions OpenQuizzDB (état appliqué au projet Supabase le 07/10/2026)
-- Rejouable : tout est en « if not exists » / « create or replace ».

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Catalogue des quiz OpenQuizzDB (rempli par la fonction Edge refill-pool)
create table if not exists public.quiz_sources (
  id int primary key,
  categ text,
  title text,
  author text,
  status text not null default 'todo' check (status in ('todo','done','skip','error')),
  n int not null default 0,
  fetched_at timestamptz
);
alter table public.quiz_sources enable row level security;

-- Réserve de questions (culture : QCM ; estimation : réponse numérique)
create table if not exists public.quiz_pool (
  id text primary key,                 -- oq<quiz>-<n> (téléchargements) ou oqa-<hash> (API)
  kind text not null check (kind in ('culture','estimation')),
  source int references public.quiz_sources(id) on delete cascade,
  categ text,
  theme text,
  d smallint not null default 2,
  q text not null,
  c jsonb,
  a jsonb not null,
  u text not null default '',
  anec text,
  author text,
  added_at timestamptz not null default now()
);
create index if not exists quiz_pool_kind on public.quiz_pool(kind);
alter table public.quiz_pool enable row level security;

-- Historique par joueur (prénom normalisé)
create table if not exists public.seen (
  player text not null,
  qid text not null,
  seen_at timestamptz not null default now(),
  primary key (player, qid)
);
create index if not exists seen_qid on public.seen(qid);
alter table public.seen enable row level security;
-- aucune politique : ces trois tables ne sont accessibles qu'à travers les fonctions ci-dessous

create or replace function public.norm_player(p text) returns text
language sql immutable set search_path = '' as $$
  select left(lower(btrim(coalesce(p, ''))), 40)
$$;

-- Questions jouables : quiz récupéré (pas écarté) et question non signalée
create or replace view public.quiz_live with (security_invoker = true) as
  select p.* from public.quiz_pool p
  where (p.source is null or exists (select 1 from public.quiz_sources s where s.id = p.source and s.status = 'done'))
    and not exists (select 1 from public.reports r where r.qid = p.id);
revoke all on public.quiz_live from anon, authenticated;

-- Lot du salon : d'abord les questions qu'aucun joueur présent n'a vues, puis les plus anciennement vues.
-- Si la réserve d'inédites passe sous 80 pour ce groupe, relance un remplissage (au plus toutes les 10 min).
create or replace function public.draw_pack(p_players text[], p_culture int default 15, p_estimation int default 10, p_diff text default 'mixte')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pl text[];
  res jsonb;
  unseen int;
  last_refill timestamptz;
begin
  pl := array(select public.norm_player(x) from unnest(coalesce(p_players, '{}')) x where btrim(coalesce(x,'')) <> '' limit 12);
  p_culture := greatest(0, least(coalesce(p_culture, 0), 40));
  p_estimation := greatest(0, least(coalesce(p_estimation, 0), 40));

  with cand as (
    select p.*, ls.last_seen,
           row_number() over (partition by p.kind order by ls.last_seen asc nulls first,
             case when p_diff = 'facile' and p.d > 2 then 1 when p_diff = 'difficile' and p.d < 2 then 1 else 0 end,
             random()) as rk
    from public.quiz_live p
    left join lateral (select max(s.seen_at) as last_seen from public.seen s where s.qid = p.id and s.player = any(pl)) ls on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'g', kind, 'd', d, 'q', q, 'c', c, 'a', a, 'u', u,
      'info', nullif(btrim(coalesce(anec, '')), '-'),
      'src', jsonb_build_object('n', 'OpenQuizzDB', 'by', author, 't', theme), 'new', last_seen is null)), '[]'::jsonb)
    into res
  from cand
  where (kind = 'culture' and rk <= p_culture) or (kind = 'estimation' and rk <= p_estimation);

  select count(*) into unseen from public.quiz_live p
   where p.kind = 'culture' and not exists (select 1 from public.seen s where s.qid = p.id and s.player = any(pl));
  if unseen < 80 then
    select (value->>'at')::timestamptz into last_refill from public.meta where key = 'oq_refill_req';
    if last_refill is null or last_refill < now() - interval '10 minutes' then
      insert into public.meta(key, value, updated_at) values ('oq_refill_req', jsonb_build_object('at', now(), 'unseen', unseen), now())
        on conflict (key) do update set value = excluded.value, updated_at = now();
      perform net.http_post(url := 'https://qsyrrcrknxdkdsxkoooa.supabase.co/functions/v1/refill-pool',
                            body := jsonb_build_object('why', 'low', 'unseen', unseen),
                            timeout_milliseconds := 60000);
    end if;
  end if;
  return res;
end $$;

create or replace function public.mark_seen(p_players text[], p_qid text)
returns void language sql security definer set search_path = '' as $$
  insert into public.seen(player, qid)
  select distinct public.norm_player(x), left(p_qid, 60) from unnest(coalesce(p_players, '{}')) x
  where btrim(coalesce(x,'')) <> '' and coalesce(p_qid,'') <> ''
  on conflict (player, qid) do update set seen_at = now();
$$;

create or replace function public.pool_stats(p_players text[] default '{}')
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'culture', (select count(*) from public.quiz_live where kind = 'culture'),
    'estimation', (select count(*) from public.quiz_live where kind = 'estimation'),
    'quizzes', (select count(*) from public.quiz_sources where status = 'done'),
    'catalog', (select count(*) from public.quiz_sources where status <> 'skip'),
    'unseen', (select count(*) from public.quiz_live p where not exists (
        select 1 from public.seen s where s.qid = p.id
        and s.player = any(array(select public.norm_player(x) from unnest(coalesce(p_players, '{}')) x)))));
$$;

-- Remise à zéro de l'historique : réservée à l'administration (pas exposée aux joueurs)
create or replace function public.reset_seen(p_prefix text)
returns void language sql security definer set search_path = '' as $$
  delete from public.seen where qid like (left(coalesce(p_prefix, 'zz'), 10) || '%');
$$;

revoke all on function public.draw_pack(text[], int, int, text) from public;
revoke all on function public.mark_seen(text[], text) from public;
revoke all on function public.pool_stats(text[]) from public;
revoke all on function public.reset_seen(text) from public, anon, authenticated;
grant execute on function public.draw_pack(text[], int, int, text) to anon, authenticated;
grant execute on function public.mark_seen(text[], text) to anon, authenticated;
grant execute on function public.pool_stats(text[]) to anon, authenticated;

-- Tâches planifiées
select cron.schedule('seen-purge', '23 3 * * 0', $$delete from public.seen where seen_at < now() - interval '1 year'$$);
select cron.schedule('oq-refill-daily', '17 4 * * *',
  $$select net.http_post(url := 'https://qsyrrcrknxdkdsxkoooa.supabase.co/functions/v1/refill-pool', body := '{"why":"cron"}'::jsonb, timeout_milliseconds := 120000)$$);
