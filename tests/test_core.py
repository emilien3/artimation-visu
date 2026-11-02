import numpy as np
import pytest

from artimation.data import FEATURES, generate
from artimation.experiment import run
from artimation.explain import lime_explain, mean_ndcg, shap_values
from artimation.models import WeightedCBR, train_xgb


@pytest.fixture(scope="module")
def setup():
    tr, te = generate(6000, 0), generate(300, 1)
    Xtr, ytr, Xte, yte = tr[FEATURES].to_numpy(), tr["delay"].to_numpy(), te[FEATURES].to_numpy(), te["delay"].to_numpy()
    xgb = train_xgb(Xtr, ytr)
    return Xtr, ytr, Xte, yte, xgb


def test_data_has_42_features():
    df = generate(200, 3)
    assert len(FEATURES) == 42 and df[FEATURES].shape == (200, 42) and df["delay"].notna().all()


def test_cbr_k3_average_and_beats_xgb_on_recurring_cases(setup):
    Xtr, ytr, Xte, yte, xgb = setup
    cbr = WeightedCBR(xgb.feature_importances_, k=3).fit(Xtr, ytr)
    _, idx = cbr.neighbors(Xte[:5])
    assert idx.shape == (5, 3)
    np.testing.assert_allclose(cbr.predict(Xte[:5]), ytr[idx].mean(1))
    # un cas déjà connu est son propre voisin le plus proche
    d, i = cbr.neighbors(Xtr[:3])
    assert (i[:, 0] == np.arange(3)).all() or (d[:, 0] < 1e-9).all()
    # Sur les situations opérationnelles récurrentes, le CBR (k=3) bat XGBoost comme dans la Table 1 du papier
    mae_cbr = np.abs(yte - cbr.predict(Xte)).mean()
    mae_xgb = np.abs(yte - xgb.predict(Xte)).mean()
    assert mae_cbr < mae_xgb


def test_additive_cbr_sums_to_prediction(setup):
    Xtr, ytr, Xte, _, xgb = setup
    cbr = WeightedCBR(xgb.feature_importances_).fit(Xtr, ytr)
    pred = cbr.predict(Xte)
    np.testing.assert_allclose(cbr.additive_attributions(Xte, pred).sum(1), pred, atol=1e-6)


def test_shap_local_accuracy_tree_and_kernel(setup):
    Xtr, _, Xte, _, xgb = setup
    phi, base = shap_values(xgb, Xte[:50], method="tree")
    np.testing.assert_allclose(base + phi.sum(1), xgb.predict(Xte[:50]), atol=1e-3)
    phi_k, base_k = shap_values(xgb, Xte[:3], method="kernel", X_bg=Xtr[:30], nsamples=100, seed=0)
    assert phi_k.shape == (3, 42)
    np.testing.assert_allclose(base_k + phi_k.sum(1), xgb.predict(Xte[:3]), atol=1e-2)


def test_lime_runs_discretized_and_continuous_and_ndcg_bounds(setup):
    Xtr, _, Xte, _, xgb = setup
    phi_d, pred_d = lime_explain(xgb, Xtr, Xte[:5], FEATURES, discretize_continuous=True)
    phi_c, pred_c = lime_explain(xgb, Xtr, Xte[:5], FEATURES, discretize_continuous=False)
    assert phi_d.shape == (5, 42) and np.isfinite(pred_d).all()
    assert phi_c.shape == (5, 42) and np.isfinite(pred_c).all()
    assert mean_ndcg(phi_d, phi_d) == pytest.approx(1.0)


def test_experiment_run_tables_structure():
    res = run(n_train=1500, n_test=200, n_explain=15, seed=0, verbose=False)
    for sub in ("All", "100k", "67k"):
        assert sub in res["table1"]["CBR"] and sub in res["table1"]["XGB"]
        assert sub in res["table2"]["SHAP"] and sub in res["table2"]["LIME"]
        assert 0.0 <= res["table3"]["SHAP"]["Global CBR"][sub] <= 1.0
        assert 0.0 <= res["table3"]["LIME"]["Additive CBR"][sub] <= 1.0
