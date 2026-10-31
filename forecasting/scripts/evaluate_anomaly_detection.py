"""
Evaluate six anomaly detection methods on synthetic school feeding records, following
the protocol committed before any method was run (config/anomaly_evaluation.yaml).

  1. Tuning period (2024-2025, tuning anomaly types only): each method's grid setting
     and flag threshold are chosen to maximise F1 against the tuning labels.
  2. Test period (2026, every type including the held-out ones): scored once.
  3. Weekly review list: each week the k school-weeks with the highest score across the
     programme; precision@k is the share of them that contain an anomaly.
  4. The decision rule from the protocol picks the recommended method.

Outputs
  data/reports/anomaly/anomaly_evaluation.json
  data/reports/anomaly/anomaly_evaluation.md

Usage
  python forecasting/scripts/generate_feeding_dataset.py
  python forecasting/scripts/evaluate_anomaly_detection.py
"""

import itertools
import sys
import time
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

from anomaly.explain import explain  # noqa: E402
from anomaly.features import build_features  # noqa: E402
from anomaly.methods import METHODS  # noqa: E402
from common import REPORTS_DIR, md_table, sha256_of, write_json  # noqa: E402
from generate_feeding_dataset import OUT_DIR as DATA_DIR, PROTOCOL  # noqa: E402

REPORT_DIR = REPORTS_DIR / "anomaly"
# Report order, simplest first
SIMPLICITY = ["rules", "robust_zscore", "isolation_forest", "local_outlier_factor", "one_class_svm", "autoencoder"]
# The protocol's simplicity order: rules < robust z-score < the learned methods. It does
# not rank the learned methods against each other.
TIER = {"rules": 0, "robust_zscore": 1, "isolation_forest": 2, "local_outlier_factor": 2, "one_class_svm": 2, "autoencoder": 2}
LABELS = {"rules": "Fixed rules", "robust_zscore": "Robust z-score", "isolation_forest": "Isolation Forest",
          "local_outlier_factor": "Local Outlier Factor", "one_class_svm": "One-class SVM", "autoencoder": "Autoencoder"}


def load():
    files = {n: DATA_DIR / f"{n}.csv" for n in ("schools", "enrolment", "feeding", "stock_counts", "school_days", "labels")}
    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        sys.exit("ERROR: run forecasting/scripts/generate_feeding_dataset.py first")
    frames = {n: pd.read_csv(p) for n, p in files.items()}
    hashes = {n: sha256_of(p) for n, p in files.items()}
    return frames, hashes


def grid(spec):
    keys = list(spec)
    return [dict(zip(keys, values)) for values in itertools.product(*(spec[k] for k in keys))] or [{}]


def best_threshold(scores, truth):
    """The score threshold with the highest F1 (candidates: upper quantiles of the scores)."""
    best = (0.0, np.inf)
    for q in np.linspace(0.80, 0.999, 120):
        t = np.quantile(scores, q)
        flag = scores >= t
        tp = (flag & truth).sum()
        if tp == 0:
            continue
        p, r = tp / flag.sum(), tp / truth.sum()
        f1 = 2 * p * r / (p + r)
        if f1 > best[0]:
            best = (f1, t)
    return best


def day_metrics(flag, frame):
    truth = frame.label != ""
    tp = int((flag & truth).sum())
    fp = int((flag & ~truth).sum())
    fn = int((~flag & truth).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    by_type = {t: float(flag[frame.label == t].mean()) for t in sorted(frame.label[truth].unique())}
    normal = ~truth
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0.0,
            "recall_by_type": by_type, "false_flags_per_1000_normal_days": 1000 * fp / normal.sum()}


def review_weeks(frame, scores):
    """School-weeks with their highest day score and whether they contain an anomaly."""
    w = frame[["school_id", "date", "label"]].assign(score=scores, week=frame.date.dt.strftime("%G-%V"))
    return w.groupby(["week", "school_id"]).agg(score=("score", "max"), anomalous=("label", lambda s: (s != "").any())).reset_index()


