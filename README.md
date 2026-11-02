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
- **Données synthétiques.** Les données EUROCONTROL/ETFMS 2019 (5,9 M de vols) sont privées. `data.py` génère 42 variables de même nature (vol, vol précédent, régulation ATFM, météo, aéroports).
- **Résultat inversé sur la précision.** Le papier trouve CBR (MAE 5,88) meilleur que XGBoost (9,22). Ici XGBoost est meilleur (≈4,7 contre ≈5,8), même avec 1 M de vols : le retard simulé est une fonction lisse + bruit à queues lourdes, favorable aux arbres. Les autres conclusions se reproduisent : SHAP est exactement fidèle (MAE ~1e-6), LIME s'écarte de plusieurs minutes (~3 min).
- **TreeSHAP** (exact) au lieu de KernelSHAP ; 500 vols expliqués au lieu de 158 147.
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

## Studio unique : GA + outil Vector (ENAC) + altitude, en 2D ou en 3D
Intègre « Vector — Aircraft crossing studio » (page enregistrée de https://recherche.enac.fr/~hurter/NextQCM/, copie intacte dans `vendor/nextqcm/`).
Analyse détaillée : [`docs/NEXTQCM_ANALYSIS.md`](docs/NEXTQCM_ANALYSIS.md). L'onglet 6 de l'app est **un seul outil** :

- **Une situation commune** : un scénario réel ARTIMATION (niveaux de vol éditables) ou des avions libres (tableau éditable).
- **Une fenêtre de vue** qui bascule 2D / 3D avec **les mêmes couches** : fond (HeatMap de l'AG | densité exacte Vector | aucun), routes d'origine, solution,
  avions + vecteurs vitesse à l'instant t, zones de séparation (cercles en 2D, cylindres en 3D). Axe vertical 3D : altitude, temps, ou relief de densité.
- **Des panneaux communs** : rencontres, caps sûrs, « à toi de jouer » (modifier la solution), évolution de l'AG, séparation dans le temps, consignes.
- **Modèle étendu à l'altitude** : conflit = < 7 NM ET < 1 000 ft (cylindre) ; l'AG peut changer de niveau (±1 000/2 000 ft à 1 500 ft/min). Au même niveau, on
  retrouve exactement le modèle 2D d'origine (distance « équivalente » = max(horizontale, verticale × sep/sep_v)).
- **Portage Python** (`vector.py`) de l'espace des caps sûrs et de la densité, validé cellule par cellule contre le JS d'origine (`tests/test_vector.py`, nécessite `node`),
  puis étendu à l'altitude (`*_3d`).
- L'outil d'origine (glisser-déposer, 2D) reste disponible dans un volet, chargé avec la situation courante ; il est isolé du reste (iframe).

**Limites.** Le rendu 3D (WebGL) n'a pas pu être vérifié visuellement dans l'environnement de développement (pas de WebGL en navigateur sans interface) :
la géométrie est testée (`tests/test_studio_view.py`) mais pas l'apparence. Les vols des scénarios ENAC sont tous au FL360 (recoupés avec `exo_artimation.txt`) : l'altitude
y est un paramètre à explorer, pas une donnée du papier. Le changement de niveau et le coût associé dans la fitness sont des choix de modélisation, pas ceux du papier.

Sur macOS, `python` n'existe pas : utilise `python3` ou `.venv/bin/python`.
