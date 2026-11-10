"""Load original ENAC GA solutions (Zenodo 10.5281/zenodo.7437654, CC BY 4.0)."""
import hashlib
import re
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .conflict import DATA_DIR, evaluate

ZIP_URL = "https://zenodo.org/records/7437654/files/GA_Scenario_Solution_Dataset.zip?download=1"
ZIP_MD5 = "e0997d1839f8c9ce80dc7099be32bbd7"
ZEN_DIR = DATA_DIR / "zenodo"


def parse_trajectory(value):
    """Read ENAC's [(x;y)(x;y)...] syntax without evaluating document content."""
    token = r"\(([^;()]+);([^;()]+)\)"
    if not isinstance(value, str) or not value.startswith("[") or not value.endswith("]"):
        raise ValueError("Invalid ENAC trajectory")
    body = value[1:-1]
    if re.sub(token, "", body).strip():
        raise ValueError("Invalid ENAC trajectory content")
    xy = np.array(re.findall(token, body), dtype=float)
    if xy.ndim != 2 or xy.shape[0] < 2 or xy.shape[1] != 2 or not np.isfinite(xy).all():
        raise ValueError("ENAC trajectory requires at least two finite points")
    if (np.linalg.norm(np.diff(xy, axis=0), axis=1) == 0).any():
        raise ValueError("ENAC trajectory contains a zero-length segment")
    return xy


def fetch(dest=ZEN_DIR):
    """Download and extract the solution dataset (49 MB), after checking its MD5 hash and ZIP paths."""
    dest.mkdir(parents=True, exist_ok=True)
    zpath = dest / "GA_Scenario_Solution_Dataset.zip"
    if not zpath.exists():
        urllib.request.urlretrieve(ZIP_URL, zpath)
    if hashlib.md5(zpath.read_bytes()).hexdigest() != ZIP_MD5:
        zpath.unlink()
        raise RuntimeError("Unexpected MD5 hash for the Zenodo ZIP file")
    root = dest.resolve()
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if not (root / name).resolve().is_relative_to(root):
                raise RuntimeError(f"Suspicious path in ZIP file: {name}")
        z.extractall(dest)
    return dest


def available(k):
    return (ZEN_DIR / f"sols{k}-1.csv").exists()


def load_run(scn, k):
    """Return (genes (N,A,3), fitness_orig, dmin_orig, generation, best_genes) from the original GA for scenario k."""
    def read(name):
        df = pd.read_csv(ZEN_DIR / name, usecols=["generation", "id", "fitness", "dmin", "i", "t1", "t2", "alpha"])
        a = int(df["i"].max()) + 1
        g = df.iloc[::a]
        genes = df[["t1", "t2", "alpha"]].to_numpy(float).reshape(-1, a, 3)
        return genes, g["fitness"].to_numpy(), g["dmin"].to_numpy(), g["generation"].to_numpy()

    genes, fit, dmin, gen = read(f"sols{k}-1.csv")
    best, *_ = read(f"sol{k}-1.csv")
    return genes, fit, dmin, gen, best[-1]


def pair_dmin(scn, genes):
    return np.array([evaluate(scn, g).pair_dmin for g in genes])


def best_solution(k):
    """Best original ENAC GA solution for scenario k (last generation of `sol{k}-1.csv`), shape (A, 3), or None if not downloaded."""
    path = ZEN_DIR / f"sol{k}-1.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path, usecols=["i", "t1", "t2", "alpha"])
    a = int(df["i"].max()) + 1
    return df[["t1", "t2", "alpha"]].to_numpy(float).reshape(-1, a, 3)[-1]
