"""
Protocol version 9, part A, investigation 6: the detectability diagnostic.

A labelled model (scikit-learn HistGradientBoostingClassifier, default settings, no
tuning) trained on 2024's school-days with their labels and evaluated on 2025. It is a
benchmark of how much the features can tell problems apart, not a ceiling and not part of
the system: real schools have no labels. Its weekly threshold is chosen on 2024 from
out-of-fold predictions (5 folds grouped by school), so 2025 is used only to measure.

Two feature sets: version 8's 15 features, and those plus version 8's two candidates.
Version 8's own 2025 school-weeks (score_2025.py) are scored the same way for comparison.

Output
  data/reports/anomaly/v9_investigation/diagnostic_2025.json
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FORECASTING_DIR = HERE.parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
sys.path.insert(0, str(FORECASTING_DIR / "scripts"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: E402
from sklearn.metrics import average_precision_score, roc_auc_score  # noqa: E402
from sklearn.model_selection import GroupKFold  # noqa: E402

from anomaly.features import EXTRA_FEATURES, FEATURES  # noqa: E402
from anomaly.weekly import weekly_scores  # noqa: E402
from common import REPORTS_DIR, write_json  # noqa: E402
import analyse_2025 as a  # noqa: E402

K = 3
QUANTILES = [None, 0.90, 0.93, 0.95, 0.97, 0.98]


def frames():
    out = []
    for name, d in a.DATASETS.items():
        f = a.v7.load_dataset(Path(d))
        out.append(f[(f.date >= pd.Timestamp("2024-01-01")) & (f.date <= a.END)].assign(dataset=name))
    f = pd.concat(out, ignore_index=True)
    f["y"] = (f.label != "").astype(int)
    f["group"] = f.dataset + ":" + f.school_id
    return f


def weekly_lists(days, score_col, threshold):
    """School-weeks with the top-2-day mean of the score; at most 3 per sub-county-week above the threshold."""
    w = weekly_scores(days.assign(score=days[score_col]), keys=("dataset", "sub_county", "week", "school_id")).rename("score")
    lab = days.groupby(["dataset", "sub_county", "week", "school_id"]).y.max().rename("anomalous").astype(bool)
    w = pd.concat([w, lab], axis=1).reset_index()
    w = w.sort_values("score", ascending=False)
    eligible = w if threshold is None else w[w.score > threshold]
    listed = eligible.groupby(["dataset", "sub_county", "week"]).head(K).index
    w["listed"] = w.index.isin(listed)
    return w


def measure(w):
    p = w[w.listed].anomalous.mean() if w.listed.any() else 0.0
    r = w[w.anomalous].listed.mean()
    return {"precision_at_k": round(float(p), 4), "recall_at_k": round(float(r), 4),
            "f1_at_k": round(float(2 * p * r / (p + r)) if p + r else 0.0, 4)}


def run(feature_names, f):
    train, test = f[f.date.dt.year == 2024], f[(f.date >= a.START) & (f.date <= a.END)]
    # Out-of-fold predictions on 2024, to choose the weekly threshold without touching 2025
    oof = np.zeros(len(train))
    for tr, va in GroupKFold(n_splits=5).split(train, train.y, train.group):
        m = HistGradientBoostingClassifier(random_state=0).fit(train.iloc[tr][feature_names], train.iloc[tr].y)
        oof[va] = m.predict_proba(train.iloc[va][feature_names])[:, 1]
    train = train.assign(p=oof)
    weekly_train = weekly_scores(train.assign(score=train.p), keys=("dataset", "sub_county", "week", "school_id"))
    choices = {}
    for q in QUANTILES:
        t = None if q is None else float(weekly_train.quantile(q))
        choices[str(q)] = (measure(weekly_lists(train, "p", t))["f1_at_k"], t)
    best_q = max(choices, key=lambda q: choices[q][0])
    threshold = choices[best_q][1]

    model = HistGradientBoostingClassifier(random_state=0).fit(train[feature_names], train.y)
    test = test.assign(p=model.predict_proba(test[feature_names])[:, 1])
    day = {"auc": round(float(roc_auc_score(test.y, test.p)), 4),
           "average_precision": round(float(average_precision_score(test.y, test.p)), 4),
           "by_type_auc": {t: round(float(roc_auc_score(g.label == t, g.p)), 4)
                           for t in sorted(set(test.label) - {""})
                           for g in [test[(test.label == "") | (test.label == t)]]}}
    weekly = weekly_lists(test, "p", threshold)
    weekly_test = weekly_scores(test.assign(score=test.p), keys=("dataset", "sub_county", "week", "school_id"))
    candidates = []
    for q in QUANTILES:
        t = None if q is None else float(weekly_test.quantile(q))
        candidates.append((measure(weekly_lists(test, "p", t)), q))
    best_on_2025 = max(candidates, key=lambda x: x[0]["f1_at_k"])
    by_type = {}
    types = test.groupby(["dataset", "sub_county", "week", "school_id"]).label.agg(lambda s: sorted(set(s) - {""}))
    wt = weekly.join(types.rename("types"), on=["dataset", "sub_county", "week", "school_id"])
    for t in sorted(set(test.label) - {""}):
        part = wt[wt.types.map(lambda xs, t=t: t in xs)]
        by_type[t] = round(float(part.listed.mean()), 4)
    return {"features": feature_names, "threshold_quantile_chosen_on_2024": best_q, "school_days": day,
            "school_weeks": measure(weekly), "listed_by_type": by_type,
            "best_threshold_on_2025_optimistic": {**best_on_2025[0], "q": best_on_2025[1]}}


def main():
    f = frames()
    out = {"protocol": "config/anomaly_v9.yaml part A, investigation 6",
           "model": "HistGradientBoostingClassifier, default settings, random_state=0",
           "trained_on": "2024 (labels)", "evaluated_on": "2025",
           "note": "a benchmark of what the features can separate, not a ceiling and not part of the system",
           "version_8_features": run(list(FEATURES), f),
           "with_version_8_candidates": run(list(FEATURES) + list(EXTRA_FEATURES), f)}
    # Version 8 itself on the same 2025 school-weeks, unsupervised, as deployed (one model seed per dataset)
    weeks = pd.read_csv(a.IN / "weeks_2025.csv.gz", keep_default_na=False)
    weeks["anomalous"], weeks["listed"] = weeks.anomalous.astype(str).eq("True"), weeks.listed.astype(str).eq("True")
    weeks = weeks[weeks.week.map(lambda x: a.START <= pd.Timestamp.fromisocalendar(int(x[:4]), int(x[5:]), 1) <= a.END)]
    out["version_8_unsupervised"] = measure(weeks[weeks.model_seed.astype(int) == 1])
    a.OUT.mkdir(parents=True, exist_ok=True)
    write_json(a.OUT / "diagnostic_2025.json", out)
    for k in ("version_8_features", "with_version_8_candidates"):
        print(k, out[k]["school_days"], out[k]["school_weeks"], out[k]["listed_by_type"], out[k]["best_threshold_on_2025_optimistic"])
    print("version 8 (seed 1):", out["version_8_unsupervised"])


if __name__ == "__main__":
    main()
