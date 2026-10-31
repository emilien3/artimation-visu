"""Générateur de données synthétiques de retard au décollage (42 features).

Les données EUROCONTROL (ETFMS 2019) de l'article sont privées. Ce générateur reproduit leur
structure : infos de base, vol précédent (même appareil), régulations ATFM, météo, calendrier.
Le retard dépend surtout du retard du vol précédent et des régulations ATFM, comme le suggère l'article.
"""
import numpy as np
import pandas as pd

FEATURES = [
    "time_to_eobt", "flight_duration_planned", "distance_km", "hour_of_day", "day_of_week", "month",
    "is_weekend", "is_holiday", "airline_lowcost", "airline_legacy", "airline_charter",
    "aircraft_narrowbody", "aircraft_widebody", "aircraft_regional",
    "prev_leg_delay", "prev_leg_arrival_delay", "turnaround_slack", "prev_leg_taxi_in",
    "atfm_regulation_active", "atfm_regulation_delay", "n_regulations_airport",
    "reg_reason_weather", "reg_reason_capacity", "reg_reason_atc_staff",
    "dep_airport_hourly_departures", "dep_capacity_ratio", "arr_capacity_ratio",
    "dep_wind_speed", "dep_visibility", "dep_cloud_ceiling", "dep_precip_mm", "dep_temperature",
    "dep_thunderstorm", "dep_low_visibility_procedures",
    "arr_wind_speed", "arr_visibility", "arr_thunderstorm",
    "enroute_sector_load", "airline_delayed_pct", "last_hour_avg_delay",
    "runway_config_changes", "curfew_proximity",
]

GROUPS = {
    "Vol": FEATURES[0:14],
    "Vol précédent": FEATURES[14:18],
    "Régulation ATFM": FEATURES[18:24],
    "Aéroports": FEATURES[24:27] + FEATURES[37:42],
    "Météo": FEATURES[27:37],
}
FEATURE_GROUP = {f: g for g, fs in GROUPS.items() for f in fs}

DESCRIPTIONS = {
    "time_to_eobt": "Minutes restantes avant l'heure de sortie de parking estimée (EOBT)",
    "prev_leg_delay": "Retard au départ du vol précédent du même appareil (min)",
    "prev_leg_arrival_delay": "Retard à l'arrivée du vol précédent (min)",
    "turnaround_slack": "Marge de rotation au sol disponible (min)",
    "atfm_regulation_active": "Une régulation ATFM s'applique au vol (0/1)",
    "atfm_regulation_delay": "Retard imposé par la régulation ATFM (min)",
    "dep_capacity_ratio": "Charge / capacité de l'aéroport de départ",
    "dep_visibility": "Visibilité au départ (km)",
    "dep_thunderstorm": "Orage au départ (0/1)",
    "last_hour_avg_delay": "Retard moyen des départs de la dernière heure (min)",
    "airline_delayed_pct": "% de vols de la compagnie en retard",
    "enroute_sector_load": "Charge des secteurs en route",
}


