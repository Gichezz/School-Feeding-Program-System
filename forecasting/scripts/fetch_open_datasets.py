"""
Download the open datasets used by the planning evaluation and verify them.

Both are published under open licences that require attribution, so they are
downloaded on demand instead of being committed. Each file is checked against
the SHA-256 recorded below; a mismatch stops the script, so every result is
computed from exactly the same inputs.

  swedish_guest_attendance/   Daily lunch counts from Swedish public schools,
                              2010-2020 (Eriksson, Malefors, Secondi and
                              Marchetti, 2021). Mendeley Data,
                              doi:10.17632/4zr5dwnbbv.2, licence CC BY-NC 3.0.
  wfp_food_prices_kenya/      WFP retail and wholesale food prices for Kenyan
                              markets, 2006 onwards. Humanitarian Data
                              Exchange, licence CC BY-IGO. Updated monthly, so
                              its hash is recorded on first download instead.

Usage
  python forecasting/scripts/fetch_open_datasets.py
"""

import json
import sys
import urllib.request

from common import RAW_DIR, sha256_of, write_json

MENDELEY = "https://data.mendeley.com/public-files/datasets/4zr5dwnbbv/files/{id}/file_downloaded"
HDX = "https://data.humdata.org/dataset/e0d3fba6-f9a2-45d7-b949-140c455197ff/resource/{id}/download/{name}"

SWEDISH_DIR = RAW_DIR / "swedish_guest_attendance"
WFP_DIR = RAW_DIR / "wfp_food_prices_kenya"
WFP_MANIFEST = WFP_DIR / "manifest.json"

# (file name, Mendeley file id, published SHA-256)
SWEDISH_FILES = [
    ("SchoolData.xlsx", "f3240d64-7642-40fa-b264-b47ff9a0139f",
     "239c10a3276df887e75b1fbc15075c9a7b57c7e99f0e38c313e66c68db34420e"),
    ("Holidays.xlsx", "da51240d-5b2c-4021-a8b1-2354accc8718",
     "7d1254b05e180b97027bf8d1e29d57552897204225114e73504749f20d4ff725"),
    ("KitchenInformation.xlsx", "2a4c1032-d219-4872-9362-6ba2e7581508",
     "1d01347ecbd88da36956c9e238f5f5dc1c9696f6081596ef486d37e1cf04feb4"),
    ("PreschoolData.xlsx", "160167d6-b857-4cb6-bcd0-9049b8f0bd28",
     "123bf9e450903898fcd7c8748d66f6ac86be359e6431c09598d556dd938cd8a1"),
]

WFP_FILES = [
    ("wfp_food_prices_ken.csv", "517ee1bf-2437-4f8c-aa1b-cb9925b9d437"),
    ("wfp_markets_ken.csv", "fde6f6c7-9776-4b52-a826-d77f9d3f6688"),
]


def download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, open(tmp, "wb") as f:
        while chunk := response.read(1 << 16):
            f.write(chunk)
    tmp.replace(path)


def fetch_swedish():
    for name, file_id, expected in SWEDISH_FILES:
        path = SWEDISH_DIR / name
        if not path.exists():
            print(f"Downloading {name}")
            download(MENDELEY.format(id=file_id), path)
        actual = sha256_of(path)
        if actual != expected:
            sys.exit(f"ERROR: {path} has SHA-256 {actual}, expected {expected}. "
                     "Delete the file and run the script again.")
        print(f"OK  {name}")


def fetch_wfp():
    # WFP publishes a new month of prices regularly, so the first download is
    # pinned: later runs reuse it and check it against the recorded hash.
    manifest = {}
    if WFP_MANIFEST.exists():
        manifest = json.loads(WFP_MANIFEST.read_text(encoding="utf-8"))
    for name, resource_id in WFP_FILES:
        path = WFP_DIR / name
        if not path.exists():
            print(f"Downloading {name}")
            download(HDX.format(id=resource_id, name=name), path)
        actual = sha256_of(path)
        expected = manifest.get(name)
        if expected and actual != expected:
            sys.exit(f"ERROR: {path} has SHA-256 {actual}, expected {expected} (see {WFP_MANIFEST}).")
        manifest[name] = actual
        print(f"OK  {name}")
    write_json(WFP_MANIFEST, manifest)


if __name__ == "__main__":
    fetch_swedish()
    fetch_wfp()
