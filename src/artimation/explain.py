"""Explications additives SHAP et LIME pour XGBoost, et métriques de l'article (précision locale, nDCG)."""
import numpy as np
import shap
from lime.lime_tabular import LimeTabularExplainer
from sklearn.metrics import ndcg_score


def shap_values(model, X):
    """TreeSHAP exact (l'article utilise KernelSHAP ; les deux vérifient la précision locale,
    TreeSHAP est exact et bien plus rapide sur 500 arbres)."""
    explainer = shap.TreeExplainer(model)
    phi = explainer.shap_values(X)
    return phi, float(np.ravel(explainer.expected_value)[0])


def lime_explain(model, X_train, X, feature_names, num_samples=1000, seed=0):
    """LIME régression, 1000 perturbations. Retourne (coefficients φ, prédiction locale g(z))."""
    exp = LimeTabularExplainer(np.asarray(X_train), feature_names=list(feature_names), mode="regression",
                               discretize_continuous=False, random_state=seed)
    idx = {n: j for j, n in enumerate(feature_names)}
    X = np.asarray(X)
    phi, local_pred = np.zeros(X.shape), np.zeros(len(X))
    for i, row in enumerate(X):
        e = exp.explain_instance(row, model.predict, num_features=len(feature_names), num_samples=num_samples)
        for j, c in e.local_exp[1] if 1 in e.local_exp else e.local_exp[0]:
            phi[i, j] = c
        local_pred[i] = e.local_pred[0]
    return phi, local_pred


def local_accuracy_mae(model_pred, explanation_pred):
    return np.abs(model_pred - explanation_pred)


def mean_ndcg(reference, attribution):
    """nDCG moyen : l'ordre des |attributions| est comparé à celui d'une référence (|φ| du CBR)."""
    ref, att = np.abs(np.atleast_2d(reference)), np.abs(attribution)
    if ref.shape[0] == 1:
        ref = np.repeat(ref, len(att), axis=0)
    return float(np.mean([ndcg_score(r[None], a[None]) for r, a in zip(ref, att)]))
