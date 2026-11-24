"""
Protocol version 12 evaluation loop and measures (config/anomaly_v12.yaml).

The loop re-implements services.scoring_service.rank_week over the point-in-time scorings
built by scripts/run_anomaly_v11.py build_scorings, so a setting can be changed without
changing the service: model per sub-county, refit every REFIT_EVERY school days on the last
WINDOW, follow-up weeks out of the fit, store shortfall listed first, threshold the q-quantile
of the training window's weekly scores, k 3. For version 11 it reproduces rank_week's
listings (scripts/run_anomaly_v12.py --step parity).

What a setting can change (each one a key of the setting dict):
  model       "eif" (default) or "split" (stage M2: dense forest + sparse tail scores)
  features    the features the model uses (default the 15 of version 11)
  extras      features built inside each scoring from its own records (stage M3)
  one_sided, ndim, trees, sample, scale_floor, two_sided   forest settings
  agg         weekly score: "top2" (mean of the two highest days), "top1", "mean"
  shortfall   list a store shortfall first (default True); "summed" also sums a count's
              gap with the other counts of the last 20 school days (stage S3)
  suppress    follow-up suppression for COVER weeks (stage S2)
  window      rescoring window in days, 56 (default) or 28
"""

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from anomaly.methods import CLIP, RISKY_WHEN_LOW, ExtendedIsolationForestMethod, Rules
from services import scoring_service as service

K = 3
WEEKS_PER_TERM = 13
COVER = 4
SIX_TYPES = ["backdated_bulk_entry", "consumption_drift", "ghost_learners", "inflated_headcount",
             "round_number_entry", "stock_leakage"]
FEATS15 = list(ExtendedIsolationForestMethod().features)
DENSE = ["fed_vs_own", "fed_vs_peers", "uptake", "cereal_ratio", "pulse_ratio", "usage_trend",
         "round_share", "fed_steadiness", "after_hours_share"]
SPARSE = {"count_gap_change": "low", "entry_delay": "high", "entry_batch": "high", "enrolment_change": "high"}
TEMPORAL_BASE = ["fed_vs_own", "fed_vs_peers", "cereal_ratio"]
SUMMED_SHORTFALL_DAYS = 20
CUSUM_K = 0.5


# -- features built inside a scoring ------------------------------------------------------

def _per_school(frame, fn):
    out = pd.Series(np.nan, index=frame.index)
    for _, g in frame.sort_values(["school_id", "date"]).groupby("school_id", sort=False):
        out.loc[g.index] = fn(g)
    return out


def add_extras(frame, hist, extras):
    """Temporal features from this scoring's own records, each row from its own and earlier
    days only. Scales come from the training rows (hist)."""
    f = frame.copy()
    for name in extras:
        if name.startswith("cusum_"):
            col = name[len("cusum_"):]
            q75, q25 = np.percentile(hist[col], [75, 25])
            scale = max((q75 - q25) / 1.349, 1e-6)

            def cusum(g, col=col, scale=scale):
                c, out = 0.0, []
                for z in g[col].to_numpy() / scale:
                    c = max(0.0, c + z - CUSUM_K)
                    out.append(c)
                return np.array(out)
            f[name] = _per_school(f, cusum)
        elif name.startswith("mean"):
            n, col = name[len("mean"):].split("_", 1)
            f[name] = _per_school(f, lambda g, col=col, n=int(n): g[col].rolling(n, min_periods=1).mean().to_numpy())
        elif name in ("fed_vs_peers_trend", "fed_rate_vs_last_term_trend"):
            col = name[: -len("_trend")]
            f[name] = _per_school(f, lambda g, col=col: g[col].rolling(10, min_periods=3).mean().fillna(0.0).to_numpy())
    return f


def summed_gap(frame):
    """Per row: the sum of the store-count gaps (days of food) at this school's counts in the
    last SUMMED_SHORTFALL_DAYS school days, this day included."""
    def one(g):
        di = g.day_index.to_numpy()
        gap = g.count_gap_change.to_numpy()
        cs = np.concatenate([[0.0], np.cumsum(gap)])
        lo = np.searchsorted(di, di - SUMMED_SHORTFALL_DAYS + 1, side="left")
        return cs[np.arange(len(di)) + 1] - cs[lo]
    return _per_school(frame, one)


# -- models -------------------------------------------------------------------------------