def generate(n: int, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    b = lambda p: (rng.random(n) < p).astype(float)
    d = {}
    d["time_to_eobt"] = rng.uniform(0, 360, n)
    d["distance_km"] = rng.gamma(3.0, 450, n).clip(150, 6000)
    d["flight_duration_planned"] = 25 + d["distance_km"] / 13 + rng.normal(0, 6, n)
    d["hour_of_day"] = rng.choice(24, n, p=_hour_profile())
    d["day_of_week"] = rng.integers(0, 7, n)
    d["month"] = rng.integers(5, 11, n)
    d["is_weekend"] = (d["day_of_week"] >= 5).astype(float)
    d["is_holiday"] = b(0.04)
    airline = rng.choice(3, n, p=[0.35, 0.5, 0.15])
    d["airline_lowcost"], d["airline_legacy"], d["airline_charter"] = [(airline == i).astype(float) for i in range(3)]
    ac = np.where(d["distance_km"] > 3500, rng.choice(3, n, p=[0.2, 0.75, 0.05]), rng.choice(3, n, p=[0.7, 0.05, 0.25]))
    d["aircraft_narrowbody"], d["aircraft_widebody"], d["aircraft_regional"] = [(ac == i).astype(float) for i in range(3)]

    storm_dep = b(0.05)
    d["dep_thunderstorm"] = storm_dep
    d["dep_visibility"] = np.where(rng.random(n) < 0.12, rng.uniform(0.3, 3, n), rng.uniform(6, 10, n))
    d["dep_low_visibility_procedures"] = (d["dep_visibility"] < 1.5).astype(float)
    d["dep_wind_speed"] = rng.gamma(2.5, 4, n) + 12 * storm_dep
    d["dep_cloud_ceiling"] = rng.gamma(4, 500, n)
    d["dep_precip_mm"] = np.where(rng.random(n) < 0.2, rng.gamma(1.5, 2, n), 0) + 4 * storm_dep
    d["dep_temperature"] = rng.normal(19, 8, n)
    d["arr_wind_speed"] = rng.gamma(2.5, 4, n)
    d["arr_visibility"] = np.where(rng.random(n) < 0.1, rng.uniform(0.3, 3, n), rng.uniform(6, 10, n))
    d["arr_thunderstorm"] = b(0.04)

    peak = np.exp(-((d["hour_of_day"] - 17) ** 2) / 40) + 0.6 * np.exp(-((d["hour_of_day"] - 8) ** 2) / 20)
    d["dep_airport_hourly_departures"] = 18 + 30 * peak + rng.normal(0, 4, n)
    d["dep_capacity_ratio"] = (d["dep_airport_hourly_departures"] / 55 + 0.15 * storm_dep + rng.normal(0, 0.06, n)).clip(0.1, 1.5)
    d["arr_capacity_ratio"] = (0.5 + 0.4 * rng.random(n) + 0.1 * d["arr_thunderstorm"]).clip(0.1, 1.5)
    d["enroute_sector_load"] = (0.4 + 0.4 * peak + rng.normal(0, 0.1, n)).clip(0, 1.4)
    d["runway_config_changes"] = rng.poisson(0.3 + 1.2 * storm_dep + 0.5 * d["dep_low_visibility_procedures"])
    d["curfew_proximity"] = np.where(d["hour_of_day"] >= 21, 24 * 60 - d["hour_of_day"] * 60, 600.0)

    d["prev_leg_delay"] = np.where(rng.random(n) < 0.4, rng.exponential(18, n) * (1 + 0.8 * peak), rng.normal(0, 2, n))
    d["prev_leg_arrival_delay"] = d["prev_leg_delay"] + rng.normal(0, 4, n)
    d["prev_leg_taxi_in"] = rng.gamma(4, 2.2, n)
    d["turnaround_slack"] = rng.gamma(4, 12, n) * (0.6 + 0.8 * d["airline_legacy"]) + 15
    d["airline_delayed_pct"] = (0.2 + 0.25 * peak + 0.1 * d["airline_lowcost"] + rng.normal(0, 0.05, n)).clip(0, 1)
    d["last_hour_avg_delay"] = (3 + 14 * peak + 10 * storm_dep + rng.normal(0, 3, n)).clip(0)

    reg_p = 0.04 + 0.25 * storm_dep + 0.1 * (d["dep_capacity_ratio"] > 0.95) + 0.1 * (d["enroute_sector_load"] > 0.9)
    reg = (rng.random(n) < reg_p).astype(float)
    d["atfm_regulation_active"] = reg
    d["atfm_regulation_delay"] = reg * rng.gamma(2.2, 9, n)
    reason = rng.choice(3, n, p=[0.35, 0.5, 0.15])
    d["reg_reason_weather"], d["reg_reason_capacity"], d["reg_reason_atc_staff"] = [reg * (reason == i) for i in range(3)]
    d["n_regulations_airport"] = rng.poisson(0.2 + 2.0 * reg + 0.8 * storm_dep)

    df = pd.DataFrame(d)[FEATURES]

    absorbed = np.clip(df["prev_leg_delay"] - 0.35 * df["turnaround_slack"], 0, None)  # le retard précédent n'est pas absorbé par la marge
    delay = (
        0.75 * absorbed
        + 0.9 * df["atfm_regulation_delay"]
        + 8 * df["dep_thunderstorm"] + 6 * df["dep_low_visibility_procedures"]
        + 0.35 * np.clip(df["dep_wind_speed"] - 20, 0, None) * 2
        + 14 * np.clip(df["dep_capacity_ratio"] - 0.85, 0, None)
        + 0.18 * df["last_hour_avg_delay"] + 6 * df["airline_delayed_pct"]
        + 2.0 * df["runway_config_changes"]
        + 2.5 * df["is_holiday"] + 1.5 * df["airline_charter"]
        - 3.0 * df["airline_legacy"] - 0.004 * df["time_to_eobt"]
    )
    noise = rng.standard_t(4, n) * (3 + 0.12 * np.abs(delay))  # bruit hétéroscédastique à queues lourdes
    df["delay"] = (delay + noise - 2).clip(-15, 240)
    return df


def _hour_profile():
    h = np.arange(24)
    p = 0.2 + np.exp(-((h - 8) ** 2) / 18) + np.exp(-((h - 17) ** 2) / 24)
    p[:5] *= 0.15
    return p / p.sum()
