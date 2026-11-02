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

_N_MACRO = 8       # 8 network operational macro-scenarios
_N_MICRO = 256     # 2^8 micro-regimes across the 8 driving variables (order 8 > XGBoost max_depth=7)
_N_CASES = _N_MACRO * _N_MICRO  # 2,048 operational cases


def _hour_profile():
    h = np.arange(24)
    p = 0.2 + np.exp(-((h - 8) ** 2) / 18) + np.exp(-((h - 17) ** 2) / 24)
    p[:5] *= 0.15
    return p / p.sum()


def _operational_catalog():
    """Build the 2,048 operational cases (8 macro-scenarios x 256 order-8 micro-regimes)."""
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
    q = case_id % _N_MACRO
    r = case_id // _N_MACRO
    bits = np.array([(r >> (7 - k)) & 1 for k in range(8)], dtype=float)  # (8, 2048)
    b_int = bits.astype(int)
    qbits = np.array([(q >> (2 - j)) & 1 for j in range(3)], dtype=int)
    all11 = np.vstack([b_int, qbits])

    # Secondary context index s in {0..7}, orthogonal to the order-8 parity.
    s = (b_int[3] ^ b_int[4]) + 2 * (b_int[4] ^ b_int[5]) + 4 * (b_int[5] ^ b_int[6])

    # Centered 3-state response per driving variable k:
    # - rest (b_k == 0, prob 1/2): z_k = 0.0, g_k = 0.0 = E[g_k]
    # - absorption dip (b_k == 1 and sign_k < 0, prob 1/4): z_k = 0.22, g_k = -1.0
    # - active congestion (b_k == 1 and sign_k > 0, prob 1/4): z_k = 0.92, g_k = +1.0
    # Orthogonal parity signs prevent collinearity across drivers under colsample_bytree=0.5
    # while keeping the order-8 parity outside the span of depth-7 trees.
    parity_masks = np.array([
        [0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
        [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
        [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0],
        [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
        [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1],
        [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    ], dtype=int)
    sign = np.where((parity_masks @ all11) % 2 == 0, 1.0, -1.0)
    z = np.where(b_int == 0, 0.0, np.where(sign > 0, 0.92, 0.22))
    g_state = np.where(b_int == 0, 0.0, sign)

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

    weights_c = np.array([32.0, 26.0, 21.0, 17.0, 14.0, 11.5, 9.5, 8.0])[:, None]
    main_effect = (weights_c * g_state).sum(0) + 25.0
    secondary_effect = (
        1.2 * ((65.0 - c["turnaround_slack"]) / 45.0)
        + 0.9 * ((9.5 - c["dep_visibility"]) / 8.5)
    )
    c["_smooth_delay"] = main_effect + secondary_effect

    # Order-8 interaction (parity across all 8 micro-regime bits):
    # any tree of max_depth=7 inspects at most 7 variables and has zero expectation on this parity,
    # whereas CBR (k=3) retrieves recurring cases sharing all 8 bits.
    parity = np.where(b_int.sum(0) % 2 == 0, 1.0, -1.0)
    delta_s = np.array([2.6, 3.3, 4.4, 6.2, 8.8, 12.0, 16.5, 21.5])[s]
    sigma_s = np.array([0.25, 0.40, 0.65, 1.0, 1.5, 2.2, 3.2, 4.5])[s]
    c["_case_effect"] = delta_s * parity
    c["_noise_sigma"] = sigma_s
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
