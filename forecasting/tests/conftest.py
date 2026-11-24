"""
Shared test set-up: the forecasting folder is importable, so tests can import the
anomaly package and the scoring service.
"""

import sys
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
