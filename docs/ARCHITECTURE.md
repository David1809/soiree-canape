# Architecture — où chercher quoi

| Fichier | Taille | Rôle | Comment le lire |
|---|---|---|---|
| `engine.js` | 1450 l. | Règles, scores, tours, pioche des questions, comparaison tolérante des réponses | `GAMES` en tête (l. 8) ; ensuite `Engine.prototype.*` : `handle`/`answer`/`command` (messages), `startQuestion` (mise en place d'une épreuve), `closeQuestion` (scores), `finish` |
| `app.js` | 2450 l. | Interface téléphone + télé, connexion Supabase, sons | `renderPhone`/`phoneXxx()` = écrans téléphone ; `tvXxx()` = écrans télé (`tvLobby`, `tvQuestion`, `tvReveal`, `tvFinal`) ; `makeEngine`, `hello` = réseau |
| `style.css` / `old.css` | 550 l. | Styles ; `old.css` est GÉNÉRÉ (ne pas éditer) | `python3 tools/make_old_css.py` |
| `questions.js` | 900 Ko | Banque de questions locale | Jamais en entier : `grep -n "texte"` |
| `geo.js` | 84 Ko | Cartes du jeu Géo-Devine | idem |
| `words/<lettre>.txt` | 26 fichiers | Dictionnaire (minuscules, sans accents) pour Petit Bac, Rébus, Croquis | chargé à la demande par `o.loadWords` |
| `flags/*.svg` | | Drapeaux (licence flag-icons) | |
| `vendor/` | | supabase.js, qrcode.js, legacy.js (compat. vieille télé) | ne pas modifier |
| `tv/index.html` | | Page d'entrée de la télé | |
| `mystere/` | | Jeu « Soirée Mystère » (moteur + app propres) | indépendant |
| `sw.js` | | Service worker (cache, numéro de version) | |
| `supabase/` | | Migrations SQL et fonction `refill-pool` | voir `docs/SUPABASE.md` |
| `tests/` | | Tests Node du moteur | `sh tests/run.sh` |

## Écrans et états
- Un salon = une ligne `rooms` ; l'hôte (un téléphone) fait tourner `Engine` et publie l'état (`publicView`) ; les autres affichent.
- Phases d'une épreuve : question → réponses → (vote/vérif pour Bluff, Petit Bac, Imposteur) → révélation → classement.
- 8 joueurs : classes CSS `many` (`.side.many`, `.players.many`, `.podium.many`) pour la télé.

## Ajouter un jeu (checklist)
1. `GAMES` (engine.js) + mise en place dans `startQuestion` + scores dans `closeQuestion`.
2. Écran téléphone (`phoneXxx`) et télé (`tvQuestion`/`tvReveal`) dans app.js ; styles dans style.css puis régénérer old.css.
3. Banque de questions ou règle de tirage (`buildDeck`).
4. Test dans `tests/`, mise à jour de `docs/JEUX.md`, nouvelle version.
