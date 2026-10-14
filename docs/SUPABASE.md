# Supabase (projet `qsyrrcrknxdkdsxkoooa`)

Tables (RLS activé partout) : `rooms` (salons), `played` (historique/classement), `games`, `reports` (signalements), `meta`, `quiz_pool` + `quiz_sources` (questions en ligne), `seen` (questions déjà vues).
Fonction : `supabase/functions/refill-pool` (remplit `quiz_pool`) ; migration : `supabase/migrations/`.
Clé publique et URL : en tête de `app.js` (`SB_URL`).

## Règles
- Lecture libre (`list_tables`, `execute_sql` en SELECT). Écriture (migration, secret, déploiement) : seulement si David le demande.
- Jamais de DDL via `execute_sql`. Toujours une migration dans `supabase/migrations/`.
- Si une écriture renvoie `{"status":"cancelled"}` : la connexion Supabase du connecteur doit être refaite par David (ça a réglé le problème le 14 oct. 2026) ; ne pas contourner.
- Projet dédié envisagé : changer `SB_URL`/clé dans `app.js`, recopier tables, fonction et secrets, puis nouvelle version.
