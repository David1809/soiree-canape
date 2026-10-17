# Sources de données et licences

Dernière vérification : 17 oct. 2026. À mettre à jour à chaque nouvelle source.
Le jeu est jouable par des personnes extérieures à la famille : toute source doit avoir une licence connue.

## Confirmé (licence connue, fichier ou crédit présent)
| Quoi | Où | Licence | Obligation | Statut |
|---|---|---|---|---|
| Drapeaux (flag-icons) | `flags/*.svg` | MIT | garder `flags/LICENSE-flag-icons.txt` | OK, fichier présent |
| Carte du monde (Natural Earth via world-atlas) | `geo.js` | domaine public | aucune | OK |
| Générateur de QR codes | `vendor/qrcode.js` | MIT | garder l'en-tête de licence | OK, en-tête présent |

## Indiqué mais non confirmé
| Quoi | Où | Licence indiquée | Problème |
|---|---|---|---|
| Questions OpenQuizzDB (~1 300 en base, 1 296 d'un seul auteur) | tables `quiz_sources` / `quiz_pool`, fonction `supabase/functions/refill-pool` | CC BY-SA 4.0 (commentaire du code) | La page d'accueil d'openquizzdb.org ne cite aucune licence (« contenus gratuits, sans publicité, sans IA »). Origine de l'indication CC BY-SA non retrouvée. |

Obligations si CC BY-SA 4.0 est bien la licence : citer l'auteur, la source et la licence (déjà fait dans le jeu : `app.js`, crédit sous chaque question et dans les réglages) ; repartager les adaptations sous la même licence.
À faire : confirmer la licence et les conditions de téléchargement automatique sur la page de téléchargement d'openquizzdb.org ou via leur formulaire de contact, et garder une copie de la réponse dans ce dossier.

## Origine inconnue (à documenter)
| Quoi | Où | Problème |
|---|---|---|
| Dictionnaire français (~322 000 mots, formes conjuguées, sans accents) | `words/*.txt`, ajouté le 13 oct. 2026 (commit `43128f0`) | Source et licence non notées nulle part. Aucun script de génération dans `tools/`. Certaines listes de mots françaises sont libres, d'autres non. |
| Banques de questions écrites à la main | `questions.js` | Origine non vérifiée (probablement rédigées pour le jeu). |
| Bibliothèques empaquetées | `vendor/supabase.js`, `vendor/legacy.js` | Pas d'en-tête de licence lisible. supabase-js est en principe MIT ; `legacy.js` semble être un paquet de compatibilité (polyfills) dont l'origine est à retrouver. |

À faire : retrouver d'où vient `words/` (ou le remplacer par une liste à licence connue, par exemple un dictionnaire libre avec sa licence copiée dans `words/`), identifier le contenu exact de `legacy.js`, ajouter les licences manquantes.

## Règle pour toute nouvelle source
Avant d'ajouter des données (mots, questions, images, sons, polices, bibliothèques) : noter ici la source, la licence et l'obligation de crédit, et copier le texte de licence à côté des fichiers quand il est exigé.
