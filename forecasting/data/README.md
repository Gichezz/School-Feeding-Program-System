# forecasting/data

| Folder | Contents | Written by |
|---|---|---|
| `raw/` | Open datasets, downloaded and checked against their recorded hashes. **Never modified.** | `scripts/fetch_open_datasets.py` |
| `processed/` | Generated synthetic feeding datasets and evaluation caches (not committed) | `scripts/generate_feeding_dataset.py`, `scripts/generate_feeding_dataset_realistic.py`, the evaluation scripts |
| `reports/anomaly/` | Every anomaly-monitoring evaluation, one folder per protocol version | `scripts/run_anomaly_v*.py` and the other evaluation scripts |
| `reports/swedish/` | The demand-forecasting evaluation on real Swedish school canteens, the evidence for dropping forecasting | the retired forecasting code, kept at the git tag `forecasting-archive` |

The data is synthetic. It is not observed data from Kenyan schools. See
[`docs/synthetic-dataset.md`](../../docs/synthetic-dataset.md).
