# Plan — Alignement Onglet 5 (SHAP vs LIME vs CBR) avec XCBR'22 (Ahmed et al.)

## Step 1 — Aligner LIME, SHAP et les importances XGBoost sur XCBR'22

### 1.1 Explicabilité locale LIME, SHAP et poids globaux du CBR

#### Task 1: Aligner train_xgb, lime_explain et shap_values dans src/artimation/models.py et src/artimation/explain.py
- [x] Utiliser `importance_type="total_gain"` dans `XGB_PARAMS` (`src/artimation/models.py`) pour que les poids `cbr.w` reflètent la variance totale expliquée sans gonfler les variables binaires rares.
- [x] Supporter `method="tree" | "kernel"` dans `shap_values()` et le paramétrage de `discretize_continuous` dans `lime_explain()` (`src/artimation/explain.py`).
- [x] Vérifier que `local_accuracy_mae` et `mean_ndcg` gèrent proprement les vecteurs d'attributions produits.

#### Task 2: Tester lime_explain et shap_values dans tests/test_core.py
- [x] Couvrir `lime_explain` (modes continu et discrétisé) dans `tests/test_core.py`.
- [x] Couvrir `shap_values` (modes `tree` et `kernel` sur un échantillon).
- [x] Vérifier que tous les tests unitaires d'explicabilité passent.

## Step 2 — Calibrer la structure par cas du générateur pour les Tables 1, 2 et 3

### 2.1 Générateur synthétique à cas opérationnels hiérarchiques et sous-ensembles All / 100k / 67k

#### Task 1: Calibrer les macro-scénarios et micro-régimes d'ordre 8 dans src/artimation/data.py
- [x] Structurer `_operational_catalog()` autour de 8 macro-scénarios × 256 micro-régimes (parité d'ordre 8 invisible aux arbres de `max_depth=7` mais retrouvée par les 3 voisins du CBR) avec échelles d'erreur hétéroscédastiques calibrées sur la Table 1 (`CBR ~ 5.8 / 1.5 / 0.5 min`, `XGB ~ 9.2 / 4.3 / 2.7 min`).
- [x] Rendre les variables de contexte secondaires orthogonales au retard lisse pour concentrer les coupures de XGBoost sur les variables motrices et aligner les nDCG de la Table 3 (`0.74 – 0.88`).
- [x] Introduire l'amplification non linéaire de congestion pour reproduire la décroissance de l'erreur locale de LIME en Table 2 (`All > 100k > 67k`).

#### Task 2: Tester le pipeline experiment et la cohérence des tables dans tests/test_core.py
- [x] Vérifier dans `tests/test_core.py` que `generate()` respecte les 42 variables et que le CBR bat XGBoost sur les cas récurrents.
- [x] Vérifier que `run()` produit des dictionnaires `table1`, `table2`, `table3` complets et cohérents sur `All`, `100k`, `67k`.
- [x] Exécuter la suite complète de 57 tests (`pytest`).

## Step 3 — Mettre à jour l'onglet 5 et les artefacts

### 3.1 Interface Streamlit (onglet 5) et régénération des résultats

#### Task 1: Mettre à jour l'onglet 5 dans app.py et régénérer artifacts/results.pkl
- [x] Mettre à jour `get_results()` et les explications pédagogiques de l'onglet 5 (`with tab4:` dans `app.py`) et de `README.md`.
- [x] Régénérer `artifacts/results.pkl` avec le pipeline calibré (`PYTHONPATH=src .venv/bin/python -m artimation.experiment`).
- [x] Relancer Streamlit pour afficher les nouvelles tables dans l'interface.
