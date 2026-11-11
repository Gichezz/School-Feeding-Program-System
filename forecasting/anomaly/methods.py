"""
Six ways to score school-days for review, with one interface:

    method.fit(train)          learn from the tuning period (no labels are used)
    method.score(frame)        higher = more in need of review
    method.contributions(row)  {feature: how much it raised the score}, for explanations

Two baselines that learn no model (fixed rules, a robust z-score) and four candidates:
Isolation Forest and Extended Isolation Forest (isolation), the one-class SVM (boundary)
and Local Outlier Factor (density). The candidates all see the same features, scaled the
same way, and are pooled across schools.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.kernel_approximation import Nystroem
from sklearn.linear_model import SGDOneClassSVM
from sklearn.neighbors import LocalOutlierFactor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler
from sklearn.svm import OneClassSVM

from .features import FEATURES

FEATURE_NAMES = list(FEATURES)
CLIP = 10.0


class Rules:
    """Programme rules with fixed thresholds: the checks an officer would run by hand."""

    name = "rules"
    # (feature, test, threshold, scale for the tie-break)
    RULES = [
        ("share_fed", lambda x: x > 1.0, 1.0, 0.05),                       # more fed than enrolled
        ("cereal_ratio", lambda x: np.abs(x) > np.log(1.3), np.log(1.3), 0.1),
        ("pulse_ratio", lambda x: np.abs(x) > np.log(1.3), np.log(1.3), 0.1),
        ("count_gap_change", lambda x: x < -2.0, -2.0, 1.0),               # 2 days of food missing
        ("entry_delay", lambda x: x > 5, 5, 5),               # entered over 5 school days after the date
        ("entry_batch", lambda x: x >= 10, 10, 5),           # 10 or more dates entered in one sitting
        ("enrolment_change", lambda x: x > np.log(1.25), np.log(1.25), 0.1),  # enrolment up a quarter in a term
    ]

    def __init__(self, **_):
        pass

    def fit(self, train):
        return self

    def _hits(self, frame):
        return {f: test(frame[f].to_numpy()) for f, test, _, _ in self.RULES}

    def score(self, frame):
        hits = self._hits(frame)
        score = np.zeros(len(frame))
        for f, _, threshold, scale in self.RULES:
            excess = np.abs(frame[f].to_numpy() - threshold) / scale
            score += hits[f] * (1 + np.minimum(excess, 10) / 100)
        return score

    def contributions(self, row):
        out = {}
        for f, test, _, _ in self.RULES:
            if test(np.array([row[f]]))[0]:
                out[f] = max(out.get(f, 0), 1.0)
        return out


ZSCORE_FEATURES = ["fed_rate", "fed_vs_peers", "fed_rate_vs_last_term", "enrolment_change", "uptake", "cereal_ratio",
                   "pulse_ratio", "usage_trend", "count_gap_change", "entry_delay", "entry_batch", "after_hours_share",
                   "round_share", "fed_steadiness"]
# Smallest spread used for a feature, so a very steady school does not flag tiny changes
MIN_SPREAD = {"fed_rate": 0.02, "fed_vs_peers": 0.02, "cereal_ratio": 0.03, "pulse_ratio": 0.03,
              "usage_trend": 0.02, "count_gap_change": 0.5, "entry_delay": 1.0, "entry_batch": 1.0,
              "round_share": 0.1, "fed_steadiness": 0.01, "fed_rate_vs_last_term": 0.02,
              "enrolment_change": 0.03, "uptake": 0.01, "after_hours_share": 0.1}
MIN_HISTORY = 20


class RobustZScore:
    """Each school against its own recent history (median and MAD of earlier days); a school
    with too little history is compared with its sub-county instead."""

    name = "robust_zscore"

    def __init__(self, history_days=40):
        self.history_days = history_days

    def fit(self, train):
        self.peer_ = train.groupby("sub_county")[ZSCORE_FEATURES].median()
        self.peer_spread_ = (train[ZSCORE_FEATURES] - train.groupby("sub_county")[ZSCORE_FEATURES].transform("median")).abs() \
            .groupby(train.sub_county).median() * 1.4826
        return self

    def _z(self, frame):
        frame = frame.sort_values(["school_id", "date"])
        z = pd.DataFrame(index=frame.index)
        g = frame.groupby("school_id")
        n_before = g.cumcount()
        for f in ZSCORE_FEATURES:
            center = g[f].transform(lambda s: s.shift(1).rolling(self.history_days, min_periods=MIN_HISTORY).median())
            dev = (frame[f] - center).abs()
            spread = dev.groupby(frame.school_id).transform(lambda s: s.shift(1).rolling(self.history_days, min_periods=MIN_HISTORY).median()) * 1.4826
            peer_center = frame.sub_county.map(self.peer_[f])
            peer_spread = frame.sub_county.map(self.peer_spread_[f])
            new = n_before < MIN_HISTORY
            center = center.where(~new, peer_center).fillna(peer_center)
            spread = spread.where(~new, peer_spread).fillna(peer_spread)
            z[f] = (frame[f] - center) / np.maximum(spread, MIN_SPREAD[f])
        return z.clip(-CLIP * 5, CLIP * 5)

    def score(self, frame):
        return self._z(frame).abs().max(axis=1).reindex(frame.index).to_numpy()

    def contributions_frame(self, frame):
        return self._z(frame).abs()

    def contributions(self, row):
        raise NotImplementedError("use contributions_frame: the z-score needs the school's history")


class _Learned:
    """Shared scaling and perturbation-based explanations for the learning methods.
    features: the features used, all of them unless one is left out (the ablation)."""

    features = FEATURE_NAMES

    def fit(self, train):
        self.scaler_ = RobustScaler().fit(train[self.features])
        self._fit(self._x(train))
        return self

    def _x(self, frame):
        return np.clip(self.scaler_.transform(frame[self.features]), -CLIP, CLIP)

    def score(self, frame):
        return self._score(self._x(frame))

    def contributions(self, row):
        """How much each feature raised the score: the drop when it is set to its median."""
        x = self._x(pd.DataFrame([row]))
        base = self._score(x)[0]
        n = len(self.features)
        variants = np.repeat(x, n, axis=0)
        variants[np.arange(n), np.arange(n)] = 0.0
        drops = base - self._score(variants)
        return {f: float(d) for f, d in zip(self.features, drops) if d > 0}


class IsolationForestMethod(_Learned):
    name = "isolation_forest"

    def __init__(self, n_estimators=100, max_samples=256, random_state=0):
        self.model = IsolationForest(n_estimators=n_estimators, max_samples=max_samples, random_state=random_state)

    def _fit(self, x):
        self.model.fit(x)

    def _score(self, x):
        return -self.model.score_samples(x)


class ExtendedIsolationForestMethod(_Learned):
    """Extended Isolation Forest (Hariri et al., 2019): like Isolation Forest, but each
    split is along a random combination of `ndim` features instead of a single feature,
    so a day unusual only as a combination of ordinary values is easier to isolate."""

    name = "extended_isolation_forest"
    SAMPLE = 1024   # rows per tree, as Isolation Forest's larger setting

    def __init__(self, n_estimators=100, ndim=2, random_state=0):
        self.n_estimators = n_estimators
        self.ndim = ndim
        self.random_state = random_state

    def _fit(self, x):
        # Imported when fitted, so the benchmark methods run without isotree installed
        from isotree import IsolationForest as IsoTreeForest

        self.model = IsoTreeForest(ntrees=self.n_estimators, ndim=min(self.ndim, x.shape[1]),
                                   sample_size=min(self.SAMPLE, len(x)), random_seed=self.random_state, nthreads=1)
        self.model.fit(x)

    def _score(self, x):
        return self.model.predict(x)


class LocalOutlierFactorMethod(_Learned):
    name = "local_outlier_factor"

    def __init__(self, n_neighbors=20, random_state=0):
        self.model = LocalOutlierFactor(n_neighbors=n_neighbors, novelty=True)

    def _fit(self, x):
        self.model.fit(x)

    def _score(self, x):
        return -self.model.score_samples(x)


class OneClassSVMMethod(_Learned):
    name = "one_class_svm"
    # A one-class SVM grows with the square of the rows; it is fitted on a sample
    SAMPLE = 5000

    def __init__(self, nu=0.05, gamma="scale", gamma_factor=1.0, random_state=0):
        self.model = OneClassSVM(nu=nu, gamma=gamma)
        self.gamma_factor = gamma_factor
        self.rng = np.random.default_rng(random_state)

    def _fit(self, x):
        rows = self.rng.choice(len(x), size=min(self.SAMPLE, len(x)), replace=False)
        if self.gamma_factor != 1.0:
            # gamma as a multiple of scikit-learn's "scale" on the rows it is fitted on
            self.model.set_params(gamma=self.gamma_factor / (x.shape[1] * x[rows].var()))
        self.model.fit(x[rows])

    def _score(self, x):
        return -self.model.decision_function(x)


class SGDOneClassSVMMethod(_Learned):
    """A linear one-class SVM trained by stochastic gradient descent on a Nystroem
    approximation of the same RBF kernel: its cost grows linearly with the rows."""

    name = "sgd_one_class_svm"

    def __init__(self, nu=0.05, n_components=300, random_state=0):
        self.nu = nu
        self.n_components = n_components
        self.random_state = random_state

    def _fit(self, x):
        gamma = 1.0 / (x.shape[1] * x.var())   # scikit-learn's gamma="scale"
        self.model = make_pipeline(
            Nystroem(gamma=gamma, n_components=min(self.n_components, len(x)), random_state=self.random_state),
            SGDOneClassSVM(nu=self.nu, random_state=self.random_state, max_iter=50, tol=1e-4))
        self.model.fit(x)

    def _score(self, x):
        return -self.model.decision_function(x)


METHODS = {
    "rules": Rules,
    "robust_zscore": RobustZScore,
    "isolation_forest": IsolationForestMethod,
    "extended_isolation_forest": ExtendedIsolationForestMethod,
    "local_outlier_factor": LocalOutlierFactorMethod,
    "one_class_svm": OneClassSVMMethod,
    "sgd_one_class_svm": SGDOneClassSVMMethod,
}