def precision_at_k(weeks, k):
    listed = weeks.sort_values("score", ascending=False).groupby("week").head(k)
    return listed.anomalous.mean(), listed


def main():
    started = time.time()
    protocol = yaml.safe_load(open(PROTOCOL, encoding="utf-8"))
    frames, hashes = load()
    feats = build_features(frames["schools"], frames["enrolment"], frames["feeding"], frames["stock_counts"], frames["school_days"])
    labels = frames["labels"].assign(date=lambda d: pd.to_datetime(d.date))
    feats = feats.merge(labels, on=["school_id", "date"], how="left")
    feats["label"] = feats.label.fillna("")
    tune_end = pd.Timestamp(protocol["data"]["tuning_period"]["end"])
    tuning = feats[feats.date <= tune_end]
    test = feats[feats.date > tune_end]
    held_out = protocol["anomaly_types"]["held_out"]
    assert not tuning.label.isin(held_out).any(), "held-out types must not appear in the tuning period"
    k = protocol["scoring"]["review_list"]["k"]
    seed = protocol["tuning"]["random_seed"]

    results, scores_by_method, models = {}, {}, {}
    for name in protocol["methods"]:
        cls = METHODS[name]
        best = None
        for params in grid(protocol["tuning"].get(name, {})):
            kwargs = dict(params)
            if name != "rules" and name != "robust_zscore":
                kwargs["random_state"] = seed
            model = cls(**kwargs).fit(tuning)
            if name == "robust_zscore":
                all_scores = pd.Series(model.score(feats), index=feats.index)
                tune_scores, test_scores = all_scores[tuning.index].to_numpy(), all_scores[test.index].to_numpy()
            else:
                tune_scores, test_scores = model.score(tuning), model.score(test)
            f1, threshold = best_threshold(tune_scores, (tuning.label != "").to_numpy())
            if best is None or f1 > best["tuning_f1"]:
                best = {"params": params, "tuning_f1": f1, "threshold": threshold, "model": model, "test_scores": test_scores}
        flag = best["test_scores"] >= best["threshold"]
        weeks = review_weeks(test, best["test_scores"])
        pk, listed = precision_at_k(weeks, k)
        anomalous_weeks = weeks.anomalous.sum()
        results[name] = {
            "params": best["params"], "tuning_f1": round(best["tuning_f1"], 4), "threshold": float(best["threshold"]),
            "test": {key: (round(v, 4) if isinstance(v, float) else v) for key, v in day_metrics(flag, test).items()},
            "precision_at_k": round(float(pk), 4),
            "anomalous_school_weeks_listed": round(float(listed.anomalous.sum() / anomalous_weeks), 4),
        }
        results[name]["test"]["recall_by_type"] = {t: round(v, 4) for t, v in results[name]["test"]["recall_by_type"].items()}
        results[name]["test"]["recall_held_out"] = round(float(flag[test.label.isin(held_out).to_numpy()].mean()), 4)
        scores_by_method[name] = weeks
        models[name] = best
        print(f"{name}: precision@{k} {pk:.3f}, test F1 {results[name]['test']['f1']:.3f} ({time.time() - started:.0f}s)")

    # Bootstrap over weeks: the difference in precision@k against the best method
    rng = np.random.default_rng(seed)
    week_ids = scores_by_method[protocol["methods"][0]].week.unique()
    per_week = {}
    for name, weeks in scores_by_method.items():
        listed = weeks.sort_values("score", ascending=False).groupby("week").head(k)
        per_week[name] = listed.groupby("week").anomalous.agg(["sum", "size"]).reindex(week_ids, fill_value=0)
    leader = max(results, key=lambda n: results[n]["precision_at_k"])
    samples = protocol["scoring"]["bootstrap"]["samples"]
    draws = rng.integers(0, len(week_ids), size=(samples, len(week_ids)))
    for name in results:
        diffs = []
        for d in draws:
            a = per_week[name].iloc[d]
            b = per_week[leader].iloc[d]
            diffs.append(a["sum"].sum() / a["size"].sum() - b["sum"].sum() / b["size"].sum())
        lo, hi = np.percentile(diffs, [2.5, 97.5])
        results[name]["vs_leader"] = {"leader": leader, "difference": round(results[name]["precision_at_k"] - results[leader]["precision_at_k"], 4),
                                      "ci_low": round(float(lo), 4), "ci_high": round(float(hi), 4)}

    # Decision rule: among methods whose interval against the leader includes zero, the
    # simplest tier; within a tier, the one with the highest precision@k
    tied = [n for n in results if results[n]["vs_leader"]["ci_high"] >= 0]
    simplest = min(TIER[n] for n in tied)
    recommended = max((n for n in tied if TIER[n] == simplest), key=lambda n: results[n]["precision_at_k"])
    tied_with_leader = sorted(n for n in tied if n != leader)

    # Context: the best precision@k any method could reach, given how few school-weeks
    # contain an anomaly each week
    any_weeks = scores_by_method[leader]
    per_week_anomalous = any_weeks.groupby("week").anomalous.sum()
    ceiling = float(np.minimum(per_week_anomalous, k).sum() / (k * len(per_week_anomalous)))

    # A leak only leaves a trace on store-count days: recall on those days
    count_days = test.count_gap_change != 0
    leak_count = (test.label == "stock_leakage") & count_days
    for name, best in models.items():
        flag = best["test_scores"] >= best["threshold"]
        results[name]["test"]["stock_leakage_recall_on_count_days"] = round(float(flag[leak_count.to_numpy()].mean()), 4) if leak_count.any() else None

    # Example explanations from the recommended method's review list
    rec = models[recommended]
    listed = scores_by_method[recommended].sort_values("score", ascending=False).groupby("week").head(k)
    examples = []
    sample = listed[listed.anomalous].head(4)._append(listed[~listed.anomalous].head(2))
    for row in sample.itertuples():
        day = test[(test.school_id == row.school_id) & (test.date.dt.strftime("%G-%V") == row.week)]
        day_scores = pd.Series(rec["test_scores"], index=test.index)[day.index]
        top = day.loc[day_scores.idxmax()]
        if recommended == "robust_zscore":
            contrib = rec["model"].contributions_frame(feats).loc[top.name].to_dict()
        else:
            contrib = rec["model"].contributions(top)
        examples.append({"school": top.school_id, "date": str(top.date.date()), "truth": top.label or "none",
                         "explanation": explain(top, contrib)})

    out = {
        "protocol": str(PROTOCOL.relative_to(FORECASTING_DIR.parent)),
        "dataset_sha256": hashes,
        "rows": {"tuning": int(len(tuning)), "test": int(len(test)),
                 "tuning_anomalous": int((tuning.label != "").sum()), "test_anomalous": int((test.label != "").sum())},
        "k": k, "results": results, "leader": leader, "recommended": recommended,
        "tied_with_leader": tied_with_leader, "precision_at_k_ceiling": round(ceiling, 4),
        "leak_count_days": int(leak_count.sum()), "examples": examples,
        "runtime_seconds": round(time.time() - started),
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "anomaly_evaluation.json", out)
    write_report(out, protocol)
    print(f"Leader: {leader}; recommended: {recommended}. Wrote {REPORT_DIR / 'anomaly_evaluation.md'}")