class Forest(ExtendedIsolationForestMethod):
    """Version 11's forest with the stage settings: features, sample size, and features
    scored in both directions."""

    def __init__(self, features, sample=1024, two_sided=(), **kw):
        super().__init__(**kw)
        self.features = list(features)
        self.SAMPLE = sample
        self.two_sided = frozenset(two_sided)

    def _x(self, frame):
        x = np.clip(self.scaler_.transform(frame[self.features]), -CLIP, CLIP)
        if self.one_sided:
            low = np.array([f in RISKY_WHEN_LOW for f in self.features])
            both = np.array([f in self.two_sided for f in self.features])
            x = np.where(both, x, np.where(low, np.minimum(x, 0.0), np.maximum(x, 0.0)))
        return x


def _tail_score(train_values, values):
    """-log10 of the share of training values at least as high (one-sided), with values
    beyond the training maximum ordered by how far beyond."""
    t = np.sort(np.asarray(train_values, dtype=float))
    n = len(t)
    at_least = n - np.searchsorted(t, values, side="left")
    score = -np.log10((1 + at_least) / (n + 1))
    top = t[-1] if n else 0.0
    beyond = np.where((values > top) & (np.abs(top) > 1e-9), np.log1p(np.maximum(values / max(abs(top), 1e-9) - 1, 0)), 0.0)
    beyond = np.where((values > top) & (np.abs(top) <= 1e-9), np.log1p(np.maximum(values, 0)), beyond)
    return score + 1e-3 * beyond


class Split:
    """Stage M2: a forest on the continuous features and tail scores for the sparse ones,
    both as -log10 of the training tail share; a day scores the larger."""

    def __init__(self, model_seed, trees=300, ndim=2, dense=DENSE, sparse=SPARSE):
        self.forest = Forest(dense, n_estimators=trees, ndim=ndim, one_sided=True, random_state=model_seed)
        self.sparse = dict(sparse)

    def _sparse_values(self, frame, f):
        v = frame[f].to_numpy(dtype=float)
        return -v if self.sparse[f] == "low" else v

    def fit(self, train):
        self.forest.fit(train)
        self.dense_train_ = self.forest.score(train)
        self.sparse_train_ = {f: self._sparse_values(train, f) for f in self.sparse}
        return self

    def score(self, frame):
        dense = _tail_score(self.dense_train_, self.forest.score(frame))
        sparse = np.max([_tail_score(self.sparse_train_[f], self._sparse_values(frame, f)) for f in self.sparse], axis=0)
        return np.maximum(dense, sparse)


def make_model(cfg, model_seed):
    drop = set(cfg.get("drop", []))
    extras = list(cfg.get("extras", []))
    if cfg.get("model", "eif") == "split":
        dense = [f for f in DENSE if f not in drop] + extras
        sparse = {f: d for f, d in SPARSE.items() if f not in drop}
        return Split(model_seed, trees=cfg.get("trees", 300), ndim=cfg.get("ndim", 2), dense=dense, sparse=sparse)
    feats = [f for f in cfg.get("features", FEATS15) if f not in drop] + extras
    return Forest(feats, sample=cfg.get("sample", 1024), two_sided=cfg.get("two_sided", ()),
                  n_estimators=cfg.get("trees", 300), ndim=cfg.get("ndim", 2), one_sided=cfg.get("one_sided", True),
                  scale_floor=cfg.get("scale_floor", False), random_state=model_seed)


def weekly(rows, how):
    g = rows.groupby(["school_id", "week"]).score
    if how == "mean":
        return g.mean()
    if how == "top1":
        return g.max()
    r = rows[["school_id", "week", "score"]].sort_values("score", ascending=False)
    return r.groupby(["school_id", "week"]).head(2).groupby(["school_id", "week"]).score.mean()


def _week_ordinal(monday):
    return pd.Timestamp(monday).toordinal() // 7


# -- the loop -----------------------------------------------------------------------------

