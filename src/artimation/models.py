"""XGBoost (modèle de données) et CBR pondéré par l'importance XGBoost, tels que décrits dans l'article."""
import numpy as np
from sklearn.neighbors import NearestNeighbors
from xgboost import XGBRegressor

# Distances are rounded to this many decimals before ranking neighbours: float noise
# (~1e-8 on exact duplicates) must not decide which of several tied cases is retrieved.
DIST_DECIMALS = 6

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
        if self.k > len(y):
            raise ValueError(f"k={self.k} neighbours requested but only {len(y)} cases to fit")
        self.min_, self.range_ = X.min(0), np.where(np.ptp(X, 0) == 0, 1, np.ptp(X, 0))
        self.y_ = np.asarray(y, dtype=float)
        self._index(self._embed(X))
        return self

    def _index(self, E):
        # Exact duplicates are indexed once; members_[offsets_[u]:offsets_[u + 1]] lists the case indices
        # (ascending) of distinct case u, so tied duplicates are retrieved lowest index first.
        self.cases_, inv = np.unique(E, axis=0, return_inverse=True)
        inv = inv.ravel()
        self.members_ = np.argsort(inv, kind="stable")
        self.offsets_ = np.r_[0, np.cumsum(np.bincount(inv))]
        self.nn_ = NearestNeighbors(n_neighbors=min(len(self.cases_), 2 * self.k), algorithm="brute").fit(self.cases_)

    def __setstate__(self, state):
        self.__dict__.update(state)
        if "members_" not in state:  # pickled before duplicate-aware indexing: rebuild from the old index
            self._index(state["nn_"]._fit_X)

    def scale(self, X):
        return (np.asarray(X, dtype=float) - self.min_) / self.range_

    def _embed(self, X):
        return self.scale(X) * np.sqrt(self.w)

    def neighbors(self, X):
        """k nearest cases, sorted by (rounded distance, case index): ties go to the lowest index."""
        Q = self._embed(X)
        d, u = self.nn_.kneighbors(Q)
        d = np.round(d, DIST_DECIMALS)
        dist, idx = np.empty((len(Q), self.k)), np.empty((len(Q), self.k), dtype=int)
        for r in range(len(Q)):
            dist[r], idx[r] = self._top_k(d[r], u[r])
            if len(u[r]) < len(self.cases_) and dist[r, -1] == d[r, -1]:
                # the tie may extend beyond the candidate pool: rank every distinct case
                full = np.round(np.sqrt(((self.cases_ - Q[r]) ** 2).sum(1)), DIST_DECIMALS)
                dist[r], idx[r] = self._top_k(full, np.arange(len(self.cases_)))
        return dist, idx

    def _top_k(self, d, u):
        """Expand distinct cases u (at rounded distances d) to their members and keep the k best."""
        sizes = np.diff(self.offsets_)[u]
        cand_d = np.repeat(d, sizes)
        cand_i = np.concatenate([self.members_[self.offsets_[j]:self.offsets_[j + 1]] for j in u])
        best = np.lexsort((cand_i, cand_d))[:self.k]
        return cand_d[best], cand_i[best]

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
