"""
Protocol version 9, part A (config/anomaly_v9.yaml), investigations 1-5 on 2025 only:
feature inventory, capacity check, error analysis, temporal signals and score calibration.

Reads the output of score_2025.py and each dataset's 2024-2025 records. Nothing from 2026.

Output
  data/reports/anomaly/v9_investigation/analysis_2025.json
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FORECASTING_DIR = HERE.parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
sys.path.insert(0, str(FORECASTING_DIR / "scripts"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402

from anomaly.features import EXTRA_FEATURES, FEATURES  # noqa: E402
from common import REPORTS_DIR, write_json  # noqa: E402
from generate_feeding_dataset import OUT_DIR as MAIN_DATA  # noqa: E402
import run_anomaly_deployment_test as v7  # noqa: E402

IN = FORECASTING_DIR / "data" / "processed" / "feeding_deployment" / "v9_investigation"
OUT = REPORTS_DIR / "anomaly" / "v9_investigation"
START, END = pd.Timestamp("2025-01-06"), pd.Timestamp("2025-12-31")
K = 3
DATASETS = {"main": MAIN_DATA, **{f"seed_{s}": v7.DATA_ROOT / f"seed_{s}" for s in (101, 202, 303)}}


def auc(y, x):
    """Area under the ROC curve, and its direction: 'higher' if problems score higher."""
    if y.nunique() < 2:
        return None, None
    a = roc_auc_score(y, x)
    return round(float(max(a, 1 - a)), 4), ("higher" if a >= 0.5 else "lower")


def prf(df, listed_col="listed"):
    """Mean Precision@3, Recall@3 and F1@3 over runs (dataset x model seed)."""
    rows = []
    for _, g in df.groupby(["dataset", "model_seed"]):
        listed = g[g[listed_col]]
        p = listed.anomalous.mean() if len(listed) else np.nan
        r = g[g.anomalous][listed_col].mean()
        rows.append((p, r, 2 * p * r / (p + r) if p + r else 0.0))
    a = np.nanmean(np.array(rows), axis=0)
    return {"precision_at_k": round(float(a[0]), 4), "recall_at_k": round(float(a[1]), 4), "f1_at_k": round(float(a[2]), 4)}


def load_features():
    out = []
    for name, d in DATASETS.items():
        f = v7.load_dataset(Path(d))
        f = f[(f.date >= START) & (f.date <= END)].assign(dataset=name)
        out.append(f)
    return pd.concat(out, ignore_index=True)


def feature_inventory(feats):
    types = sorted(t for t in feats.label.unique() if t)
    rows = []
    for feat in list(FEATURES) + list(EXTRA_FEATURES):
        row = {"feature": feat, "extra_candidate": feat in EXTRA_FEATURES}
        for t in types:
            part = feats[(feats.label == "") | (feats.label == t)]
            a, direction = auc(part.label == t, part[feat])
            row[t] = a
            row[f"{t}_direction"] = direction
        rows.append(row)
    return {"types": types, "rows": rows}


def capacity(weeks):
    one = weeks[weeks.model_seed == weeks.model_seed.min()]
    per = one.groupby(["dataset", "sub_county", "week"]).anomalous.sum()
    recall_ceiling = float(np.minimum(per, K).sum() / per.sum())
    return {
        "sub_county_weeks": int(len(per)),
        "problems_per_sub_county_week": {int(k): int(v) for k, v in per.value_counts().sort_index().items()},
        "share_with_more_than_3": round(float((per > K).mean()), 4),
        "problem_school_weeks": int(per.sum()),
        "share_of_school_weeks_with_a_problem": round(float(one.anomalous.mean()), 4),
        "best_recall_at_k": round(recall_ceiling, 4),
        "best_precision_at_k": 1.0,
        "best_f1_at_k": round(2 * recall_ceiling / (1 + recall_ceiling), 4),
    }


def episodes_by_week(weeks):
    """Each problem school-week with its episode: how long it ran and weeks since it began."""
    rows = []
    for name, d in DATASETS.items():
        ep = pd.read_csv(Path(d) / "episodes.csv", parse_dates=["start", "end"])
        ep = ep[(ep.start <= END) & (ep.end >= START)]
        for e in ep.itertuples():
            covered = sorted({x.strftime("%G-%V") for x in pd.date_range(max(e.start, START), min(e.end, END))})
            first_week = e.start.strftime("%G-%V")
            all_weeks = sorted({x.strftime("%G-%V") for x in pd.date_range(e.start, e.end)})
            for wk in covered:
                rows.append({"dataset": name, "school_id": e.school_id, "week": wk, "episode_type": e.type,
                             "episode_days": int((e.end - e.start).days + 1), "episode_weeks": len(all_weeks),
                             "weeks_since_start": all_weeks.index(wk) if wk >= first_week else 0,
                             "episode_id": f"{name}:{e.school_id}:{e.start.date()}"})
    return pd.DataFrame(rows)


def error_analysis(weeks, groups):
    w = weeks.merge(groups, on=["dataset", "school_id"], how="left")
    problems = w[w.anomalous].copy()
    problems["missed"] = ~problems.listed
    problems["reason"] = np.where(problems.listed, "listed",
                                  np.where(problems.score <= problems.threshold, "below the review threshold",
                                           "above it, outranked by 3 others"))
    missed = problems[problems.missed]

    def breakdown(df, col):
        g = df.groupby(col)
        return {str(k): {"problem_weeks": int(len(v)), "listed": round(float(v.listed.mean()), 4)} for k, v in g}

    ordinary = w[~w.anomalous]
    false = ordinary[ordinary.listed]

    def false_breakdown(col):
        return {str(k): {"ordinary_weeks": int(len(v)), "false_listing_rate": round(float(v.listed.mean()), 4)}
                for k, v in ordinary.groupby(col)}

    # Ordinary school-weeks listed soon after the same school's problem ended
    eps = problems.groupby(["dataset", "model_seed", "school_id"]).week.max().rename("last_problem_week")
    f = false.join(eps, on=["dataset", "model_seed", "school_id"])
    after = f.last_problem_week.notna() & (f.week > f.last_problem_week)
    weeks_after = f[after].apply(lambda r: _week_gap(r.last_problem_week, r.week), axis=1)
    return {
        "problem_weeks": int(len(problems)),
        "missed_share": round(float(problems.missed.mean()), 4),
        "why_missed": {k: round(float(v), 4) for k, v in missed.reason.value_counts(normalize=True).items()},
        "missed_rank_distribution": {str(k): int(v) for k, v in missed["rank"].clip(upper=8).value_counts().sort_index().items()},
        "missed_percentile_in_window_median": round(float(missed.percentile_in_window.median()), 4),
        "by_type": breakdown(problems, "episode_type"),
        "by_size": breakdown(problems, "size_group"),
        "by_sub_county": breakdown(problems, "sub_county"),
        "by_programme": breakdown(problems, "programme_group"),
        "by_episode_weeks": breakdown(problems.assign(b=pd.cut(problems.episode_weeks, [0, 4, 8, 13, 100],
                                                                labels=["1-4", "5-8", "9-13", "14+"])), "b"),
        "by_anomalous_days_in_week": breakdown(problems.assign(b=problems.anomalous_days.clip(upper=5)), "b"),
        "by_weeks_since_start": breakdown(problems.assign(b=problems.weeks_since_start.clip(upper=6)), "b"),
        "by_type_and_reason": {t: {k: round(float(v), 4) for k, v in g.reason.value_counts(normalize=True).items()}
                               for t, g in problems.groupby("episode_type")},
        "false_listings": {
            "count": int(len(false)), "share_of_listed": round(float(len(false) / max(int(w.listed.sum()), 1)), 4),
            "by_size": false_breakdown("size_group"), "by_sub_county": false_breakdown("sub_county"),
            "by_programme": false_breakdown("programme_group"),
            "with_a_rule_breach": round(float(false.rule_breach.mean()), 4),
            "within_2_weeks_after_the_schools_problem": round(float(((weeks_after >= 1) & (weeks_after <= 2)).sum() / max(len(false), 1)), 4),
        },
    }


def _week_gap(a, b):
    da = pd.Timestamp.fromisocalendar(int(a[:4]), int(a[5:]), 1)
    db = pd.Timestamp.fromisocalendar(int(b[:4]), int(b[5:]), 1)
    return int((db - da).days // 7)


def temporal_signals(days, weeks):
    d = days.assign(high=days.score > days.p90_day).sort_values(["dataset", "model_seed", "school_id", "date"])

    def longest(s):
        best = run = 0
        for v in s:
            run = run + 1 if v else 0
            best = max(best, run)
        return best

    g = d.groupby(["dataset", "model_seed", "school_id", "week"])
    sig = pd.DataFrame({"days_high": g.high.sum(), "longest_run_high": g.high.agg(longest)}).reset_index()
    w = weeks.merge(sig, on=["dataset", "model_seed", "school_id", "week"])
    w = w.sort_values(["dataset", "model_seed", "school_id", "week"])
    by = w.groupby(["dataset", "model_seed", "school_id"]).score
    w["previous_week"] = by.shift(1)
    w["trend"] = w.score - w.previous_week
    w["two_week_mean"] = (w.score + w.previous_week.fillna(w.score)) / 2
    w["vs_own_weeks"] = w.score - by.transform(lambda s: s.shift(1).rolling(8, min_periods=3).median())
    signals = ["score", "days_high", "longest_run_high", "previous_week", "trend", "two_week_mean", "vs_own_weeks"]
    out = {}
    for s in signals:
        valid = w[s].notna()
        a, direction = auc(w.anomalous[valid], w[s][valid])
        # Ranked by the signal at the same workload as version 8: in each run, list the same
        # number of school-weeks as version 8 did, the highest by the signal, at most 3 per
        # sub-county-week (the signals have no training-window distribution for the threshold)
        listed_cols = []
        for (ds, seed), run in w.groupby(["dataset", "model_seed"]):
            n = int(run.listed.sum())
            r = run[valid.loc[run.index]].copy()
            r["key"] = r[s] + r.score * 1e-9   # ties broken by the weekly score
            r = r.sort_values("key", ascending=False)
            r = r.groupby(["sub_county", "week"]).head(K).head(n)
            listed_cols.append(pd.Series(True, index=r.index))
        mark = pd.concat(listed_cols).reindex(w.index, fill_value=False)
        out[s] = {"auc": a, "direction": direction, **prf(w.assign(alt=mark), "alt")}
    return out


def calibration(weeks, groups):
    w = weeks.merge(groups, on=["dataset", "school_id"], how="left")
    term = pd.to_datetime(w.week.map(lambda x: pd.Timestamp.fromisocalendar(int(x[:4]), int(x[5:]), 1))).dt.month
    w["term"] = pd.cut(term, [0, 4, 8, 12], labels=["Term 1", "Term 2", "Term 3"])
    a_raw, _ = auc(w.anomalous, w.score)
    a_pct, _ = auc(w.anomalous, w.percentile_in_window)
    by_sc = {sc: {"median_score_ordinary": round(float(g[~g.anomalous].score.median()), 4),
                  "auc_raw": auc(g.anomalous, g.score)[0], "auc_percentile": auc(g.anomalous, g.percentile_in_window)[0]}
             for sc, g in w.groupby("sub_county")}
    by_term = {str(t): {"median_score_ordinary": round(float(g[~g.anomalous].score.median()), 4),
                        "auc_raw": auc(g.anomalous, g.score)[0]} for t, g in w.groupby("term", observed=True)}
    return {"auc_raw_pooled": a_raw, "auc_percentile_pooled": a_pct, "by_sub_county": by_sc, "by_term": by_term,
            "note": "each list is one sub-county-week scored by one model, so calibration across sub-counties cannot change a list"}


def main():
    days = pd.read_csv(IN / "days_2025.csv.gz", parse_dates=["date"])
    weeks = pd.read_csv(IN / "weeks_2025.csv.gz", keep_default_na=False)
    weeks["anomalous"] = weeks.anomalous.astype(str).eq("True")
    weeks["listed"] = weeks.listed.astype(str).eq("True")
    weeks["rule_breach"] = weeks.rule_breach.astype(str).eq("True")
    weeks = weeks[weeks.week.map(lambda x: START <= pd.Timestamp.fromisocalendar(int(x[:4]), int(x[5:]), 1) <= END)]
    for c in ("score", "threshold", "percentile_in_window"):
        weeks[c] = weeks[c].astype(float)
    for c in ("rank", "anomalous_days", "model_seed"):
        weeks[c] = weeks[c].astype(int)
    days = days[days.week.isin(weeks.week.unique())]
    print("v8 on 2025:", prf(weeks))
    feats = load_features()
    groups = feats.groupby(["dataset", "school_id"]).agg(size_group=("size_group", "first"),
                                                         programme_group=("programme_group", "first")).reset_index()
    ep = episodes_by_week(weeks)
    weeks = weeks.merge(ep.drop_duplicates(["dataset", "school_id", "week"]), on=["dataset", "school_id", "week"], how="left")
    out = {
        "protocol": "config/anomaly_v9.yaml part A", "period": "2025 (development)", "version_8_on_2025": prf(weeks),
        "feature_inventory": feature_inventory(feats),
        "capacity": capacity(weeks),
        "error_analysis": error_analysis(weeks, groups),
        "temporal_signals": temporal_signals(days, weeks),
        "calibration": calibration(weeks, groups),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    write_json(OUT / "analysis_2025.json", out)
    print(json.dumps({k: out[k] for k in ("version_8_on_2025", "capacity")}, indent=1))


if __name__ == "__main__":
    main()
