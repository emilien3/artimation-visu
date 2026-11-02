# Analyse de « Vector — Aircraft crossing studio » (NextQCM, ENAC)

Source : page enregistrée depuis https://recherche.enac.fr/~hurter/NextQCM/ (copie dans `vendor/nextqcm/`, non modifiée).
Outil de C. Hurter (ENAC). Hors ligne : 1 HTML, 1 CSS, 4 fichiers JS (~54 Ko), **aucune dépendance**, aucun appel réseau.

## Ce que fait l'outil
On place jusqu'à 100 avions dans une zone de 120 × 90 NM, on règle vitesse et cap en les glissant. Il calcule :
1. **Rencontres** : approche minimale sur un horizon (5-30 min) et croisement des routes (`physics.js`, `encounter`, `analyze`).
2. **Espace des caps sûrs** d'un avion (`headingSpace`) : intervalles de caps (0-360°) qui évitent tout le trafic.
3. **Carte de densité** de tous les avions (`density.js`) : où va l'avion s'il prend un cap sûr (menthe) ou en conflit (corail), avec lissage gaussien,
   éclairage et relief (`density-view.js`, `colorize`).

## Modèle
- Repère écran : x vers la droite, y vers le bas ; cap en degrés horaire depuis le nord ; vitesse en kt ; temps en minutes.
- Vitesse constante, **un seul niveau de vol** (« 2D »), virage instantané, les autres avions gardent leur vecteur.
- Conflit = distance minimale < séparation (3/5/10 NM) sur `[0, horizon]`.

## Algorithmes
| Fichier | Contenu |
|---|---|
| `physics_siQw.js` | `encounter` : approche minimale analytique (mouvement linéaire relatif) + intersection des routes. `headingSpace` : on découpe le cercle des caps aux frontières exactes (tangence au disque de séparation de chaque intrus, contact à l'horizon), on teste chaque intervalle, on réunit les intervalles bloqués. Exact, sans échantillonnage. |
| `density_siQw.js` | Pour chaque avion et chaque cellule à portée (`vitesse × horizon`), le cap qui y mène est sûr (+1) ou en conflit (+nombre d'intrus). Somme sur les avions, lissage gaussien séparable (remplissage nul), **priorité stricte** du négatif sur le positif. Palettes diverging en lumière linéaire, éclairage Blinn-Phong sur le relief de la densité, transition lissée à la frontière positif/négatif. Un `Worker` (Blob) évite de bloquer l'interface. |
| `density-view_siQw.js` | Contrôleur UI de la densité : Worker avec repli sur le thread principal, annulation, réglages (grille, noyau, palette, relief, brillance). |
| `app_siQw.js` | État, rendu SVG, glisser-déposer, lecture temporelle, panneau d'analyse des rencontres. Expose aussi un outil `read_aircraft_scenario` via `document.modelContext` (lecture seule). |

## Lien avec le travail ARTIMATION déjà réimplémenté
- La **HeatMap du GA** (papier Hurter et al. 2022) est une exploration *stochastique* de manœuvres `(t1, t2, α)` ; la **densité de Vector** est le calcul *exact*
  des caps sûrs pour un virage simple. Les deux répondent à « où l'avion peut-il passer sans conflit ? ».
- Les scénarios ARTIMATION (positions, vitesses, caps à l'instant t) se convertissent en avions Vector : `studio.aircraft_at`.

## Intégration réalisée
- `src/artimation/vector.py` : **portage Python** de `physics.js` + `density.js`, validé contre le JS d'origine exécuté sous node
  (`tests/test_vector.py` : 100 % des cellules d'une grille 160 × 120 identiques, mêmes intervalles de caps), puis **étendu à l'altitude**
  (`encounter3d`, `heading_space3d`, `density_maps3d` : conflit = cylindre NM × ft ; au même niveau on retrouve le 2D).
- `src/artimation/studio_ui.py` + `studio_view.py` : **un seul outil**. Les onglets « GA » et « Vector » ont été fusionnés : même situation, mêmes réglages, mêmes panneaux ;
  seule la fenêtre de vue change entre 2D et 3D.
- `src/artimation/studio.py` : outil d'origine reconstruit en mémoire (CSS/JS en ligne) avec un hook `VectorStudio.load()`, gardé comme volet de référence (iframe isolée :
  ses modifications ne remontent pas dans le studio, d'où la fusion par réimplémentation plutôt que par intégration de l'iframe).
- Perdu dans la fusion : le glisser-déposer des avions sur la carte (remplacé par un tableau éditable). Récupérable avec un composant Streamlit bidirectionnel si besoin.

## Limites connues
- Le rendu 3D n'a pas pu être contrôlé visuellement (pas de WebGL dans l'environnement de test) ; la géométrie des figures est testée.
- Les vols des scénarios ENAC sont au FL360 (recoupés avec `exo_artimation.txt`) ; l'altitude est donc un paramètre d'exploration.