def pct(v):
    return f"{v * 100:.1f}%"


def write_report(out, protocol):
    r = out["results"]
    names = [n for n in SIMPLICITY if n in r]
    types = sorted({t for n in names for t in r[n]["test"]["recall_by_type"]})
    held = protocol["anomaly_types"]["held_out"]
    lines = [
        "# Anomaly detection: evaluation on synthetic school feeding records",
        "",
        f"Protocol: [`{out['protocol']}`](../../../config/anomaly_evaluation.yaml), committed before any method was run. "
        f"Data: 40 synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period "
        f"{out['rows']['tuning']:,} school-days ({out['rows']['tuning_anomalous']} anomalous, tuning types only), test period "
        f"{out['rows']['test']:,} school-days ({out['rows']['test_anomalous']} anomalous, every type). "
        f"The held-out types ({', '.join(held)}) never appear before the test run.",
        "",
        f"## Weekly review list (primary metric: precision@{out['k']})",
        "",
        f"Each week, the {out['k']} school-weeks with the highest scores across the programme. Precision@{out['k']} is the share of "
        "them that really contain an anomaly; the interval is a 1,000-sample bootstrap over weeks of the difference against the "
        "best method.",
        "",
        md_table([[LABELS[n], pct(r[n]["precision_at_k"]), pct(r[n]["anomalous_school_weeks_listed"]),
                   f"{r[n]['vs_leader']['difference'] * 100:+.1f} ({r[n]['vs_leader']['ci_low'] * 100:+.1f} to {r[n]['vs_leader']['ci_high'] * 100:+.1f})"]
                  for n in names],
                 ["Method", f"Precision@{out['k']}", "Anomalous school-weeks listed", "Difference from the best (points, 95% interval)"]),
        "",
        f"**Recommended under the decision rule: {LABELS[out['recommended']]}** (best precision@{out['k']}: {LABELS[out['leader']]}). "
        + (f"Not distinguishable from it at 95%: {', '.join(LABELS[n] for n in out['tied_with_leader'])}." if out["tied_with_leader"] else ""),
        "",
        f"The best precision@{out['k']} any method could reach is {pct(out['precision_at_k_ceiling'])}: most weeks have fewer than "
        f"{out['k']} school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@{out['k']} is therefore "
        "best read against that ceiling, together with the share of anomalous school-weeks that make the list.",
        "",
        "## School-day flags (threshold chosen on the tuning period)",
        "",
        md_table([[LABELS[n], pct(r[n]["test"]["precision"]), pct(r[n]["test"]["recall"]), pct(r[n]["test"]["f1"]),
                   pct(r[n]["test"]["recall_held_out"]), f"{r[n]['test']['false_flags_per_1000_normal_days']:.1f}"] for n in names],
                 ["Method", "Precision", "Recall", "F1", "Recall, held-out types", "False flags per 1,000 ordinary days"]),
        "",
        "## Recall by anomaly type (test)",
        "",
        md_table([[LABELS[n]] + [pct(r[n]["test"]["recall_by_type"].get(t, 0)) for t in types] for n in names],
                 ["Method"] + [f"{t}{' (held out)' if t in held else ''}" for t in types]),
        "",
        f"Stock leakage leaves a trace only on days the store is counted ({out['leak_count_days']} such days in the test period). "
        "Recall on those days: " + "; ".join(f"{LABELS[n]} {pct(r[n]['test']['stock_leakage_recall_on_count_days'] or 0)}" for n in names) + ".",
        "",
        "## Settings chosen on the tuning period",
        "",
        md_table([[LABELS[n], ", ".join(f"{k}={v}" for k, v in r[n]["params"].items()) or "fixed", f"{r[n]['tuning_f1']:.3f}"] for n in names],
                 ["Method", "Setting", "Tuning F1"]),
        "",
        f"## Example review-list entries ({LABELS[out['recommended']]})",
        "",
        md_table([[e["school"], e["date"], e["truth"], e["explanation"]] for e in out["examples"]],
                 ["School", "Date", "Injected anomaly", "What the officer sees"]),
        "",
        "These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated "
        "assumptions, not how often they would be right at real schools.",
        "",
    ]
    (REPORT_DIR / "anomaly_evaluation.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
