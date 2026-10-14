# Dé-lire — jeu de soirée en famille

Appli web statique (JS ES5 sans framework), hébergée sur GitHub Pages, branche `main` = en ligne.
Téléphones = manettes ; une télé (vieille Samsung Tizen, Chrome 56) peut servir de tableau commun.
Données en ligne : Supabase (projet `qsyrrcrknxdkdsxkoooa`). Langue de travail : français.

## Règles de travail (économie de jetons)
- NE JAMAIS lire en entier `questions.js` (900 Ko), `geo.js`, `app.js`, `engine.js`. Chercher avec Grep, lire par plages.
- Commencer par `docs/ARCHITECTURE.md` (où se trouve quoi), puis seulement la fiche utile :
  `docs/JEUX.md` (règles des jeux), `docs/PUBLICATION.md` (nouvelle version, tests), `docs/SUPABASE.md` (base).
- Garder les réponses courtes ; pas de recopie de code dans la conversation.

## Garde-fous
- Compatibilité vieille télé : pas de syntaxe ES6+ dans `app.js`/`engine.js` (var, function, pas de flèches/let/const/template strings) ; `old.css` est généré par `tools/make_old_css.py`.
- Moteur autoritaire côté hôte (`engine.js`) : l'état se synchronise par Supabase Realtime.
- Avant de pousser : `sh tests/run.sh` doit tout passer, puis monter la version (voir PUBLICATION).
- Ne rien créer en base sans demande ; pas de DDL via `execute_sql`.
- Travail en cours sur une branche, `main` reste déployable.

## Décisions déjà prises (ne pas rediscuter)
- Jusqu'à 8 joueurs par salon ; stats/classement partagés entre familles (pas de cloisonnement).
- Pas d'API Claude dans le jeu. Jeu « titres de films » abandonné (14 oct. 2026).
- Finale : tous les jeux sauf Pyramide et Croquis, 3 dernières manches comptées double (règle confirmée par David le 14 oct. 2026).
- « Soirée Mystère » (dossier `mystere/`) : autre jeu, même socle.
