-- Dé-lire — groupes (familles) : historique, signalements et classement séparés par groupe
-- Les données existantes passent dans le groupe « moreau ».
alter table public.played  add column if not exists fam text not null default 'moreau';
alter table public.reports add column if not exists fam text not null default 'moreau';
alter table public.games   add column if not exists fam text not null default 'moreau';

alter table public.played  drop constraint if exists played_pkey;
alter table public.played  add primary key (fam, qid);
alter table public.reports drop constraint if exists reports_pkey;
alter table public.reports add primary key (fam, qid);
create index if not exists games_fam_idx on public.games (fam, finished_at);

-- réglage de saison par groupe (clé « season:<groupe> »)
insert into public.meta (key, value, updated_at)
  select 'season:moreau', value, updated_at from public.meta where key = 'season'
  on conflict (key) do nothing;

-- salons : un salon inactif depuis plus de 2 jours est supprimé (libère son code)
select cron.schedule('rooms-purge', '41 * * * *', $$delete from public.rooms where updated_at < now() - interval '2 days'$$);
