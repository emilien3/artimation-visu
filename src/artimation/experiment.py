"""Pipeline complet : données -> XGBoost -> CBR -> SHAP/LIME -> métriques (tables 1 à 4 de l'article).

Usage : python -m artimation.experiment [--n-train 80000] [--n-test 10000] [--n-explain 500]
"""
import argparse
import pickle
import time
from pathlib import Path

import numpy as np

from .data import FEATURES, generate
from .explain import lime_explain, local_accuracy_mae, mean_ndcg, shap_values
from .models import WeightedCBR, train_xgb

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"
# Sous-ensembles de l'article : 100 650 et 67 495 instances les plus précises sur 158 147.
SUBSETS = {"All": 1.0, "100k": 100650 / 158147, "67k": 67495 / 158147}


def _build_masks(errors, n):
    order = np.argsort(errors)
    masks = {}
    for name, frac in SUBSETS.items():
        m = np.zeros(n, bool)
        m[order[: max(1, int(round(frac * n)))]] = True
        masks[name] = m
    return masks


def run(n_train=80_000, n_test=10_000, n_explain=500, seed=0, verbose=True, shap_method="tree", discretize_lime=False):
    log = (lambda *a: print(*a, flush=True)) if verbose else (lambda *a: None)
    t0 = time.time()
    # Séparation temporelle simulée : l'apprentissage et le test sont des tirages indépendants du réseau.
    train, test = generate(n_train, seed), generate(n_test, seed + 1)
    Xtr, ytr = train[FEATURES].to_numpy(), train["delay"].to_numpy()
    Xte, yte = test[FEATURES].to_numpy(), test["delay"].to_numpy()

    log("XGBoost…")
    xgb = train_xgb(Xtr, ytr, seed)
    xgb_pred = xgb.predict(Xte)
    weights = xgb.feature_importances_

    log("CBR (k=3, poids = importances XGBoost)…")
    cbr = WeightedCBR(weights, k=3).fit(Xtr, ytr)
    cbr_pred = cbr.predict(Xte)

    err = {"XGB": np.abs(yte - xgb_pred), "CBR": np.abs(yte - cbr_pred)}
    table1 = {m: _subset_stats(e, err[m]) for m, e in err.items()}

    log(f"Explications sur {n_explain} instances (SHAP={shap_method} puis LIME discretize={discretize_lime})…")
    rng = np.random.default_rng(seed)
    ex = rng.choice(n_test, n_explain, replace=False)
    Xex = Xte[ex]
    phi_shap, shap_base = shap_values(xgb, Xex, method=shap_method, X_bg=Xtr, seed=seed)
    shap_pred = shap_base + phi_shap.sum(1)
    phi_lime, lime_pred = lime_explain(xgb, Xtr, Xex, FEATURES, seed=seed, discretize_continuous=discretize_lime)
    phi_cbr = cbr.additive_attributions(Xex, cbr_pred[ex])

    la = {"SHAP": local_accuracy_mae(xgb_pred[ex], shap_pred), "LIME": local_accuracy_mae(xgb_pred[ex], lime_pred)}
    masks_xgb = _build_masks(err["XGB"][ex], n_explain)
    masks_cbr = _build_masks(err["CBR"][ex], n_explain)

    table2 = {m: {s: (float(a[masks_xgb[s]].mean()), float(a[masks_xgb[s]].std())) for s in SUBSETS} for m, a in la.items()}
    table3 = {
        m: {
            "Global CBR": {s: mean_ndcg(cbr.w, phi[masks_cbr[s]]) for s in SUBSETS},
            "Additive CBR": {s: mean_ndcg(phi_cbr[masks_cbr[s]], phi[masks_cbr[s]]) for s in SUBSETS},
        }
        for m, phi in {"SHAP": phi_shap, "LIME": phi_lime}.items()
    }

    res = dict(
        features=FEATURES, weights=weights, cbr=cbr, xgb=xgb, train=train, test=test,
        y_test=yte, xgb_pred=xgb_pred, cbr_pred=cbr_pred, explain_idx=ex,
        phi_shap=phi_shap, shap_base=shap_base, shap_pred=shap_pred,
        phi_lime=phi_lime, lime_pred=lime_pred, phi_cbr=phi_cbr,
        table1=table1, table2=table2, table3=table3,
        err_xgb=err["XGB"], err_cbr=err["CBR"],
        config=dict(
            n_train=n_train, n_test=n_test, n_explain=n_explain, seed=seed,
            shap_method=shap_method, discretize_lime=discretize_lime,
        ),
    )
    log(f"Terminé en {time.time() - t0:.0f}s")
    return res


def _subset_stats(_, e):
    """MAE moyen et écart-type sur All / 100k / 67k (les x% instances les plus précises)."""
    s = np.sort(e)
    out = {}
    for name, frac in SUBSETS.items():
        part = s[: max(1, int(round(frac * len(s))))]
        out[name] = (float(part.mean()), float(part.std()))
    return out


def save(res, path=ARTIFACTS / "results.pkl"):
    path.parent.mkdir(exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(res, f)


def load(path=ARTIFACTS / "results.pkl"):
    with open(path, "rb") as f:
        return pickle.load(f)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n-train", type=int, default=80_000)
    p.add_argument("--n-test", type=int, default=10_000)
    p.add_argument("--n-explain", type=int, default=500)
    p.add_argument("--shap-method", choices=["tree", "kernel"], default="tree")
    p.add_argument("--discretize-lime", action="store_true")
    a = p.parse_args()
    res = run(a.n_train, a.n_test, a.n_explain, shap_method=a.shap_method, discretize_lime=a.discretize_lime)
    save(res)
    for k in ("table1", "table2", "table3"):
        print(k, res[k])


if __name__ == "__main__":
    main()
