"""Chargement des solutions du GA original de l'ENAC (Zenodo 10.5281/zenodo.7437654, CC BY 4.0)."""
import hashlib
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from .conflict import DATA_DIR, evaluate

ZIP_URL = "https://zenodo.org/records/7437654/files/GA_Scenario_Solution_Dataset.zip?download=1"
ZIP_MD5 = "e0997d1839f8c9ce80dc7099be32bbd7"
ZEN_DIR = DATA_DIR / "zenodo"


def fetch(dest=ZEN_DIR):
    """Télécharge et extrait le jeu de solutions (49 Mo), après vérification du md5 et des chemins du zip."""
    dest.mkdir(parents=True, exist_ok=True)
    zpath = dest / "GA_Scenario_Solution_Dataset.zip"
    if not zpath.exists():
        urllib.request.urlretrieve(ZIP_URL, zpath)
    if hashlib.md5(zpath.read_bytes()).hexdigest() != ZIP_MD5:
        zpath.unlink()
        raise RuntimeError("md5 inattendu pour le zip Zenodo")
    root = dest.resolve()
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if not (root / name).resolve().is_relative_to(root):
                raise RuntimeError(f"chemin suspect dans le zip : {name}")
        z.extractall(dest)
    return dest


def available(k):
    return (ZEN_DIR / f"sols{k}-1.csv").exists()


def load_run(scn, k):
    """Retourne (genes (N,A,3), fitness_orig, dmin_orig, generation, best_genes) du GA original pour le scénario k."""
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
    """Meilleure solution du GA original de l'ENAC pour le scénario k (dernière génération de `sol{k}-1.csv`), (A, 3), ou None si non téléchargée."""
    path = ZEN_DIR / f"sol{k}-1.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path, usecols=["i", "t1", "t2", "alpha"])
    a = int(df["i"].max()) + 1
    return df[["t1", "t2", "alpha"]].to_numpy(float).reshape(-1, a, 3)[-1]
