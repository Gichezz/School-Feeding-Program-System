"""
School-day demand model: recent level x day effects.

    expected eaters on day t = enrolled(t) x level x type_effect(day type of t) x weekday_effect(t)

- `level` is the school's recent participation rate: an exponentially weighted
  average of past days with each day's known effects divided out. On an
  ordinary day the forecast is therefore a smoothed recent average.
- The level is updated robustly: one day can move it by at most a clipped
  amount, so an unusual day nobody flagged (a trip, a half day) does not drag
  the next weeks' forecasts down with it.
- `type_effect` says how a kind of day differs from an ordinary one (first days
  after a break, last days before a break, the first and last days of the
  school year, days with a noted event), learned from the school's own history.
- Effects are medians in log space, shrunk toward the median over all schools
  with weight n / (n + shrinkage) on the school's own n days. A new school with
  little history starts from what is typical and moves to its own pattern as
  days accumulate.
- Prediction intervals come from the empirical quantiles of out-of-sample log
  errors per day type, so a risky kind of day gets a wider range.

Used by scripts/evaluate_swedish_forecasts.py only. On real school data it beat
a moving average by a small margin, which was judged not worth a model in the
system: headcounts are planned with a moving average.
"""

import numpy as np
import pandas as pd

ORDINARY = "ordinary"
DAY_TYPES = [ORDINARY, "first days after a break", "last days before a break",
             "first day of school year", "last day of school year", "event noted"]


def participation(df):
    """Share of enrolled learners who ate; falls back to counts when enrollment is missing."""
    enrolled = df.enrolled.where(df.enrolled > 0)
    return (df.students / enrolled).fillna(df.students)


def robust_ewm(values, half_life, clip):
    """
    Exponentially weighted level of `values` (log scale), returned as
    (level before each value, level after it). Each update moves the level by
    at most `clip`, so one outlying day has a bounded effect.
    """
    alpha = 1 - 0.5 ** (1 / half_life)
    before = np.full(len(values), np.nan)
    after = np.full(len(values), np.nan)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return before, after
    level = np.median(finite[:5])
    started = False
    for i, v in enumerate(values):
        if started:
            before[i] = level
        if np.isfinite(v):
            level += alpha * np.clip(v - level, -clip, clip)
            started = True
        after[i] = level if started else np.nan
    return before, after


def _shrunk(local_median, local_n, pooled, shrinkage):
    return (local_n * local_median + shrinkage * pooled) / (local_n + shrinkage)