def run_dataset(data_dir, cache_root, cfg, qs, model_seed=1, loop_start="2025-07-07", start="2026-01-01",
                end="2026-12-31", calendar_for=None, read=None):
    """Every q of the grid for one dataset: listings per scoring, with each q's own follow-up
    (and suppression) history. Fits are shared between q values when their follow-up weeks
    inside the window agree."""
    labels = read(data_dir, "labels", parse_dates=["date"])
    labelled = set(zip(labels.school_id, labels.date.dt.strftime("%G-%V")))
    window = cfg.get("window", 56)
    agg = cfg.get("agg", "top2")
    extras = list(cfg.get("extras", []))
    short_mode = cfg.get("shortfall", True)
    suppress = cfg.get("suppress", False)
    cover = cfg.get("cover", COVER)
    rows = {q: [] for q in qs}
    for sc in sorted(read(data_dir, "schools").sub_county.unique()):
        path = Path(cache_root) / Path(data_dir).parent.name / Path(data_dir).name / f"point_in_time_{sc}.pkl"
        scorings = pickle.loads(path.read_bytes())
        fits = {}
        follow = {q: set() for q in qs}
        confirmed = {q: {} for q in qs}        # school -> week ordinals of confirmed listings
        for (monday, moment) in sorted(scorings, key=lambda k: (k[1], k[0])):
            mon = pd.Timestamp(monday)
            if not (pd.Timestamp(loop_start) <= mon <= pd.Timestamp(end)):
                continue
            if (pd.Timestamp(moment) - (mon + pd.Timedelta(days=6))).days > window:
                continue
            frame, cal_start = scorings[(monday, moment)]
            in_week = (frame.date >= mon) & (frame.date <= mon + pd.Timedelta(days=6))
            if not in_week.any():
                continue
            wk = mon.strftime("%G-%V")
            wo = _week_ordinal(mon)
            measured = mon >= pd.Timestamp(start)
            week = frame[in_week]
            first = int(week.day_index.min())
            anchor = first - first % service.REFIT_EVERY
            hist = frame[(frame.day_index < anchor) & (frame.day_index >= anchor - service.WINDOW)]

            def open_case(q, school):
                return suppress and any(wo - cover <= o < wo for o in confirmed[q].get(school, ()))

            if hist.day_index.nunique() < service.MIN_HISTORY:
                cal = calendar_for(data_dir, cal_start)
                for q in qs:
                    res = service.rank_week(frame, cal, monday, k=K, follow_up=follow[q], config=dict(service.CONFIG),
                                            model_seed=model_seed, cache=None, explain=False)
                    for it in res["items"]:
                        listed = bool(it["listed"]) and not open_case(q, it["school_id"])
                        if measured:
                            rows[q].append((sc, wk, it["school_id"], moment, it["score"], listed, False))
                        if listed and (it["school_id"], wk) in labelled:
                            follow[q].add((it["school_id"], wk))
                            confirmed[q].setdefault(it["school_id"], set()).add(wo)
                continue
            if extras:
                frame = add_extras(frame, hist, extras)
                week = frame[in_week]
                hist = frame.loc[hist.index]
            if short_mode:
                gaps = week.count_gap_change
                short = set(week[gaps < -service.STORE_SHORTFALL_DAYS].school_id)
                if short_mode == "summed":
                    counted = week[gaps != 0]
                    if len(counted):
                        total = summed_gap(frame).loc[counted.index]
                        short |= set(counted[total < -service.STORE_SHORTFALL_DAYS].school_id)
            else:
                short = set()
            refit = int(anchor)
            hw = set(hist.week)
            week_scores = {}
            for q in qs:
                key = (refit, tuple(sorted(f for f in follow[q] if f[1] in hw)))
                if key not in fits:
                    keep = np.array([(s, w) not in follow[q] for s, w in zip(hist.school_id, hist.week)], dtype=bool)
                    hh = hist[keep]
                    m = make_model(cfg, model_seed).fit(hh)
                    ws = weekly(hh.assign(score=m.score(hh)), agg).to_numpy()
                    fits[key] = (m, ws)
                m, ws = fits[key]
                thr = float(np.quantile(ws, q))
                if key not in week_scores:
                    week_scores[key] = weekly(week.assign(score=m.score(week)), agg).droplevel("week")
                s = week_scores[key]
                eligible = [x for x in s.index if not open_case(q, x)]
                order = sorted(eligible, key=lambda x: (x not in short, -s[x]))
                listed = {x for x in order[:K] if x in short or s[x] > thr}
                if measured:
                    for x in s.index:
                        rows[q].append((sc, wk, x, moment, float(s[x]), x in listed, x in listed and x in short))
                for x in listed:
                    if (x, wk) in labelled:
                        follow[q].add((x, wk))
                        confirmed[q].setdefault(x, set()).add(wo)
    return {q: pd.DataFrame(rows[q], columns=["sub_county", "week", "school_id", "moment", "score", "listed", "by_shortfall"])
            for q in qs}


# -- measures -----------------------------------------------------------------------------

