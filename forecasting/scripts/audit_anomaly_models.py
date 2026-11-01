"""
Audit of the anomaly-detection comparison (docs/anomaly-model-audit.md). Exploratory: run
after protocol version 5's results, not pre-registered, and changes nothing the
evaluation, the robustness study or the deployed service use.
Same dataset, features, tuning/test split, threshold rule and metrics as
scripts/evaluate_anomaly_detection.py (protocol version 5), imported from it.

E1 same-protocol comparison including SGDOneClassSVM (Nystroem RBF approximation)
E2 contamination: fit on the tuning period as-is vs with labelled anomalies removed
E3 sensitivity: one-class SVM nu x gamma; Isolation Forest n_estimators x max_samples;
   contamination does not change Isolation Forest's scores
E4 leakage: features built only from records up to each test week's end (causal)
E5 scalability: fit/score time and model size as rows grow
E6 heterogeneity: false flags on ordinary days by school size
Writes data/reports/anomaly/audit/anomaly_model_audit.json (about 5 minutes).
Usage: python forecasting/scripts/audit_anomaly_models.py
"""

import json
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
OUT = root / "data" / "reports" / "anomaly" / "audit" / "anomaly_model_audit.json"
sys.path[:0] = [str(root), str(root / "scripts")]
import warnings  # noqa: E402

warnings.filterwarnings("ignore")
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402
from sklearn.ensemble import IsolationForest  # noqa: E402
from sklearn.kernel_approximation import Nystroem  # noqa: E402
from sklearn.linear_model import SGDOneClassSVM  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.svm import OneClassSVM  # noqa: E402

from anomaly.features import FEATURES, build_features  # noqa: E402
from anomaly.methods import METHODS, IsolationForestMethod, OneClassSVMMethod, _Learned  # noqa: E402
from evaluate_anomaly_detection import PROTOCOL, best_threshold, day_metrics, load, precision_at_k, review_weeks  # noqa: E402

FEATURE_NAMES = list(FEATURES)
protocol = yaml.safe_load(open(PROTOCOL, encoding="utf-8"))
SEED = protocol["tuning"]["random_seed"]
K = protocol["scoring"]["review_list"]["k"]
TUNE_END = pd.Timestamp(protocol["data"]["tuning_period"]["end"])
out = {}


class SGDOneClassMethod(_Learned):
    """Linear one-class SVM trained by stochastic gradient descent on a Nystroem
    approximation of the RBF kernel: cost grows linearly with rows."""

    def __init__(self, nu=0.05, n_components=300, random_state=0):
        self.nu, self.n_components, self.random_state = nu, n_components, random_state

    def _fit(self, x):
        gamma = 1.0 / (x.shape[1] * x.var())  # sklearn's gamma="scale"
        self.model = make_pipeline(
            Nystroem(gamma=gamma, n_components=self.n_components, random_state=self.random_state),
            SGDOneClassSVM(nu=self.nu, random_state=self.random_state, max_iter=50, tol=1e-4))
        self.model.fit(x)

    def _score(self, x):
        return -self.model.decision_function(x)


class OCSVMGamma(OneClassSVMMethod):
    """The deployed one-class SVM with gamma as a multiple of 'scale'."""

    def __init__(self, nu=0.05, gamma_factor=1.0, random_state=0):
        super().__init__(nu=nu, random_state=random_state)
        self.gamma_factor = gamma_factor

    def _fit(self, x):
        rows = self.rng.choice(len(x), size=min(self.SAMPLE, len(x)), replace=False)
        self.model.set_params(gamma=self.gamma_factor / (x.shape[1] * x[rows].var()))
        self.model.fit(x[rows])


frames, _ = load()
labels = frames["labels"].assign(date=lambda d: pd.to_datetime(d.date))


def features_of(fr):
    f = build_features(fr["schools"], fr["enrolment"], fr["feeding"], fr["stock_counts"], fr["school_days"])
    f = f.merge(labels, on=["school_id", "date"], how="left")
    f["label"] = f.label.fillna("")
    return f


feats = features_of(frames)
tuning, test = feats[feats.date <= TUNE_END], feats[feats.date > TUNE_END]
truth_tune = (tuning.label != "").to_numpy()


def run(model_fn, train=tuning, test_frame=test, tune_frame=tuning):
    """Fit, threshold by F1 on the tuning period, test once: the protocol's procedure."""
    t0 = time.perf_counter()
    model = model_fn().fit(train)
    fit_s = time.perf_counter() - t0
    tune_scores = model.score(tune_frame)
    f1, threshold = best_threshold(tune_scores, (tune_frame.label != "").to_numpy())
    t0 = time.perf_counter()
    test_scores = model.score(test_frame)
    score_s = time.perf_counter() - t0
    flag = test_scores >= threshold
    m = day_metrics(flag, test_frame)
    pk, _ = precision_at_k(review_weeks(test_frame, test_scores), K)
    normal = int((test_frame.label == "").sum())
    held = protocol["anomaly_types"]["held_out"]
    return {"tuning_f1": round(f1, 4), "precision_at_10": round(float(pk), 4), "precision": round(m["precision"], 4),
            "recall": round(m["recall"], 4), "f1": round(m["f1"], 4),
            "false_positive_rate": round(m["fp"] / normal, 4), "tp": m["tp"], "fp": m["fp"], "fn": m["fn"],
            "tn": normal - m["fp"], "recall_held_out": round(float(flag[test_frame.label.isin(held).to_numpy()].mean()), 4),
            "recall_by_type": {k: round(v, 3) for k, v in m["recall_by_type"].items()},
            "fit_seconds": round(fit_s, 3), "score_seconds": round(score_s, 3), "_scores": test_scores, "_flag": flag}


