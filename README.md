# ARTIMATION · XAI pour le trafic aérien (retard au décollage + résolution de conflits)

Réimplémentation de **« When a CBR in Hand is Better than Twins in the Bush »**
(Ahmed, Barua, Begum, Islam, Weber — XCBR'22, [arXiv:2305.05111](https://arxiv.org/abs/2305.05111)),
travail de l'équipe qui coordonne le projet SESAR [ARTIMATION](https://www.sesarju.eu/projects/artimation) (Mälardalen University).

## Ce qui est réimplémenté
| Élément du papier | Ici |
|---|---|
| XGBoost (lr 0.1, depth 7, min_child_weight 1, subsample 0.5, colsample 0.5, 500 arbres) | `models.train_xgb` |
| CBR : k=3, distance euclidienne pondérée par l'importance XGBoost, similarité symbolique/numérique | `models.WeightedCBR` |
| CBR additif (équation 3, γ = ŷ / Σ x·w) | `WeightedCBR.additive_attributions` |
| SHAP, LIME (1000 perturbations/échantillons) | `explain.py` |
| MAE, précision locale, nDCG, sous-ensembles All / 100k / 67k | `experiment.py` (tables 1 à 3) |

## Écarts avec le papier (à connaître)
- **Données synthétiques.** Les données EUROCONTROL/ETFMS 2019 (5,9 M de vols) sont privées. `data.py` génère 42 variables de même nature (vol, vol précédent, régulation ATFM, météo, aéroports) structurées autour de situations opérationnelles récurrentes.
- **Hiérarchie des modèles et des explications.** Comme dans l'article, le CBR ($k=3$) bat XGBoost sur les situations opérationnelles récurrentes (Table 1), SHAP vérifie la précision locale (~1e-6 min) tandis que LIME (discrétisé par quartiles dans $z' \in \{0,1\}^d$) s'écarte de plusieurs minutes (Table 2), et LIME s'accorde davantage avec le CBR Global alors que SHAP est plus proche du CBR Additif (Table 3). Les valeurs numériques exactes diffèrent de celles du jeu privé EUROCONTROL.
- **TreeSHAP** (exact, par défaut) et **KernelSHAP** (`--shap-method kernel`) ; 500 vols expliqués par défaut au lieu de 158 147.
- Les sous-ensembles « 100k » / « 67k » reprennent les mêmes proportions (63,6 % / 42,7 % des instances les plus précises).