def collapse(scorings, universe):
    s = scorings.sort_values("moment")
    keys = ["sub_county", "week", "school_id"]
    last = s.groupby(keys).score.last()
    listed = s[s.listed].groupby(keys).moment.min().rename("listed_on")
    by_short = s[s.listed].groupby(keys).by_shortfall.any().rename("by_shortfall")
    w = universe.join(last, on=keys).join(listed, on=keys).join(by_short, on=keys)
    w["listed"] = w.listed_on.notna()
    w["by_shortfall"] = w.by_shortfall.fillna(False).astype(bool)
    w["scored"] = w.score.notna()
    w["score"] = w.score.fillna(w.score.min() - 1 if w.score.notna().any() else 0)
    return w


def _ordinal(week):
    return pd.Timestamp.fromisocalendar(int(week[:4]), int(week[5:]), 1).toordinal() // 7


def measures(w, eps, schools, cover=COVER):
    """Every measure of the protocol for one run (collapsed school-weeks w, episodes eps)."""
    listed = w[w.listed]
    officer_weeks = w.groupby(["sub_county", "week"]).ngroups
    p_at = float(listed.anomalous.mean()) if len(listed) else np.nan
    problems = w[w.anomalous]
    r_at = float(problems.listed.mean()) if len(problems) else np.nan
    f1 = lambda p, r: 2 * p * r / (p + r) if p and r and (p + r) > 0 else 0.0
    # visits: listings that are not repeats of a confirmed listing in the previous cover weeks
    w = w.assign(o=w.week.map(_ordinal))
    visits, covered = [], set()
    for school, g in w.sort_values("o").groupby("school_id"):
        conf = []
        for r in g.itertuples():
            prior = any(r.o - cover <= c < r.o for c in conf)
            if r.listed and not prior:
                visits.append(bool(r.anomalous))
            if r.anomalous and (r.listed or prior):
                covered.add((r.school_id, r.week))
            if r.listed and r.anomalous:
                conf.append(r.o)
    six = eps[eps.type.isin(SIX_TYPES)]
    one = eps[eps.type == "one_day_claim"]
    pp = float(np.mean(visits)) if visits else np.nan
    rp = float(six.caught.mean()) if len(six) else np.nan
    days = pd.to_numeric(six.days_to_catch, errors="coerce")
    within = [average_precision_score(g.anomalous, g.score) for _, g in w.groupby("sub_county") if g.anomalous.any()]
    out = {
        "problem_f1": f1(pp, rp), "problem_precision": pp, "problem_recall": rp,
        "one_day_claims_caught": float(one.caught.mean()) if len(one) else np.nan,
        "f1_at_k": f1(p_at, r_at), "precision_at_k": p_at, "recall_at_k": r_at,
        "recall_at_k_covered": len(covered) / len(problems) if len(problems) else np.nan,
        "pr_auc": float(average_precision_score(w.anomalous, w.score)) if w.anomalous.any() else np.nan,
        "pr_auc_within_sub_county": float(np.mean(within)) if within else np.nan,
        "false_listings_per_officer_term": float((~listed.anomalous).sum() / officer_weeks * WEEKS_PER_TERM),
        "false_from_shortfall_per_officer_term": float((listed.by_shortfall & ~listed.anomalous).sum() / officer_weeks * WEEKS_PER_TERM),
        "visits_per_officer_term": len(visits) / officer_weeks * WEEKS_PER_TERM,
        "problems_caught_within_2_weeks": float((six.caught & (days <= 14)).mean()) if len(six) else np.nan,
        "median_days_to_catch": float(days[six.caught].median()) if six.caught.any() else np.nan,
    }
    for t in SIX_TYPES:
        e = eps[eps.type == t]
        out[f"caught_{t}"] = float(e.caught.mean()) if len(e) else np.nan
    # false listings by honest habit and group (realistic generator columns where present)
    cols = [c for c in ("school_id", "programme_type", "estimates_to", "computes_issues", "weekly_enterer", "records_note") if c in schools]
    ordinary = w[~w.anomalous].merge(schools[cols], on="school_id", how="left")
    groups = {"programme_type": ordinary.programme_type}
    for col in ("estimates_to", "computes_issues", "weekly_enterer", "records_note"):
        if col in ordinary:
            groups[col] = ordinary[col].astype(bool) if col != "estimates_to" else ordinary[col] > 0
    for name, gcol in groups.items():
        for value, g in ordinary.groupby(gcol.values):
            out[f"false_rate_{name}_{value}"] = float(g.listed.mean())
    out["false_rate_overall"] = float(ordinary.listed.mean())
    return out
