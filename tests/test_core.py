import pickle

import numpy as np
import pytest
from sklearn.neighbors import NearestNeighbors
from xgboost import XGBRegressor

from artimation.data import FEATURES, _CATALOG, _N_CASES, _N_MACRO, _N_MICRO, generate
from artimation.experiment import SUBSETS, _build_masks, run
from artimation.explain import lime_explain, local_accuracy_mae, mean_ndcg, shap_values
from artimation.models import DIST_DECIMALS, WeightedCBR


@pytest.fixture(scope="module")
def exp():
    return run(n_train=6000, n_test=300, n_explain=25, seed=0, verbose=False)


@pytest.fixture(scope="module")
def setup(exp):
    Xtr, ytr = exp["train"][FEATURES].to_numpy(), exp["train"]["delay"].to_numpy()
    Xte, yte = exp["test"][FEATURES].to_numpy(), exp["y_test"]
    return Xtr, ytr, Xte, yte, exp["xgb"]



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
    assert (_N_MACRO, _N_MICRO, _N_CASES) == (8, 256, 2048)
    assert len(_CATALOG["_smooth_delay"]) == 2048


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


def _brute_neighbors(cbr, X_fit, X):
    """Reference: rank every case by (distance rounded like WeightedCBR, case index)."""
    E, Q = cbr._embed(X_fit), cbr._embed(X)
    d = np.round(np.sqrt(((Q[:, None, :] - E[None]) ** 2).sum(-1)), DIST_DECIMALS)
    idx = np.array([np.lexsort((np.arange(len(E)), row))[:cbr.k] for row in d])
    return np.take_along_axis(d, idx, 1), idx


def test_cbr_duplicates_tie_to_lowest_index():
    X = np.array([[2, 2], [0, 0], [1, 1], [0, 0], [0, 0]], dtype=float)
    cbr = WeightedCBR([1, 1], k=4).fit(X, np.arange(5))
    d, i = cbr.neighbors(np.array([[0, 0]]))
    np.testing.assert_array_equal(i, [[1, 3, 4, 2]])
    np.testing.assert_array_equal(d[0, :3], 0)


def test_cbr_tie_beyond_candidate_pool_uses_full_scan():
    # 12 distinct cases on a circle around the query, all tied after rounding; k=2 -> pool of 4 distinct cases.
    ang = np.arange(12) * np.pi / 6
    ring = np.c_[np.cos(ang), np.sin(ang)][np.random.default_rng(0).permutation(12)]
    X = np.r_[ring, [[0.1, 0.0]], ring[:3]]  # a closer case at index 12 and duplicates of the ring at 13-15
    cbr = WeightedCBR([1, 1], k=2).fit(X, np.arange(len(X)))
    calls = []
    top_k = cbr._top_k
    cbr._top_k = lambda d, u: calls.append(len(u)) or top_k(d, u)
    q = np.array([[0.0, 0.0]])
    d, i = cbr.neighbors(q)
    assert len(cbr.cases_) in calls  # the fallback ranked every distinct case
    rd, ri = _brute_neighbors(cbr, X, q)
    np.testing.assert_array_equal(i, ri)
    np.testing.assert_array_equal(d, rd)
    assert i[0].tolist() == [12, 0]  # the closer case, then the lowest-index tied ring case


@pytest.mark.parametrize("k", [1, 3, 5])
def test_cbr_neighbors_match_brute_force_on_tied_grid(k):
    rng = np.random.default_rng(k)
    X = rng.integers(0, 3, size=(60, 3)).astype(float)  # 27 possible cases: many duplicates and ties
    cbr = WeightedCBR([1, 2, 3], k=k).fit(X, rng.normal(size=60))
    Q = rng.integers(0, 3, size=(40, 3)).astype(float) + rng.choice([0, 0.5], size=(40, 3))
    d, i = cbr.neighbors(Q)
    rd, ri = _brute_neighbors(cbr, X, Q)
    np.testing.assert_array_equal(i, ri)
    np.testing.assert_array_equal(d, rd)


def test_cbr_k_larger_than_distinct_cases():
    X = np.array([[1, 0], [0, 0], [1, 0], [0, 0], [1, 0]], dtype=float)
    cbr = WeightedCBR([1, 1], k=4).fit(X, np.arange(5))
    _, i = cbr.neighbors(np.array([[0, 0], [1, 0]]))
    np.testing.assert_array_equal(i, [[1, 3, 0, 2], [0, 2, 4, 1]])