def strip(r):
    return {k: v for k, v in r.items() if not k.startswith("_")}


# E1: same protocol, with SGDOneClassSVM (grid chosen by tuning F1 only)
print("E1")
e1 = {"rules": run(lambda: METHODS["rules"]()),
      "isolation_forest": run(lambda: IsolationForestMethod(n_estimators=100, max_samples=256, random_state=SEED)),
      "one_class_svm": run(lambda: OneClassSVMMethod(nu=0.05, random_state=SEED))}
# The rules' threshold is fixed at 1 by the protocol; re-score them that way
r = METHODS["rules"]().fit(tuning)
flag = r.score(test) >= 1.0
m = day_metrics(flag, test)
e1["rules"].update({"precision": round(m["precision"], 4), "recall": round(m["recall"], 4), "f1": round(m["f1"], 4),
                    "false_positive_rate": round(m["fp"] / int((test.label == "").sum()), 4), "tp": m["tp"], "fp": m["fp"],
                    "fn": m["fn"], "tn": int((test.label == "").sum()) - m["fp"]})
sgd = {}
for nu in (0.02, 0.05):
    for nc in (100, 300):
        sgd[(nu, nc)] = run(lambda nu=nu, nc=nc: SGDOneClassMethod(nu=nu, n_components=nc, random_state=SEED))
best = max(sgd, key=lambda k: sgd[k]["tuning_f1"])
e1["sgd_one_class_svm"] = {**sgd[best], "params": {"nu": best[0], "n_components": best[1]}}
e1["sgd_grid"] = {f"nu={k[0]},n_components={k[1]}": {"tuning_f1": v["tuning_f1"], "precision_at_10": v["precision_at_10"]} for k, v in sgd.items()}
out["E1_same_protocol"] = {k: (strip(v) if isinstance(v, dict) and "_scores" in v else v) for k, v in e1.items()}

# E2: contamination
print("E2")
clean = tuning[tuning.label == ""]
out["E2_contamination"] = {"tuning_rows": len(tuning), "labelled_anomalous_in_tuning": int((tuning.label != "").sum())}
for name, fn in {"isolation_forest": lambda: IsolationForestMethod(n_estimators=100, max_samples=256, random_state=SEED),
                 "one_class_svm": lambda: OneClassSVMMethod(nu=0.05, random_state=SEED),
                 "sgd_one_class_svm": lambda: SGDOneClassMethod(nu=best[0], n_components=best[1], random_state=SEED)}.items():
    as_is = e1[name] if name in e1 else e1["sgd_one_class_svm"]
    cleaned = run(fn, train=clean)
    out["E2_contamination"][name] = {"as_is_p10": as_is["precision_at_10"], "clean_p10": cleaned["precision_at_10"],
                                     "as_is_f1": as_is["f1"], "clean_f1": cleaned["f1"],
                                     "as_is_held_out": as_is["recall_held_out"], "clean_held_out": cleaned["recall_held_out"]}

# E3: sensitivity
print("E3")
e3 = {"one_class_svm": {}, "isolation_forest": {}}
for nu in (0.01, 0.02, 0.05, 0.1, 0.2):
    for gf in (0.3, 1.0, 3.0):
        r = run(lambda nu=nu, gf=gf: OCSVMGamma(nu=nu, gamma_factor=gf, random_state=SEED))
        e3["one_class_svm"][f"nu={nu},gamma={gf}xscale"] = {"tuning_f1": r["tuning_f1"], "precision_at_10": r["precision_at_10"],
                                                            "recall": r["recall"], "false_positive_rate": r["false_positive_rate"]}
for n in (50, 100, 300, 500):
    for ms in (256, 1024):
        r = run(lambda n=n, ms=ms: IsolationForestMethod(n_estimators=n, max_samples=ms, random_state=SEED))
        e3["isolation_forest"][f"n_estimators={n},max_samples={ms}"] = {"tuning_f1": r["tuning_f1"], "precision_at_10": r["precision_at_10"],
                                                                         "recall": r["recall"], "false_positive_rate": r["false_positive_rate"]}
