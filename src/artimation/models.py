"""XGBoost (modèle de données) et CBR pondéré par l'importance XGBoost, tels que décrits dans l'article."""
import numpy as np
from sklearn.neighbors import NearestNeighbors
from xgboost import XGBRegressor

# Hyperparamètres retenus par l'article (sélection sur 288 combinaisons).
XGB_PARAMS = dict(learning_rate=0.1, max_depth=7, min_child_weight=1, subsample=0.5,
                  colsample_bytree=0.5, n_estimators=500, importance_type="total_gain")


def train_xgb(X, y, seed=0):
    model = XGBRegressor(**XGB_PARAMS, random_state=seed, n_jobs=-1)
    return model.fit(X, y)


class WeightedCBR:
    """k-NN à distance euclidienne pondérée (k=3), poids globaux = importances XGBoost.

    Similarité locale : numérique = |a-b| / étendue ; binaire = 0 si égal, 1 sinon (symbolique).
    La mise à l'échelle min-max réalise les deux d'un coup (une variable binaire a une étendue de 1).
    """

    def __init__(self, weights, k=3):
        w = np.asarray(weights, dtype=float)
        self.w = w / w.sum()
        self.k = k

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        self.min_, self.range_ = X.min(0), np.where(np.ptp(X, 0) == 0, 1, np.ptp(X, 0))
        self.y_ = np.asarray(y, dtype=float)
        self.nn_ = NearestNeighbors(n_neighbors=self.k, algorithm="brute").fit(self._embed(X))
        return self

    def scale(self, X):
        return (np.asarray(X, dtype=float) - self.min_) / self.range_

    def _embed(self, X):
        return self.scale(X) * np.sqrt(self.w)

    def neighbors(self, X):
        dist, idx = self.nn_.kneighbors(self._embed(X))
        return np.where(dist < 1e-7, 0.0, dist), idx

    def predict(self, X):
        _, idx = self.neighbors(X)
        return self.y_[idx].mean(1)

    def additive_attributions(self, X, y_hat=None):
        """CBR additif : φ_ij = γ_i · x_ij · w_j avec γ_i = ŷ_i / Σ_j x_ij w_j (équation 3)."""
        xs = self.scale(X)
        y_hat = self.predict(X) if y_hat is None else y_hat
        contrib = xs * self.w
        total = contrib.sum(1)
        gamma = np.divide(y_hat, total, out=np.zeros_like(y_hat, dtype=float), where=total != 0)
        return gamma[:, None] * contrib
