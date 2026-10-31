# ARTIMATION · XAI pour la prédiction de retard au décollage

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
