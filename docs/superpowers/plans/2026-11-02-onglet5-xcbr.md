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
- [ ] Utiliser `importance_type="total_gain"` dans `XGB_PARAMS` (`src/artimation/models.py`) et tronquer le bruit numérique dans `WeightedCBR.neighbors()`.
- [ ] Supporter `method="tree" | "kernel"` dans `shap_values()` et `discretize_continuous` dans `lime_explain()` (`src/artimation/explain.py`).
- [ ] Vérifier que `local_accuracy_mae` et `mean_ndcg` traitent correctement les attributions produites.

### Task 2: Couvrir LIME et SHAP dans tests/test_core.py
- [ ] Ajouter les tests unitaires de `lime_explain` (modes continu et discrétisé) dans `tests/test_core.py`.
- [ ] Ajouter les tests unitaires de `shap_values` (`tree` et `kernel`) dans `tests/test_core.py`.
- [ ] Vérifier que `pytest tests/test_core.py` passe.

## 1.2 Macro-scénarios et micro-régimes d'ordre 8 dans data.py et experiment.py

### Task 3: Structurer _operational_catalog et generate dans src/artimation/data.py
- [ ] Construire les 2 048 cas opérationnels (8 macro-scénarios × 256 micro-régimes d'ordre 8) dans `src/artimation/data.py`.
- [ ] Calibrer la réponse centrée à 3 états et les échelles d'erreur hétéroscédastiques pour aligner les Tables 1, 2 et 3.
- [ ] Mettre à jour `src/artimation/experiment.py` pour construire les sous-ensembles `All / 100k / 67k`.

### Task 4: Tester le pipeline complet et mettre à jour app.py
- [ ] Vérifier dans `tests/test_core.py` que le CBR bat XGBoost sur les cas récurrents et que `run()` produit les Tables 1 à 3.
- [ ] Mettre à jour l'onglet 5 dans `app.py`, `README.md` et régénérer `artifacts/results.pkl`.
- [ ] Vérifier que les 57 tests (`pytest`) passent sans régression.