class DayEffectModel:
    def __init__(self, half_life=10, shrinkage=20, clip=0.25, calibration_days=180,
                 quantiles=(0.05, 0.1, 0.5, 0.9, 0.95)):
        self.half_life = half_life
        self.shrinkage = shrinkage
        self.clip = clip
        self.calibration_days = calibration_days
        self.quantiles = tuple(quantiles)

    # -- level ------------------------------------------------------------------

    def _effects_for(self, g):
        c = g.canteen.iloc[0]
        t = g.day_type.map(lambda d: self.type_effects_.get((c, d), self.pooled_type_.get(d, 0.0)))
        w = g.date.dt.dayofweek.map(lambda d: self.dow_effects_.get((c, d), self.pooled_dow_.get(d, 0.0)))
        return t.astype(float), w.astype(float)

    def _levels(self, g):
        """(level before each day, level after it) for one canteen sorted by date."""
        t, w = self._effects_for(g)
        adjusted = (np.log(participation(g)) - t - w).to_numpy(dtype=float)
        before, after = robust_ewm(adjusted, self.half_life, self.clip)
        return pd.Series(before, index=g.index), pd.Series(after, index=g.index)

    # -- fitting ----------------------------------------------------------------

    def _estimate_effects(self, df):
        self.type_effects_, self.dow_effects_ = {}, {}
        self.pooled_type_ = {d: 0.0 for d in DAY_TYPES}
        self.pooled_dow_ = {d: 0.0 for d in range(5)}
        # Two passes: the level depends on the effects and the effects on the level.
        for _ in range(2):
            rows = []
            for _, g in df.groupby("canteen"):
                _, w = self._effects_for(g)
                before, _ = self._levels(g)
                rows.append(pd.DataFrame({"canteen": g.canteen, "day_type": g.day_type,
                                          "dow": g.date.dt.dayofweek,
                                          "x": np.log(participation(g)) - before, "w_eff": w}))
            r = pd.concat(rows).dropna()
            # Type effects: deviation from the level net of the weekday effect,
            # relative to the school's ordinary days
            r["xt"] = r.x - r.w_eff
            r["xt"] -= r.canteen.map(r[r.day_type == ORDINARY].groupby("canteen").xt.median()).fillna(0.0)
            pooled = r.groupby("day_type").xt.median()
            self.pooled_type_ = {d: float(pooled.get(d, 0.0)) for d in DAY_TYPES}
            self.pooled_type_[ORDINARY] = 0.0
            local = r[r.day_type != ORDINARY].groupby(["canteen", "day_type"]).xt.agg(["median", "size"])
            self.type_effects_ = {(c, d): _shrunk(row["median"], row["size"], self.pooled_type_[d], self.shrinkage)
                                  for (c, d), row in local.iterrows()}
            # Weekday effects, from ordinary days only, centred on the school's median
            o = r[r.day_type == ORDINARY].copy()
            o["xw"] = o.x - o.groupby("canteen").x.transform("median")
            pooled_w = o.groupby("dow").xw.median()
            self.pooled_dow_ = {d: float(pooled_w.get(d, 0.0)) for d in range(5)}
            local_w = o.groupby(["canteen", "dow"]).xw.agg(["median", "size"])
            self.dow_effects_ = {(c, d): _shrunk(row["median"], row["size"], self.pooled_dow_[d], self.shrinkage)
                                 for (c, d), row in local_w.iterrows()}

    def fit(self, history):
        """
        Fit on history (columns: canteen, date, students, enrolled, day_type).
        The last `calibration_days` school days are first held out to measure
        out-of-sample errors for the intervals; the effects are then refitted
        on everything.
        """
        history = history.sort_values(["canteen", "date"])
        cut = history.date.drop_duplicates().sort_values().iloc[-self.calibration_days]
        self._estimate_effects(history[history.date < cut])
        calib = self.predict_day_ahead(history)
        calib = calib[calib.date >= cut]
        err = np.log(calib.students) - np.log(calib.forecast)
        self.calibration_errors_ = {}
        for d in DAY_TYPES:
            e = err[calib.day_type == d].values
            # A rare day type with too few calibration days borrows the spread of
            # all non-ordinary days
            if len(e) < 30:
                e = err[calib.day_type != ORDINARY].values
            self.calibration_errors_[d] = np.sort(e)
        self.error_quantiles_ = {d: {q: float(np.quantile(e, q)) for q in self.quantiles}
                                 for d, e in self.calibration_errors_.items()}
        self._estimate_effects(history)
        return self

    # -- prediction -------------------------------------------------------------

    def _expected(self, g, level):
        t, w = self._effects_for(g)
        rate = np.exp(level + t + w)
        enrolled = g.enrolled.where(g.enrolled > 0)
        return (rate * enrolled).fillna(rate)

    def predict_day_ahead(self, df):
        """Forecast each day from all days before it (the cook's view the evening before)."""
        out = []
        for _, g in df.sort_values(["canteen", "date"]).groupby("canteen"):
            before, _ = self._levels(g)
            out.append(g.assign(forecast=self._expected(g, before)))
        return pd.concat(out).dropna(subset=["forecast"])

    def levels_after(self, df):
        """For each canteen and day, the level once that day is known: the origin state for later days."""
        out = []
        for _, g in df.sort_values(["canteen", "date"]).groupby("canteen"):
            _, after = self._levels(g)
            out.append(g.assign(level_after=after))
        return pd.concat(out)

    def expected_given_level(self, rows, level):
        """Point forecasts for `rows` (one canteen or many) from a level per row."""
        level = pd.Series(level, index=rows.index)
        out = [self._expected(g, level[g.index]) for _, g in rows.groupby("canteen", sort=False)]
        return pd.concat(out).reindex(rows.index)

    def quantile(self, forecast, day_type, q):
        """The q-quantile (any q in 0-1) of the number who will eat, given the point forecast."""
        factor = pd.Series(day_type).map(lambda d: np.quantile(self.calibration_errors_[d], q)).values
        return np.asarray(forecast) * np.exp(factor)

    def parameters(self, canteen):
        """The numbers a device needs to forecast for one school."""
        return {
            "half_life_days": self.half_life,
            "level_clip": self.clip,
            "type_effects": {d: float(np.exp(self.type_effects_.get((canteen, d), self.pooled_type_[d])))
                             for d in DAY_TYPES},
            "weekday_effects": {d: float(np.exp(self.dow_effects_.get((canteen, d), self.pooled_dow_[d])))
                                for d in range(5)},
            "error_quantiles": {d: {q: float(np.exp(v)) for q, v in qs.items()}
                                for d, qs in self.error_quantiles_.items()},
        }
