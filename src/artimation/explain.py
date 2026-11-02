"""Explications additives SHAP et LIME pour XGBoost, et métriques de l'article (précision locale, nDCG)."""
import numpy as np
import shap
from lime.lime_tabular import LimeTabularExplainer
from sklearn.metrics import ndcg_score


def shap_values(model, X, method="tree", X_bg=None, nsamples=200, seed=0):
    """Calcule les attributions SHAP (φ, base_value).

    - method="tree" (défaut) : TreeSHAP exact et rapide sur les 500 arbres.
    - method="kernel" : KernelSHAP (échantillonnage de coalitions, comme dans l'article XCBR'22).
    """
    X = np.asarray(X, dtype=float)
    if method == "kernel":
        bg = X if X_bg is None else np.asarray(X_bg, dtype=float)
        rng = np.random.default_rng(seed)
        if len(bg) > 25:
            bg = bg[rng.choice(len(bg), 25, replace=False)]
        explainer = shap.KernelExplainer(model.predict, bg)
        phi = explainer.shap_values(X, nsamples=nsamples, silent=True)
        return np.asarray(phi, dtype=float), float(np.ravel(explainer.expected_value)[0])
    explainer = shap.TreeExplainer(model)
    phi = explainer.shap_values(X)
    return np.asarray(phi, dtype=float), float(np.ravel(explainer.expected_value)[0])


def lime_explain(model, X_train, X, feature_names, num_samples=1000, seed=0, discretize_continuous=False):
    """LIME régression, 1000 perturbations. Retourne (coefficients φ, prédiction locale g(z))."""
    X_tr = np.asarray(X_train, dtype=float)
    X_eval = np.asarray(X, dtype=float)
    rng = np.random.default_rng(seed)
    if discretize_continuous:
        X_tr = X_tr.copy()
        for j in range(X_tr.shape[1]):
            if len(np.unique(np.percentile(X_tr[:, j], [25, 50, 75]))) < 3:
                X_tr[:, j] = X_tr[:, j] + rng.normal(0.0, 1e-6, len(X_tr))
    exp = LimeTabularExplainer(
        X_tr,
        feature_names=list(feature_names),
        mode="regression",
        discretize_continuous=discretize_continuous,
        random_state=seed,
    )
    phi, local_pred = np.zeros(X_eval.shape), np.zeros(len(X_eval))
    for i, row in enumerate(X_eval):
        e = exp.explain_instance(row, model.predict, num_features=len(feature_names), num_samples=num_samples)
        pairs = e.local_exp[1] if 1 in e.local_exp else e.local_exp[0]
        for j, c in pairs:
            phi[i, j] = c
        local_pred[i] = float(np.ravel(e.local_pred)[0])
    return phi, local_pred


def local_accuracy_mae(model_pred, explanation_pred):
    return np.abs(np.asarray(model_pred, dtype=float) - np.asarray(explanation_pred, dtype=float))


def mean_ndcg(reference, attribution):
    """nDCG moyen : l'ordre des |attributions| est comparé à celui d'une référence (|φ| du CBR)."""
    ref, att = np.abs(np.atleast_2d(reference)), np.abs(attribution)
    if ref.shape[0] == 1:
        ref = np.repeat(ref, len(att), axis=0)
    return float(np.mean([ndcg_score(r[None], a[None]) for r, a in zip(ref, att)]))