## Utilisation
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # macOS : brew install libomp
PYTHONPATH=src .venv/bin/python -m artimation.experiment             # tables 1-3 (~10 s)
.venv/bin/streamlit run app.py                                       # visualisation
.venv/bin/python -m pytest                                           # tests
```

## Second papier : résolution de conflits par algorithme génétique
Réimplémentation de **« Usage of more Transparent and Explainable Conflict Resolution Algorithm: Air Traffic Controller Feedback »**
(Hurter, Degas, Durand, Guibert, Ahmed, Begum et al., *Transportation Research Procedia* 66, 2022). Studio (onglet 6 de l'app).

| Élément | Ici |
|---|---|
| Gène par avion `(t1, t2, α)` : virage de α° à t1, vol droit jusqu'à t2, retour direct au dernier waypoint | `conflict.maneuver_path` |
| Fitness : durée des conflits, longueur ajoutée, nombre de manœuvres | `conflict.evaluate` |
| AG : sélection par tournoi, croisement par avion, mutation, élitisme, immigrants aléatoires (100 × 100) | `ga.run_ga` |
| Explication **BlackBox** (solution seule) vs **HeatMap** (tout l'espace exploré : vert > 7 NM, rouge < 7 NM) | `conflict.heat_layers` + app |
| 10 scénarios réels ENAC 2016 (Zenodo 7437564, CC BY 4.0) | `data/scenarios/` |
| Solutions du GA original (Zenodo 7437654) | `scripts/fetch_zenodo.py` (49 Mo, optionnel) |

**Validation.** Le codage du gène a été déduit des trajectoires du jeu ENAC. Sur ~10 000 solutions par scénario, ma distance minimale
corrèle à 0,99-0,9999 avec celle du GA original (écart médian 0-0,2 NM). Mon GA trouve une solution sans conflit (≥ 7 NM) sur les 10 scénarios en 1 à 3 s.

**Écarts.** Les paramètres du GA original (taille, taux, fitness exacte) ne sont pas publiés : choix raisonnables ici. Les valeurs de fitness ne sont donc pas
comparables à celles de l'ENAC. L'étude utilisateurs (21 contrôleurs, EEG) n'est pas reproduite, seules les deux interfaces le sont.

## Vector+ : l'outil de l'ENAC étendu (altitude, algorithme génétique, HeatMap, 2D / 3D)
Le code de « Vector — Aircraft crossing studio » (C. Hurter, ENAC ; page enregistrée de https://recherche.enac.fr/~hurter/NextQCM/, copie **intacte** dans `vendor/nextqcm/`)
a été **extrait et étendu** : il devient la base de notre outil (`src/artimation/web/`). Analyse détaillée : [`docs/NEXTQCM_ANALYSIS.md`](docs/NEXTQCM_ANALYSIS.md).
C'est une page HTML autonome (onglet 6 de l'app, ou fichier téléchargeable qui marche hors ligne).

**Fonctions de l'outil d'origine, conservées** : placer des avions (clic), glisser, orienter le vecteur (poignée), flèches du clavier, générer N avions,
Lecture / pause / chronologie / vitesse de lecture, horizon et séparation, analyse des rencontres (focus), caps sûrs (plages, secteurs cliquables),
carte de densité (canal, avion, lissage, grille, échelle, dégradé, luminosité, relief, brillance).

**Ajouts** :
- **Altitude** : niveau et taux vertical par avion ; conflit = < 7 NM ET < 1 000 ft (cylindre) ; au même niveau, le modèle 2D d'origine est un cas particulier.
- **Algorithme génétique** (Hurter et al. 2022) dans le navigateur (≈ 0,5 s) : cap et changement de niveau, solution BlackBox ou HeatMap des solutions explorées, consignes,
  « à toi de jouer » (modifier les manœuvres), courbes (évolution, séparation horizontale et verticale).
- **Dix scénarios réels** d'ARTIMATION (FL360, recoupés avec `exo_artimation.txt`) et la solution de l'algorithme original de l'ENAC si elle est téléchargée.
- **Une fenêtre, 2D ou 3D** : mêmes couches (fond, routes, solution, avions + vecteurs, zones de séparation) ; seule la projection change. 3D : altitude, temps ou relief.
  On peut placer, glisser et orienter les avions aussi en 3D, tourner (glisser) et zoomer (molette).

**Vérification** (`python3 -m pytest`, ~90 s ; nécessite `node` et, pour l'interface, Selenium + Firefox) :
- le JS étendu redonne **exactement** les résultats du JS d'origine quand l'altitude est ignorée (`tests/test_web_physics.py`) ;
- le moteur de conflit et le GA en JS == le Python, lui-même validé contre les solutions de l'ENAC (`tests/test_web_model.py`) ;
- l'interface réelle (Play, placer/glisser/orienter en 2D et en 3D, GA, altitude, panneaux) est pilotée dans Firefox (`tests/test_web_ui.py`).

**Limites.** Les paramètres exacts du GA de l'ENAC ne sont pas publiés (valeurs raisonnables ici). Les vols des scénarios sont tous au FL360 : l'altitude est un paramètre à explorer.
Le coût d'un changement de niveau dans la fitness et la vitesse verticale de 1 500 ft/min sont des choix de modélisation. Le code de Christophe n'a pas de licence affichée : à lui demander avant de partager le dépôt.

Sur macOS, `python` n'existe pas : utilise `python3` ou `.venv/bin/python`. Si l'app est déjà lancée, la relancer après une mise à jour (Streamlit ne recharge pas `src/`).
