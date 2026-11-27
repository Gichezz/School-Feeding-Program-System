# Feeding record rules: more learners fed than enrolled

A daily feeding record says how many learners were fed. The term's enrolment says how many learners the school has on its admission register. This page explains what the system does when the first is larger than the second, and why the limits are where they are.

## The rule

| Learners fed, against this term's enrolment | On the school device | On the server |
|---|---|---|
| Up to enrolment | Saved normally | Nothing |
| Above enrolment, up to 1.25 times | Saved only with a reason: **New learners, not yet in the enrolment**, or **Other** with a note | Flagged "More learners fed than enrolled" for the programme officer |
| More than 1.25 times | Not saved. The teacher checks the number, or updates the enrolment first | Flagged, if it ever arrives (for example from an older app version) |

Where it lives: `validateFeeding` and `FED_ABOVE_ENROLMENT_LIMIT` in [`frontend/src/features/feeding/planning.js`](../frontend/src/features/feeding/planning.js); the reason code in [`backend/src/validation/records.js`](../backend/src/validation/records.js) and migration `023_new_learners_reason.sql`; the flag in [`backend/src/services/recordChecks.js`](../backend/src/services/recordChecks.js).

## When can more learners be fed than enrolled?

In a Kenyan public school it happens, but rarely and by a small margin:

1. **Learners who joined after the enrolment was recorded.** Enrolment is entered once a term from the admission register; admissions and transfers continue during the term.
2. **Drought.** School meals draw children back to school in dry spells, sometimes before they are on the register.
3. **Classes left out of the enrolment**, such as pre-primary learners who are fed but were not entered. This is an enrolment error, and the fix is the enrolment.
4. **A wrong enrolment figure**: a typing mistake, or last term's figure not updated.

Teachers, cooks and visitors eating are not learners fed, so "Visitors fed too" does not explain the excess.

Every legitimate case has a cause the teacher knows. None of them makes learners fed several times the enrolment.

## Why a reason for *any* excess, not above a margin such as 10%

A margin (warn above enrolment, ask for a reason only above 10%) was considered. It was rejected because:

- **No source gives a margin.** No Ministry of Education or programme guidance states how far learners fed may exceed enrolment. A 10% figure would be a guess.
- **The line at enrolment needs no justification.** Enrolment is the school's own register. Above it, by definition, more learners ate than the school has on record.
- **The cost of the rule is one tap.** On a real day with new learners, the teacher chooses "New learners" and saves. It works offline and needs no one else.
- **It matches the rest of the system.** The server's flag and the weekly review's fixed check ("more fed than enrolled", `share_fed > 1.0` in [`forecasting/anomaly/methods.py`](../forecasting/anomaly/methods.py)) already draw the line at enrolment. The phone now asks for the explanation at the same point the officer will be shown it.

## Why the device refuses above 1.25 times enrolment

1. **What 1.25 implies.** Learners fed can't exceed learners present. Typical attendance in Kenyan public primary schools is taken as 85–95% of enrolment, which is the assumption in [`forecasting/config/feeding_dataset.yaml`](../forecasting/config/feeding_dataset.yaml). To feed 1.25 times the registered enrolment, the school must really have at least 1.25 ÷ 0.95 ≈ **1.32 times** as many learners as registered, and nearer 1.47 times at 85% attendance. That is a third or more of the school missing from its register.
2. **The system already treats a quarter as the limit.** The weekly review's fixed check lists a school whose enrolment rises by more than a quarter in a term (`enrolment_change > log(1.25)` in `methods.py`). A gap between feeding and enrolment that is wider than that is beyond what the system lets pass without a person checking it.
3. **Refusing doesn't lose a real day.** If the number is right, the enrolment is wrong. The teacher updates it on the same device, offline, with a reason (admission, transfer or correction), then saves the day. The enrolment update goes to the programme officer, who verifies it against the admission register. The food request keeps using the last *verified* enrolment until then. So a real surge is recorded, and an inflated one is pushed into the one path a person verifies.
4. **What a refusal catches.** Typing mistakes (900 for 390), and inflated headcounts large enough to matter.

## Limits and honesty

- **The 85–95% attendance figure is an assumption, not a measured national rate.** No official daily attendance rate was found. Even at 100% attendance, 1.25 times enrolment still means a quarter of the learners missing from the register.
- **1.25 is a setting.** It is one constant, `FED_ABOVE_ENROLMENT_LIMIT`. With real school records, the right value would come from how far learners fed actually exceeds the enrolment recorded at the start of term.
- **The synthetic evaluation dataset can't test this rule.** Its generator never records more learners fed than enrolled. The rule is checked by unit tests instead.
- **The checks use what the device knows.** If another device raised the enrolment and has not synced yet, this device may ask for a reason or refuse. Updating the enrolment here resolves it. The server never rejects a synced record over enrolment: it flags it, because the device may have been right about what it knew.