def test_cbr_k_larger_than_cases_raises():
    with pytest.raises(ValueError, match="k=4"):
        WeightedCBR([1, 1], k=4).fit(np.zeros((3, 2)), np.zeros(3))


def test_cbr_unpickles_old_index_without_members():
    rng = np.random.default_rng(0)
    X = rng.integers(0, 3, size=(40, 2)).astype(float)
    new = WeightedCBR([1, 3], k=3).fit(X, rng.normal(size=40))
    old = WeightedCBR.__new__(WeightedCBR)
    state = {k: v for k, v in new.__dict__.items() if k not in ("cases_", "members_", "offsets_")}
    state["nn_"] = NearestNeighbors(n_neighbors=3).fit(new._embed(X))  # pre-dedup index over every case
    old.__dict__.update(state)
    restored = pickle.loads(pickle.dumps(old))
    Q = rng.integers(0, 3, size=(10, 2)).astype(float)
    for got, want in zip(restored.neighbors(Q), new.neighbors(Q)):
        np.testing.assert_array_equal(got, want)


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


def test_mean_ndcg_broadcasts_single_row_on_either_side():
    ref, att = np.array([3.0, 2.0, 1.0]), np.array([[3.0, 2.0, 1.0], [1.0, 2.0, 3.0]])
    # a 1-row attribution is compared with every reference row (row 1 used to be silently dropped)
    assert mean_ndcg(att, ref) == pytest.approx((mean_ndcg(att[0], ref) + mean_ndcg(att[1], ref)) / 2)
    assert mean_ndcg(att, ref) < 1.0
    with pytest.raises(ValueError, match="shapes do not match"):
        mean_ndcg(att, np.ones((3, 3)))



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


def test_shap_kernel_is_deterministic_with_seed():
    # 20 features: 2^20 coalitions >> nsamples, so shap must sample them (with M=4 it enumerates all 16).
    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 20))
    model = XGBRegressor(n_estimators=20, max_depth=2, random_state=0).fit(X, X @ rng.normal(size=20))
    np.random.seed(123)
    a = shap_values(model, X[:2], method="kernel", X_bg=X, nsamples=100, seed=7)
    after_a = np.random.random()
    np.random.seed(123)
    np.random.random(5)  # a different global state must not change the result
    b = shap_values(model, X[:2], method="kernel", X_bg=X, nsamples=100, seed=7)
    np.testing.assert_array_equal(a[0], b[0])
    assert a[1] == b[1]
    # the caller's global numpy random stream is left untouched
    np.random.seed(123)
    assert np.random.random() == after_a


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

def test_experiment_run_tables_structure(exp):
    masks = _build_masks(np.arange(100, dtype=float))
    assert set(masks) == {"All", "100k", "67k"}
    assert masks["All"].sum() == 100 and masks["100k"].sum() == round(100 * SUBSETS["100k"]) and masks["67k"].sum() == round(100 * SUBSETS["67k"])
    for sub in ("All", "100k", "67k"):
        assert sub in exp["table1"]["CBR"] and sub in exp["table1"]["XGB"]
        assert sub in exp["table2"]["SHAP"] and sub in exp["table2"]["LIME"]
        assert 0.0 <= exp["table3"]["SHAP"]["Global CBR"][sub] <= 1.0
        assert 0.0 <= exp["table3"]["LIME"]["Additive CBR"][sub] <= 1.0


def test_table1_cbr_beats_xgb_on_recurring_cases(exp):
    for sub in ("All", "100k", "67k"):
        assert exp["table1"]["CBR"][sub][0] < exp["table1"]["XGB"][sub][0]


def test_table2_local_accuracy_shap_and_lime(exp):
    for sub in ("All", "100k", "67k"):
        assert exp["table2"]["SHAP"][sub][0] < 1e-3
        assert exp["table2"]["LIME"][sub][0] > 1.0


def test_table3_ndcg_ordering_lime_global_and_shap_additive(exp):
    for sub in ("All", "100k", "67k"):
        assert exp["table3"]["LIME"]["Global CBR"][sub] > exp["table3"]["LIME"]["Additive CBR"][sub]
        assert exp["table3"]["SHAP"]["Additive CBR"][sub] > exp["table3"]["SHAP"]["Global CBR"][sub]
