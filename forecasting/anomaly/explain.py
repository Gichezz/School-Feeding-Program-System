"""
Plain-language explanations for flagged school-days.

A flag always says "needs review" and names what looked unusual, in the terms an officer
would check against the school's registers and store book. It never says why it
happened: an unusual record may be a mistake, a real event or a problem.
"""

import math

from .features import RATION_KG

TOP = 2


def _pct(x):
    return f"{abs(x) * 100:.0f}%"


def _points(x):
    return f"{abs(x) * 100:.0f} percentage points"


def _value(row, key):
    """A figure from the school-day's record, or None when it is not there."""
    try:
        value = row[key]
    except (KeyError, IndexError):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(value) else value


def _kg(x):
    return f"{x:,.1f}".rstrip("0").rstrip(".") + " kg"


def describe(feature, row):
    """One sentence about one feature of a school-day, with the figures an officer can check
    against the school's register and store book where the record holds them."""
    if feature in ("fed_rate", "share_fed"):
        return f"{row['learners_fed']} learners fed of {row['learners']} enrolled ({_pct(row['share_fed'])})"
    if feature == "fed_vs_own":
        change = math.exp(row["fed_vs_own"]) - 1
        text = f"learners fed {_pct(change)} {'above' if change > 0 else 'below'} the school's usual number"
        fed = _value(row, "learners_fed")
        if fed is not None:
            usual = (fed + 1) / math.exp(row["fed_vs_own"]) - 1
            text += f" ({fed:.0f}; usually about {usual:.0f})"
        return text
    if feature == "fed_vs_peers":
        diff = row["fed_vs_peers"]
        text = f"a share of learners fed {_points(diff)} {'above' if diff > 0 else 'below'} similar schools nearby that day"
        share, peers = _value(row, "share_fed"), _value(row, "peer_rate")
        if share is not None and peers is not None:
            text += f" ({share * 100:.0f}% of enrolment here; {peers * 100:.0f}% at similar schools)"
        return text
    if feature in ("cereal_ratio", "pulse_ratio"):
        food = "cereals" if feature == "cereal_ratio" else "pulses"
        factor = math.exp(row[feature])
        text = f"{food} issued at {factor:.2f} times the ration for learners fed"
        issued, fed = _value(row, f"{food}_kg"), _value(row, "learners_fed")
        if issued is not None and fed:
            text += f" ({_kg(issued)} for {fed:.0f} learners; ration {_kg(fed * RATION_KG[food])})"
        return text
    if feature == "usage_trend":
        return f"food issued per learner up {_pct(math.exp(row['usage_trend']) - 1)} on the weeks before"
    if feature == "count_gap_change":
        return f"the store count {abs(row['count_gap_change']):.1f} days of food {'short of' if row['count_gap_change'] < 0 else 'above'} the records"
    if feature == "entry_delay":
        return f"entered {row['entry_delay']:.0f} school days after the date"
    if feature == "entry_batch":
        n = int(row["entry_batch"])
        return "entered on its own" if n == 1 else f"{n} dates entered in the same sitting"
    if feature == "round_share":
        return f"round numbers on {row['round_share'] * 100:.0f}% of recent days"
    if feature == "fed_steadiness":
        # The mean day-to-day change in learners fed, as a share
        change = -row["fed_steadiness"]
        if change < 0.02:
            return "almost the same number of learners fed day after day"
        return f"learners fed changing by {change * 100:.0f}% a day on average"
    if feature == "fed_rate_vs_last_term":
        diff = row["fed_rate_vs_last_term"]
        return f"a share of learners fed, for that kind of day, {_points(diff)} {'above' if diff > 0 else 'below'} last term's"
    if feature == "enrolment_change":
        change = math.exp(row["enrolment_change"]) - 1
        before = row["learners"] / math.exp(row["enrolment_change"])
        return f"enrolment {_pct(change)} {'up' if change > 0 else 'down'} on last term ({row['learners']} learners; {before:.0f} last term)"
    if feature == "uptake":
        return f"{row['learners_fed']} learners fed of {row['learners_present']:.0f} present ({_pct(row['uptake'])})"
    if feature == "fed_vs_peers_trend":
        diff = row["fed_vs_peers_trend"]
        return f"over the last 10 school days, a share of learners fed {_points(diff)} {'above' if diff > 0 else 'below'} similar schools nearby"
    if feature.startswith("count_shortfall_"):
        return f"the last store count {row[feature]:.1f} days of food short of the records"
    if feature == "fed_rate_vs_last_term_trend":
        diff = row["fed_rate_vs_last_term_trend"]
        return f"over the last 10 school days, a share of learners fed {_points(diff)} {'above' if diff > 0 else 'below'} last term's"
    if feature == "count_gap_recent":
        gap = row["count_gap_recent"]
        return f"the last store count {abs(gap):.1f} days of food {'short of' if gap < 0 else 'above'} the records"
    if feature == "after_hours_share":
        return f"{row['after_hours_share'] * 100:.0f}% of the school's recent records entered outside school hours"
    return feature.replace("_", " ")


def explain(row, contributions):
    """'Needs review: …' naming the features that raised the score most."""
    top = [f for f, _ in sorted(contributions.items(), key=lambda kv: -kv[1])][:TOP]
    if not top:
        return "Needs review: unusual combination of this day's figures"
    return "Needs review: " + "; ".join(describe(f, row) for f in top)
