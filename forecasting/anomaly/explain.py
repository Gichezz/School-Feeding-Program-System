"""
Plain-language explanations for flagged school-days.

A flag always says "needs review" and names what looked unusual, in the terms an officer
would check against the school's registers and store book. It never says why it
happened: an unusual record may be a mistake, a real event or a problem.
"""

import math

TOP = 2


def _pct(x):
    return f"{abs(x) * 100:.0f}%"


def describe(feature, row):
    """One sentence about one feature of a school-day."""
    if feature == "fed_rate":
        return f"{row['learners_fed']} learners fed of {row['learners']} enrolled ({_pct(row['share_fed'])})"
    if feature == "fed_vs_own":
        change = math.exp(row["fed_vs_own"]) - 1
        return f"learners fed {_pct(change)} {'above' if change > 0 else 'below'} the school's usual number"
    if feature == "fed_vs_peers":
        diff = row["fed_vs_peers"]
        return f"a share of learners fed {_pct(diff)} points {'above' if diff > 0 else 'below'} similar schools nearby that day"
    if feature in ("cereal_ratio", "pulse_ratio"):
        food = "cereals" if feature == "cereal_ratio" else "pulses"
        factor = math.exp(row[feature])
        return f"{food} issued at {factor:.2f} times the ration for learners fed"
    if feature == "usage_trend":
        return f"food issued per learner up {_pct(math.exp(row['usage_trend']) - 1)} on the weeks before"
    if feature == "count_gap_change":
        return f"the store count {abs(row['count_gap_change']):.1f} days of food {'short of' if row['count_gap_change'] < 0 else 'above'} the records"
    if feature == "entry_delay":
        return f"entered {row['entry_delay']:.0f} school days after the date"
    if feature == "batch_dates":
        return f"{row['batch_dates']:.0f} different dates sent together in one sync"
    if feature == "round_share":
        return f"round numbers on {row['round_share'] * 100:.0f}% of recent days"
    if feature == "fed_steadiness":
        return "almost the same number of learners fed day after day"
    if feature == "fed_rate_vs_last_term":
        diff = row["fed_rate_vs_last_term"]
        return f"a share of learners fed {_pct(diff)} points {'above' if diff > 0 else 'below'} last term's"
    if feature == "enrolment_change":
        change = math.exp(row["enrolment_change"]) - 1
        return f"enrolment {_pct(change)} {'up' if change > 0 else 'down'} on last term ({row['learners']} learners)"
    if feature == "uptake":
        return f"{row['learners_fed']} learners fed of {row['learners_present']:.0f} present ({_pct(row['uptake'])})"
    if feature == "after_hours_share":
        return f"{row['after_hours_share'] * 100:.0f}% of the school's recent records entered outside school hours"
    return feature.replace("_", " ")


def explain(row, contributions):
    """'Needs review: …' naming the features that raised the score most."""
    top = [f for f, _ in sorted(contributions.items(), key=lambda kv: -kv[1])][:TOP]
    if not top:
        return "Needs review: unusual combination of this day's figures"
    return "Needs review: " + "; ".join(describe(f, row) for f in top)
