---
relais: 1
projet: artimation-cbr
etape: Step 1 — Aligner LIME, SHAP et le générateur XCBR'22
sections: ##
pas: ###
---

# Step 1 — Aligner LIME, SHAP et le générateur XCBR'22

## 1.1 Explicabilité locale LIME, SHAP et poids globaux du CBR

### Task 1: Aligner train_xgb, lime_explain et shap_values
- [x] Utiliser `importance_type="total_gain"` dans `XGB_PARAMS` (`src/artimation/models.py`) et tronquer le bruit numérique dans `WeightedCBR.neighbors()`.
- [x] Supporter `method="tree" | "kernel"` dans `shap_values()` et `discretize_continuous` dans `lime_explain()` (`src/artimation/explain.py`).
- [x] Vérifier que `local_accuracy_mae` et `mean_ndcg` traitent correctement les attributions produites.

### Task 2: Couvrir LIME et SHAP dans tests/test_core.py
- [x] Ajouter les tests unitaires de `lime_explain` (modes continu et discrétisé) dans `tests/test_core.py`.
- [x] Ajouter les tests unitaires de `shap_values` (`tree` et `kernel`) dans `tests/test_core.py`.
- [x] Vérifier que `pytest tests/test_core.py` passe.

## 1.2 Macro-scénarios et micro-régimes d'ordre 8 dans data.py et experiment.py

### Task 3: Structurer _operational_catalog et generate dans src/artimation/data.py
- [x] Construire les 2 048 cas opérationnels (8 macro-scénarios × 256 micro-régimes d'ordre 8) dans `src/artimation/data.py`.
- [x] Régler la réponse centrée à 3 états et les échelles d'erreur hétéroscédastiques jusqu'à reproduire l'ordre des résultats de l'article, pas ses valeurs (le jeu EUROCONTROL est privé) : (Table 1) sur les cas récurrents, l'erreur absolue moyenne du CBR (k = 3) est plus faible que celle de XGBoost ; (Table 2) l'écart de précision locale de SHAP reste sous 1e-3 minute et celui de LIME dépasse 1 minute ; (Table 3) LIME est plus proche du CBR Global que du CBR Additif, SHAP plus proche du CBR Additif que du CBR Global. Chaque critère est un test de `tests/test_core.py` ; s'arrêter dès que les trois passent, sans chercher les valeurs exactes des Tables.
- [x] Mettre à jour `src/artimation/experiment.py` pour construire les sous-ensembles `All / 100k / 67k`.

### Task 4: Tester le pipeline complet et mettre à jour app.py
- [x] Vérifier dans `tests/test_core.py` que le CBR bat XGBoost sur les cas récurrents et que `run()` produit les Tables 1 à 3.
- [x] Mettre à jour l'onglet 5 dans `app.py`, `README.md` et régénérer `artifacts/results.pkl`.
- [x] Vérifier que les 57 tests (`pytest`) passent sans régression.
