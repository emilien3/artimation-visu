import numpy as np
import pytest
from xgboost import XGBRegressor

from artimation.data import FEATURES, generate
from artimation.experiment import run
from artimation.explain import lime_explain, local_accuracy_mae, mean_ndcg, shap_values
from artimation.models import WeightedCBR, train_xgb


@pytest.fixture(scope="module")
def setup():
    tr, te = generate(6000, 0), generate(300, 1)
    Xtr, ytr, Xte, yte = tr[FEATURES].to_numpy(), tr["delay"].to_numpy(), te[FEATURES].to_numpy(), te["delay"].to_numpy()
    xgb = train_xgb(Xtr, ytr)
    return Xtr, ytr, Xte, yte, xgb



@pytest.fixture(scope="module")
def small():
    """Small additive model: x0 and x1 drive y, x2 weakly, x3 is a rare binary flag with no effect."""
    rng = np.random.default_rng(0)
    X = rng.normal(size=(400, 4))
    X[:, 3] = (rng.random(400) < 0.1).astype(float)  # degenerate quartiles (all 0): exercises LIME's jitter
    y = 3 * X[:, 0] - 2 * X[:, 1] + 0.5 * X[:, 2] + rng.normal(0, 0.1, 400)
    model = XGBRegressor(n_estimators=50, max_depth=1, learning_rate=0.3, random_state=0).fit(X, y)
    return X, model, ["x0", "x1", "x2", "x3"]

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



def test_shap_tree_and_kernel_shapes_and_local_accuracy(small):
    X, model, _ = small
    pred = model.predict(X[:6])
    for method, kw in (("tree", {}), ("kernel", {"X_bg": X, "nsamples": 100, "seed": 0})):
        phi, base = shap_values(model, X[:6], method=method, **kw)
        assert phi.shape == (6, 4) and isinstance(base, float) and np.isfinite(phi).all()
        assert local_accuracy_mae(pred, base + phi.sum(1)).max() < 1e-4, method


def test_shap_tree_and_kernel_roughly_agree(small):
    X, model, _ = small
    phi_t, _ = shap_values(model, X[:10], method="tree")
    phi_k, _ = shap_values(model, X[:10], method="kernel", X_bg=X, nsamples=100, seed=0)
    # Both differ only by the reference expectation (full training set vs 25 sampled background rows).
    assert np.corrcoef(phi_t.ravel(), phi_k.ravel())[0, 1] > 0.95
    assert mean_ndcg(phi_t, phi_k) > 0.9
    # The irrelevant binary flag is never split on, so both methods give it exactly zero.
    assert np.abs(phi_t[:, 3]).max() < 1e-9 and np.abs(phi_k[:, 3]).max() < 1e-6


def test_shap_kernel_is_deterministic_with_seed(small):
    X, model, _ = small
    a = shap_values(model, X[:3], method="kernel", X_bg=X, nsamples=100, seed=7)
    b = shap_values(model, X[:3], method="kernel", X_bg=X, nsamples=100, seed=7)
    np.testing.assert_array_equal(a[0], b[0])
    assert a[1] == b[1]


def test_shap_unknown_method_raises(small):
    X, model, _ = small
    with pytest.raises(ValueError, match="unknown SHAP method"):
        shap_values(model, X[:2], method="deep")


@pytest.mark.parametrize("discretize", [False, True])
def test_lime_shape_finite_and_deterministic(small, discretize):
    X, model, names = small
    phi, local = lime_explain(model, X, X[:3], names, num_samples=500, seed=1, discretize_continuous=discretize)
    assert phi.shape == (3, 4) and local.shape == (3,)
    assert np.isfinite(phi).all() and np.isfinite(local).all()
    phi2, local2 = lime_explain(model, X, X[:3], names, num_samples=500, seed=1, discretize_continuous=discretize)
    np.testing.assert_array_equal(phi, phi2)
    np.testing.assert_array_equal(local, local2)


def test_lime_continuous_recovers_model_slopes(small):
    X, model, names = small
    phi, _ = lime_explain(model, X, X[:3], names, num_samples=500, seed=1, discretize_continuous=False)
    # Continuous LIME fits a linear surrogate on standardised inputs: signs follow y = 3*x0 - 2*x1 + 0.5*x2.
    assert (phi[:, 0] > 0).all() and (phi[:, 1] < 0).all()
    assert (np.abs(phi[:, 0]) > np.abs(phi[:, 2])).all() and (np.abs(phi[:, 3]) < 0.2).all()

def test_experiment_run_tables_structure():
    res = run(n_train=1500, n_test=200, n_explain=15, seed=0, verbose=False)
    for sub in ("All", "100k", "67k"):
        assert sub in res["table1"]["CBR"] and sub in res["table1"]["XGB"]
        assert sub in res["table2"]["SHAP"] and sub in res["table2"]["LIME"]
        assert 0.0 <= res["table3"]["SHAP"]["Global CBR"][sub] <= 1.0
        assert 0.0 <= res["table3"]["LIME"]["Additive CBR"][sub] <= 1.0
