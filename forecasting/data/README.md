# forecasting/data

| Folder | Contents | Written by |
|---|---|---|
| `raw/` | Original downloaded files. **Never modified.** | You (manual download) |
| `processed/` | US reference aggregate/profile (`source_type = transformed`) and the synthetic Kenyan school dataset (`source_type = synthetic`) | `scripts/inspect_us_dataset.py`, `scripts/generate_synthetic_dataset.py` |
| `reports/` | Inspection, validation and data-quality reports | `scripts/*.py` |

The synthetic dataset represents **one simulated Kenyan school** under the assumptions in `../config/synthetic_kenya_school.yaml`. It is not observed data. Full documentation: [`docs/synthetic-dataset.md`](../../docs/synthetic-dataset.md).
