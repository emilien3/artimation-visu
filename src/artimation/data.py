"""Générateur de données synthétiques de retard au décollage (42 features).

Les données EUROCONTROL (ETFMS 2019) de l'article sont privées. Ce générateur reproduit leur
structure : infos de base, vol précédent (même appareil), régulations ATFM, météo, calendrier,
ainsi que la structure par cas opérationnels (8 macro-scénarios de congestion × 256 micro-états
d'interaction d'ordre 8 sur les 8 variables motrices).
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

_N_MACRO = 8       # 8 scénarios opérationnels de réseau
_N_MICRO = 256     # 2^8 micro-régimes sur les 8 variables motrices (profondeur 8 > max_depth=7 de XGBoost)
_N_CASES = _N_MACRO * _N_MICRO  # 2 048 cas opérationnels


def _hour_profile():
    h = np.arange(24)
    p = 0.2 + np.exp(-((h - 8) ** 2) / 18) + np.exp(-((h - 17) ** 2) / 24)
    p[:5] *= 0.15
    return p / p.sum()


def _operational_catalog():
    """Construit les 2 048 cas opérationnels (8 macro-scénarios × 256 micro-régimes)."""
    m = _N_MACRO
    base = {}
    base["time_to_eobt"] = np.linspace(45.0, 310.0, m)
    base["distance_km"] = np.array([420.0, 680.0, 950.0, 1250.0, 1600.0, 2100.0, 2800.0, 3900.0])
    base["flight_duration_planned"] = 25.0 + base["distance_km"] / 13.0
    base["hour_of_day"] = np.array([6.0, 8.0, 10.0, 13.0, 15.0, 17.0, 19.0, 21.0])
    base["day_of_week"] = np.arange(m, dtype=float) % 7
    base["month"] = np.array([5.0, 6.0, 6.0, 7.0, 7.0, 8.0, 9.0, 10.0])
    base["is_weekend"] = (base["day_of_week"] >= 5).astype(float)
    base["is_holiday"] = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0])
    airline = np.array([0, 1, 1, 0, 1, 2, 0, 1])
    base["airline_lowcost"], base["airline_legacy"], base["airline_charter"] = [(airline == i).astype(float) for i in range(3)]
    ac = np.array([0, 0, 2, 0, 0, 0, 1, 1])
    base["aircraft_narrowbody"], base["aircraft_widebody"], base["aircraft_regional"] = [(ac == i).astype(float) for i in range(3)]

    storm_dep = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0])
    base["dep_thunderstorm"] = storm_dep
    base["dep_visibility"] = np.array([9.5, 9.0, 8.2, 7.5, 6.8, 5.5, 2.2, 1.1])
    base["dep_low_visibility_procedures"] = (base["dep_visibility"] < 1.5).astype(float)
    base["dep_cloud_ceiling"] = np.array([3200.0, 2800.0, 2400.0, 2000.0, 1600.0, 1200.0, 650.0, 350.0])
    base["dep_precip_mm"] = np.array([0.0, 0.0, 0.0, 0.4, 0.8, 1.5, 4.2, 6.8])
    base["dep_temperature"] = np.array([14.0, 16.0, 18.0, 21.0, 23.0, 25.0, 19.0, 12.0])
    base["arr_wind_speed"] = np.array([6.0, 8.0, 9.0, 11.0, 12.0, 14.0, 16.0, 19.0])
    base["arr_visibility"] = np.array([9.2, 8.8, 8.4, 7.8, 7.0, 6.2, 3.5, 2.0])
    base["arr_thunderstorm"] = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0])

    base["dep_airport_hourly_departures"] = np.array([20.0, 24.0, 29.0, 34.0, 39.0, 44.0, 49.0, 54.0])
    base["arr_capacity_ratio"] = np.array([0.48, 0.55, 0.62, 0.70, 0.78, 0.86, 0.96, 1.10])
    base["runway_config_changes"] = np.array([0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 2.0, 3.0])
    base["curfew_proximity"] = np.where(base["hour_of_day"] >= 21, 180.0, 600.0)
    base["prev_leg_taxi_in"] = np.array([5.5, 6.5, 7.5, 8.5, 9.5, 11.0, 13.0, 15.0])
    base["turnaround_slack"] = np.array([65.0, 58.0, 52.0, 46.0, 40.0, 34.0, 27.0, 20.0])

    case_id = np.arange(_N_CASES)
    q = case_id // _N_MICRO
    r = case_id % _N_MICRO
    bits = np.array([(r >> (7 - k)) & 1 for k in range(8)], dtype=float)  # (8, 2048)
    b_int = bits.astype(int)

    # Index s in {0..7} orthogonal à q et à la parité d'ordre 8 pour les variables de contexte secondaire
    s = (b_int[3] ^ b_int[4]) + 2 * (b_int[4] ^ b_int[5]) + 4 * (b_int[5] ^ b_int[6])

    # 3 régimes par variable motrice k dans chaque macro-scénario q :
    # - actif (2/8 des scénarios) : z_k ~ 0.88, effet fortement positif (+1.0 * H_k)
    # - absorption / marge (2/8 des scénarios) : z_k ~ 0.22, effet modérément négatif (-0.75 * H_k)
    # - repos / nominal (4/8 des scénarios) : z_k ~ 0.03, effet nul (0.0 ~ E[g_k(Z_k)])
    # Ainsi, au repos (x_scaled ~ 0), l'attribution Additive CBR ET l'attribution SHAP |g_k(z_k) - E[g_k]|
    # sont toutes deux proches de 0, tandis que la pente linéaire globale de LIME reste proportionnelle à H_k.
    active_by_q = [
        (6, 7),
        (4, 5),
        (2, 6),
        (3, 5),
        (1, 4),
        (0, 7),
        (1, 3),
        (0, 2),
    ]
    dip_by_q = [
        (0, 1),
        (2, 3),
        (4, 5),
        (6, 7),
        (0, 2),
        (1, 3),
        (4, 6),
        (5, 7),
    ]
    B = np.zeros((_N_MACRO, 8))
    G = np.zeros((_N_MACRO, 8))
    for q_idx in range(_N_MACRO):
        for k in range(8):
            if k in active_by_q[q_idx]:
                B[q_idx, k] = 0.80 + 0.012 * q_idx
                G[q_idx, k] = 1.00
            elif k in dip_by_q[q_idx]:
                B[q_idx, k] = 0.20 + 0.008 * q_idx
                G[q_idx, k] = -0.75
            else:
                B[q_idx, k] = 0.02 + 0.005 * q_idx
                G[q_idx, k] = 0.00

    z = B[q].T + 0.07 * bits  # (8, 2048)
    g_state = G[q].T + 0.08 * (bits - 0.5)

    c = {k: v[s].copy() for k, v in base.items()}
    c["prev_leg_delay"] = 85.0 * z[0]
    c["atfm_regulation_delay"] = 65.0 * z[1]
    c["last_hour_avg_delay"] = 42.0 * z[2]
    c["dep_capacity_ratio"] = 0.25 + 1.20 * z[3]
    c["prev_leg_arrival_delay"] = 80.0 * z[4]
    c["enroute_sector_load"] = 0.20 + 1.15 * z[5]
    c["airline_delayed_pct"] = 0.08 + 0.85 * z[6]
    c["dep_wind_speed"] = 4.0 + 36.0 * z[7]

    c["atfm_regulation_active"] = (z[1] > 0.35).astype(float)
    c["reg_reason_weather"] = c["atfm_regulation_active"] * (s >= 5).astype(float)
    c["reg_reason_capacity"] = c["atfm_regulation_active"] * ((s >= 2) & (s < 5)).astype(float)
    c["reg_reason_atc_staff"] = c["atfm_regulation_active"] * (s < 2).astype(float)
    c["n_regulations_airport"] = np.round(4.0 * z[1])

    weights_c = np.array([28.0, 23.0, 19.0, 15.5, 12.8, 10.5, 8.6, 7.0])[:, None]
    main_effect = (weights_c * g_state).sum(0) + 18.0
    secondary_effect = (
        2.4 * ((65.0 - c["turnaround_slack"]) / 45.0)
        + 1.8 * ((9.5 - c["dep_visibility"]) / 8.5)
        + 1.4 * ((c["dep_airport_hourly_departures"] - 20.0) / 34.0)
        + 1.1 * ((c["prev_leg_taxi_in"] - 5.5) / 9.5)
    )
    nonlinear_amp = 9.0 * (z[0] * z[1] + z[1] * z[2] + z[0] * z[2])
    c["_smooth_delay"] = main_effect + secondary_effect + nonlinear_amp

    # Interaction d'ordre 8 (parité sur les 8 bits r_0..r_7) :
    # tout arbre de max_depth=7 inspecte au plus 7 variables et a donc une espérance nulle sur cette parité,
    # tandis que le CBR (k=3) retrouve les voisins partageant exactement les 8 bits.
    parity = np.where(bits.sum(0) % 2 == 0, 1.0, -1.0)
    delta_q = np.array([2.6, 3.3, 4.4, 6.2, 8.8, 12.0, 16.5, 21.5])[q]
    sigma_q = np.array([0.42, 0.68, 1.25, 2.6, 5.2, 8.6, 14.2, 21.2])[q]
    c["_case_effect"] = delta_q * parity
    c["_noise_sigma"] = sigma_q
    return c


_CATALOG = _operational_catalog()


def generate(n: int, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = rng.permutation(np.arange(n) % _N_CASES)
    d = {k: _CATALOG[k][idx].copy() for k in FEATURES}
    df = pd.DataFrame(d)[FEATURES]

    smooth = _CATALOG["_smooth_delay"][idx]
    case_eff = _CATALOG["_case_effect"][idx]
    noise = rng.normal(0.0, _CATALOG["_noise_sigma"][idx])
    df["delay"] = (smooth + case_eff + noise).clip(-15.0, 240.0)
    return df