x = IsolationForestMethod(random_state=SEED).fit(tuning)._x(test)
xt = IsolationForestMethod(random_state=SEED).fit(tuning)._x(tuning)
s1 = IsolationForest(n_estimators=100, max_samples=256, contamination="auto", random_state=SEED).fit(xt).score_samples(x)
s2 = IsolationForest(n_estimators=100, max_samples=256, contamination=0.05, random_state=SEED).fit(xt).score_samples(x)
e3["isolation_forest_contamination_changes_scores"] = bool(not np.allclose(s1, s2))
out["E3_sensitivity"] = e3

# E4: leakage. Tuning features from tuning-period records only; each test week's
# features from records up to that week's end (as the deployed service builds them).
print("E4")
def upto(end):
    fr = dict(frames)
    # Records only: the calendar and termly enrolment are known in advance
    for name, col in (("feeding", "date"), ("stock_counts", "date")):
        fr[name] = frames[name][pd.to_datetime(frames[name][col]) <= end]
    return features_of(fr)

tuning_causal = upto(TUNE_END)
weeks = sorted(test.date.dt.strftime("%G-%V").unique())
causal_rows = []
for w in weeks:
    week_days = test[test.date.dt.strftime("%G-%V") == w].date
    f = upto(week_days.max())
    causal_rows.append(f[f.date.isin(week_days.unique())])
test_causal = pd.concat(causal_rows, ignore_index=True)
e4 = {}
for name, fn in {"rules": lambda: METHODS["rules"](),
                 "isolation_forest": lambda: IsolationForestMethod(n_estimators=100, max_samples=256, random_state=SEED),
                 "one_class_svm": lambda: OneClassSVMMethod(nu=0.05, random_state=SEED),
                 "sgd_one_class_svm": lambda: SGDOneClassMethod(nu=best[0], n_components=best[1], random_state=SEED)}.items():
    r = run(fn, train=tuning_causal, test_frame=test_causal, tune_frame=tuning_causal)
    e4[name] = {"transductive_p10": e1[name]["precision_at_10"], "causal_p10": r["precision_at_10"],
                "transductive_f1": e1[name]["f1"], "causal_f1": r["f1"], "causal_recall_held_out": r["recall_held_out"]}
out["E4_leakage"] = e4

# E5: scalability (rows resampled from the tuning features)
print("E5")
xt = OneClassSVMMethod(random_state=SEED).fit(tuning)._x(tuning)
rng = np.random.default_rng(SEED)
e5 = []
for n in (5000, 20000, 50000, 200000):
    xs = xt[rng.integers(0, len(xt), n)]
    row = {"rows": n}
    for name, make in {
        "one_class_svm_deployed_5000_sample": lambda: OneClassSVM(nu=0.05, gamma="scale"),
        "one_class_svm_all_rows": lambda: OneClassSVM(nu=0.05, gamma="scale"),
        "isolation_forest": lambda: IsolationForest(n_estimators=100, max_samples=256, random_state=SEED),
        "sgd_one_class_svm": lambda: make_pipeline(Nystroem(gamma=1 / (xs.shape[1] * xs.var()), n_components=best[1], random_state=SEED),
                                                   SGDOneClassSVM(nu=best[0], random_state=SEED, max_iter=50, tol=1e-4)),
    }.items():
        if name == "one_class_svm_all_rows" and n > 50000:
            row[name] = "not run (quadratic: estimated from the trend)"
            continue
        train = xs[rng.choice(n, 5000, replace=False)] if name.endswith("5000_sample") else xs
        m = make()
        t0 = time.perf_counter()
        m.fit(train)
        fit_s = time.perf_counter() - t0
        t0 = time.perf_counter()
        (m.decision_function if hasattr(m, "decision_function") else m.score_samples)(xs[:5000])
        row[name] = {"fit_s": round(fit_s, 3), "score_5000_s": round(time.perf_counter() - t0, 3),
                     **({"support_vectors": int(len(m.support_))} if isinstance(m, OneClassSVM) else {})}
    e5.append(row)
    print(row)
out["E5_scalability"] = e5

# E6: false flags on ordinary days by school size (the deployed one-class SVM, protocol threshold)
print("E6")
sizes = frames["enrolment"].groupby("school_id").learners.mean()
tercile = pd.qcut(sizes, 3, labels=["small", "medium", "large"])
ordinary = (test.label == "").to_numpy()
e6 = {}
for name in ("isolation_forest", "one_class_svm", "sgd_one_class_svm"):
    flag = e1[name]["_flag"]
    t = test.assign(flag=flag, size=test.school_id.map(tercile).astype(str))[ordinary]
    e6[name] = {str(k): round(1000 * v, 1) for k, v in t.groupby("size").flag.mean().items()}
    e6[name]["by_programme_type"] = {str(k): round(1000 * v, 1) for k, v in
                                      t.merge(frames["schools"][["school_id", "programme_type"]], on="school_id").groupby("programme_type").flag.mean().items()}
out["E6_false_flags_per_1000_ordinary_days"] = e6

OUT.parent.mkdir(parents=True, exist_ok=True)
json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1, default=str)
print("done")
