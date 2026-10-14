# Publier une nouvelle version

1. Tests : `sh tests/run.sh` (tous « OK »).
2. Monter le numéro (NN → NN+1) :
   - `index.html` : 9 occurrences de `?v=NN`
   - `app.js` : 1 occurrence (`app.js?v=NN` dans la détection de version)
   - `sw.js` : `CACHE = 'soiree-canape-vNN'`
   - Vérifier : `grep -o "?v=[0-9]*" index.html | sort | uniq -c`
3. Si le CSS a changé : `python3 tools/make_old_css.py` (nouvelles règles de colonne : écrire `flex-direction: column` explicitement).
4. Commit en français, une ligne, numéro de version entre parenthèses, puis `git push origin main`. GitHub Pages republie en 1–2 min.
5. Vérifier en vrai : téléphone, et télé pour tout ce qui touche à l'affichage.

## Vieille télé (Chrome 56)
ES5 uniquement, emojis Unicode 9, pas de `gap` en flex fiable (marges), `old.css` généré.
