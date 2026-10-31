import numpy as np
import pytest

from artimation.data import FEATURES, generate
from artimation.explain import lime_explain, mean_ndcg, shap_values
from artimation.models import WeightedCBR, train_xgb


@pytest.fixture(scope="module")
def setup():
    tr, te = generate(6000, 0), generate(300, 1)
    Xtr, ytr, Xte = tr[FEATURES].to_numpy(), tr["delay"].to_numpy(), te[FEATURES].to_numpy()
    xgb = train_xgb(Xtr, ytr)
    return Xtr, ytr, Xte, xgb


def test_data_has_42_features():
    df = generate(200, 3)
    assert len(FEATURES) == 42 and df[FEATURES].shape == (200, 42) and df["delay"].notna().all()


def test_cbr_k3_average(setup):
    Xtr, ytr, Xte, xgb = setup
    cbr = WeightedCBR(xgb.feature_importances_, k=3).fit(Xtr, ytr)
    _, idx = cbr.neighbors(Xte[:5])
    assert idx.shape == (5, 3)
    np.testing.assert_allclose(cbr.predict(Xte[:5]), ytr[idx].mean(1))
    # un cas déjà connu est son propre voisin le plus proche
    d, i = cbr.neighbors(Xtr[:3])
    assert (i[:, 0] == np.arange(3)).all() or (d[:, 0] < 1e-9).all()


def test_additive_cbr_sums_to_prediction(setup):
    Xtr, ytr, Xte, xgb = setup
    cbr = WeightedCBR(xgb.feature_importances_).fit(Xtr, ytr)
    pred = cbr.predict(Xte)
    np.testing.assert_allclose(cbr.additive_attributions(Xte, pred).sum(1), pred, atol=1e-6)


def test_shap_local_accuracy(setup):
    _, _, Xte, xgb = setup
    phi, base = shap_values(xgb, Xte[:50])
    np.testing.assert_allclose(base + phi.sum(1), xgb.predict(Xte[:50]), atol=1e-3)


def test_lime_runs_and_ndcg_bounds(setup):
    Xtr, _, Xte, xgb = setup
    phi, pred = lime_explain(xgb, Xtr, Xte[:5], FEATURES)
    assert phi.shape == (5, 42) and np.isfinite(pred).all()
    assert mean_ndcg(phi, phi) == pytest.approx(1.0)
