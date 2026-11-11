"""
Evaluate anomaly detection methods (two baselines, four candidates) on synthetic school
feeding records, following the protocol committed before any method was run
(config/anomaly_evaluation.yaml).

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
from anomaly.methods import FEATURE_NAMES, METHODS  # noqa: E402
from common import REPORTS_DIR, md_table, sha256_of, write_json  # noqa: E402
from generate_feeding_dataset import OUT_DIR as DATA_DIR, PROTOCOL  # noqa: E402

REPORT_DIR = REPORTS_DIR / "anomaly"
# Report order, simplest first
SIMPLICITY = ["rules", "robust_zscore", "isolation_forest", "extended_isolation_forest", "one_class_svm", "sgd_one_class_svm",
              "local_outlier_factor"]
# The protocol's simplicity order: rules < robust z-score < the learned methods. It does
# not rank the learned methods against each other.
TIER = {"rules": 0, "robust_zscore": 1, "isolation_forest": 2, "extended_isolation_forest": 2, "local_outlier_factor": 2,
        "one_class_svm": 2, "sgd_one_class_svm": 2}
# Rows for the timing benchmark (fitting), and rows scored in it
BENCHMARK_ROWS = [5000, 20000, 50000]
BENCHMARK_SCORE_ROWS = 5000
LABELS = {"rules": "Fixed rules", "robust_zscore": "Robust z-score", "isolation_forest": "Isolation Forest",
          "extended_isolation_forest": "Extended Isolation Forest",
          "local_outlier_factor": "Local Outlier Factor", "one_class_svm": "One-class SVM",
          "sgd_one_class_svm": "SGD one-class SVM"}


def load(data_dir=DATA_DIR):
    files = {n: data_dir / f"{n}.csv" for n in ("schools", "enrolment", "feeding", "stock_counts", "school_days", "labels")}
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
        if flag.all():
            continue
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


def ablation(protocol, method, params, fitting, selection, tuning, test, k, seed):
    """Version 7: the recommended method refitted without one feature at a time, and without
    each group in the protocol. Reported only; features are never chosen from it."""
    if method in ("rules", "robust_zscore") or "ablation" not in protocol:
        return None
    variants = {"all features": []}
    variants.update({f"without {f}": [f] for f in FEATURE_NAMES})
    variants.update({f"without the {g.replace('_', ' ')} group": fs for g, fs in protocol["ablation"]["groups"].items()})

    def run(drop, train, scored):
        model = METHODS[method](**dict(params, random_state=seed))
        model.features = [f for f in FEATURE_NAMES if f not in drop]
        model.fit(train)
        weeks = review_weeks(scored, model.score(scored))
        types = scored.assign(week=scored.date.dt.strftime("%G-%V")).groupby(["week", "school_id"]).label.agg(lambda s: sorted(set(s) - {""}))
        weeks = weeks.join(types.rename("types"), on=["week", "school_id"])
        pk, listed = precision_at_k(weeks, k)
        caught = set(zip(listed.week, listed.school_id))
        by_type = {}
        for t in sorted({x for xs in weeks.types for x in xs}):
            of_type = weeks[weeks.types.map(lambda xs, t=t: t in xs)]
            by_type[t] = round(float(np.mean([(w, s) in caught for w, s in zip(of_type.week, of_type.school_id)])), 4)
        return float(pk), by_type

    rows = []
    for name, drop in variants.items():
        sel_pk, _ = run(drop, fitting, selection)
        test_pk, by_type = run(drop, tuning, test)
        rows.append({"variant": name, "dropped": drop, "selection_precision_at_k": round(sel_pk, 4),
                     "test_precision_at_k": round(test_pk, 4), "test_listed_by_type": by_type})
    full = rows[0]
    for r in rows:
        r["selection_change"] = round(r["selection_precision_at_k"] - full["selection_precision_at_k"], 4)
        r["test_change"] = round(r["test_precision_at_k"] - full["test_precision_at_k"], 4)
    return {"method": method, "variants": rows}


def evaluate(data_dir=DATA_DIR, report_dir=REPORT_DIR, quiet=False, with_ablation=False):
    """Run the protocol on one dataset; write the report into report_dir (None: no files). Returns the results."""
    started = time.time()
    protocol = yaml.safe_load(open(PROTOCOL, encoding="utf-8"))
    frames, hashes = load(data_dir)
    feats = build_features(frames["schools"], frames["enrolment"], frames["feeding"], frames["stock_counts"], frames["school_days"])
    labels = frames["labels"].assign(date=lambda d: pd.to_datetime(d.date))
    feats = feats.merge(labels, on=["school_id", "date"], how="left")
    feats["label"] = feats.label.fillna("")
    tune_end = pd.Timestamp(protocol["data"]["tuning_period"]["end"])
    tuning = feats[feats.date <= tune_end]
    test = feats[feats.date > tune_end]
    # Within the tuning years: fit on the first, choose settings and thresholds on the second
    fit_end = pd.Timestamp(protocol["data"]["fit_period"]["end"])
    fitting = tuning[tuning.date <= fit_end]
    selection = tuning[tuning.date > fit_end]
    truth_sel = (selection.label != "").to_numpy()
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
            # Fitted on the first tuning year, judged on the second
            model = cls(**kwargs).fit(fitting)
            if name == "robust_zscore":
                sel_scores = pd.Series(model.score(feats), index=feats.index)[selection.index].to_numpy()
            else:
                sel_scores = model.score(selection)
            if name == "rules":
                # The protocol fixes the rules' thresholds by programme logic: a day is
                # flagged when it breaks at least one rule. Nothing is tuned.
                flag = sel_scores >= 1.0
                tp = (flag & truth_sel).sum()
                f1, quantile = (2 * tp / (flag.sum() + truth_sel.sum()) if tp else 0.0), None
            else:
                f1, threshold = best_threshold(sel_scores, truth_sel)
                # The threshold as a quantile, so it carries over to the refitted model
                quantile = float((sel_scores < threshold).mean())
            if best is None or f1 > best["tuning_f1"]:
                best = {"params": params, "tuning_f1": f1, "quantile": quantile}
        # The chosen settings, refitted on both tuning years, flag at the same quantile of
        # their scores on the selection year; the test year is scored once
        kwargs = dict(best["params"])
        if name != "rules" and name != "robust_zscore":
            kwargs["random_state"] = seed
        model = cls(**kwargs).fit(tuning)
        if name == "robust_zscore":
            all_scores = pd.Series(model.score(feats), index=feats.index)
            sel_scores, test_scores = all_scores[selection.index].to_numpy(), all_scores[test.index].to_numpy()
        else:
            sel_scores, test_scores = model.score(selection), model.score(test)
        threshold = 1.0 if best["quantile"] is None else float(np.quantile(sel_scores, best["quantile"]))
        best.update({"threshold": threshold, "model": model, "test_scores": test_scores})
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
        if not quiet:
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
    # simplest tier; among learned methods, the one that fits fastest on 50,000 rows
    timings = benchmark(models, tuning, seed)
    tied = [n for n in results if results[n]["vs_leader"]["ci_high"] >= 0]
    simplest = min(TIER[n] for n in tied)
    candidates = [n for n in tied if TIER[n] == simplest]
    if simplest == 2:
        largest = str(BENCHMARK_ROWS[-1])
        recommended = min(candidates, key=lambda n: timings[n][largest]["fit_seconds"])
    else:
        recommended = max(candidates, key=lambda n: results[n]["precision_at_k"])
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

    abl = ablation(protocol, recommended, models[recommended]["params"], fitting, selection, tuning, test, k, seed) if with_ablation else None
    if abl and not quiet:
        print(f"Ablation done ({time.time() - started:.0f}s)")

    out = {
        "protocol": str(PROTOCOL.relative_to(FORECASTING_DIR.parent)),
        "protocol_version": protocol.get("version"),
        "ablation": abl,
        "dataset_sha256": hashes,
        "rows": {"tuning": int(len(tuning)), "test": int(len(test)),
                 "tuning_anomalous": int((tuning.label != "").sum()), "test_anomalous": int((test.label != "").sum())},
        "schools": int(frames["schools"].shape[0]),
        "k": k, "results": results, "leader": leader, "recommended": recommended,
        "tied_with_leader": tied_with_leader, "precision_at_k_ceiling": round(ceiling, 4),
        "timings": timings,
        "leak_count_days": int(leak_count.sum()), "examples": examples,
        "runtime_seconds": round(time.time() - started),
    }
    if report_dir is not None:
        report_dir.mkdir(parents=True, exist_ok=True)
        write_json(report_dir / "anomaly_evaluation.json", out)
        write_report(out, protocol, report_dir)
        if not quiet:
            print(f"Leader: {leader}; recommended: {recommended}. Wrote {report_dir / 'anomaly_evaluation.md'}")
    return out


def benchmark(models, tuning, seed):
    """Seconds to fit each method's chosen setting on n rows (sampled from the tuning
    period, with a little jitter so repeated rows are not identical), and to score 5,000."""
    rng = np.random.default_rng(seed)
    from anomaly.features import FEATURES
    out = {}
    for name, best in models.items():
        cls = type(best["model"])
        out[name] = {}
        for n in BENCHMARK_ROWS:
            rows = tuning.iloc[rng.integers(0, len(tuning), n)].reset_index(drop=True)
            cols = [c for c in FEATURES if c in rows]
            rows[cols] = rows[cols] + rng.normal(0, 1e-3, (n, len(cols)))
            kwargs = dict(best["params"])
            if name not in ("rules", "robust_zscore"):
                kwargs["random_state"] = seed
            start = time.perf_counter()
            model = cls(**kwargs).fit(rows)
            fit_s = time.perf_counter() - start
            start = time.perf_counter()
            model.score(rows.iloc[:BENCHMARK_SCORE_ROWS])
            out[name][str(n)] = {"fit_seconds": round(fit_s, 3), "score_seconds": round(time.perf_counter() - start, 3)}
    return out


def main():
    evaluate(with_ablation=True)


def pct(v):
    return f"{v * 100:.1f}%"


def ablation_section(out):
    abl = out["ablation"]
    types = sorted(abl["variants"][0]["test_listed_by_type"])
    return [
        f"## Feature ablation ({LABELS[abl['method']]})",
        "",
        "The recommended method refitted without one feature, or one group, at a time; precision@k on the selection year "
        "(2025) and the test year (2026), and the share of each problem type's school-weeks listed in the test year. "
        "Reported only: features are not chosen from it (protocol version 7).",
        "",
        md_table([[r["variant"], pct(r["selection_precision_at_k"]), f"{r['selection_change'] * 100:+.1f}",
                   pct(r["test_precision_at_k"]), f"{r['test_change'] * 100:+.1f}"]
                  + [pct(r["test_listed_by_type"].get(t)) for t in types] for r in abl["variants"]],
                 ["Variant", "Precision@k 2025", "Change (points)", "Precision@k 2026", "Change (points)"] + types),
        "",
    ]


def write_report(out, protocol, report_dir=REPORT_DIR):
    r = out["results"]
    names = [n for n in SIMPLICITY if n in r]
    types = sorted({t for n in names for t in r[n]["test"]["recall_by_type"]})
    held = protocol["anomaly_types"]["held_out"]
    lines = [
        "# Anomaly detection: evaluation on synthetic school feeding records",
        "",
        f"Protocol: [`{out['protocol']}`](../../../config/anomaly_evaluation.yaml) version {protocol['version']}, committed before "
        "it was run; what changed from each earlier version, and why, is recorded in the protocol. "
        f"Data: {out['schools']} synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period "
        f"{out['rows']['tuning']:,} school-days ({out['rows']['tuning_anomalous']} anomalous, tuning types only), test period "
        f"{out['rows']['test']:,} school-days ({out['rows']['test_anomalous']} anomalous, every type). "
        f"The held-out types ({', '.join(held)}) never appear before the test run.",
        "",
        "The fixed rules flag a day when it breaks at least one rule, as the protocol sets; their threshold is not tuned.",
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
        f"**Recommended under the decision rule: {LABELS[out['recommended']]}** (best precision@{out['k']}: {LABELS[out['leader']]}; "
        "among learned methods not distinguishable from the best, the rule prefers the fastest to fit on 50,000 rows). "
        + (f"Not distinguishable from it at 95%: {', '.join(LABELS[n] for n in out['tied_with_leader'])}." if out["tied_with_leader"] else ""),
        "",
        f"The best precision@{out['k']} any method could reach is {pct(out['precision_at_k_ceiling'])}: most weeks have fewer than "
        f"{out['k']} school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@{out['k']} is therefore "
        "best read against that ceiling, together with the share of anomalous school-weeks that make the list.",
        "",
        "## School-day flags (threshold chosen on the selection year, 2025)",
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
        "## Settings chosen on the selection year (fitted on 2024, judged on 2025)",
        "",
        md_table([[LABELS[n], ", ".join(f"{k}={v}" for k, v in r[n]["params"].items()) or "fixed", f"{r[n]['tuning_f1']:.3f}"] for n in names],
                 ["Method", "Setting", "F1 on 2025"]),
        "",
        "## Time to fit and score",
        "",
        "Seconds to fit the chosen setting on n school-days, and to score 5,000. The one-class SVM fits on a sample of "
        "5,000 rows and Isolation Forest on its max_samples, so their fitting time levels off by design.",
        "",
        md_table([[LABELS[n]] + [f"{out['timings'][n][str(b)]['fit_seconds']:.2f}" for b in BENCHMARK_ROWS]
                  + [f"{out['timings'][n][str(BENCHMARK_ROWS[-1])]['score_seconds']:.2f}"] for n in names],
                 ["Method"] + [f"Fit, {b:,} rows" for b in BENCHMARK_ROWS] + ["Score 5,000 rows"]),
        "",
        *(ablation_section(out) if out.get("ablation") else []),
        f"## Example review-list entries ({LABELS[out['recommended']]})",
        "",
        md_table([[e["school"], e["date"], e["truth"], e["explanation"]] for e in out["examples"]],
                 ["School", "Date", "Injected anomaly", "What the officer sees"]),
        "",
        "These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated "
        "assumptions, not how often they would be right at real schools.",
        "",
    ]
    (report_dir / "anomaly_evaluation.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
