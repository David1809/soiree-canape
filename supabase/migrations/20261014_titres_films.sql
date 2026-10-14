-- Dé-lire — jeu « Titres de films » : films connus (titre français ≠ titre d'origine)
-- et leurs titres dans d'autres pays, avec traduction française mot à mot et preuve de vérification.
-- Données : TMDB (themoviedb.org) — mention obligatoire dans l'appli. Écriture réservée au service (fonction + Claude).

create table if not exists public.films (
  tmdb_id     integer primary key,
  title_fr    text not null,            -- titre en France
  title_orig  text not null,            -- titre d'origine
  year        integer,
  poster_path text,                     -- chemin TMDB de l'affiche (version française si possible)
  popularity  real,
  votes       integer,
  status      text not null default 'new' check (status in ('new', 'ready', 'skip')),
  created_at  timestamptz not null default now()
);

create table if not exists public.film_titles (
  tmdb_id    integer not null references public.films (tmdb_id) on delete cascade,
  country    text not null,             -- ISO 3166-1 (ES, DE, IT, BR…)
  lang       text,                      -- ISO 639-1
  title      text not null,             -- titre dans la langue du pays
  fr_literal text,                      -- traduction française mot à mot
  status     text not null default 'new' check (status in ('new', 'translated', 'ok', 'rejected')),
  proof      text,                      -- sources de la vérification
  checked_at timestamptz,
  primary key (tmdb_id, country, title)
);

create index if not exists film_titles_status_idx on public.film_titles (status);

alter table public.films enable row level security;
alter table public.film_titles enable row level security;

-- Le jeu (clé publique) ne lit que ce qui est validé ; aucune écriture publique.
drop policy if exists films_read on public.films;
create policy films_read on public.films for select to anon using (status = 'ready');
drop policy if exists film_titles_read on public.film_titles;
create policy film_titles_read on public.film_titles for select to anon using (status = 'ok');
