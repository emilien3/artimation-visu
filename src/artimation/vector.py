"""Portage Python de « Vector — Aircraft crossing studio » (outil ENAC / C. Hurter, hors ligne, JS sans dépendance).

Portage fidèle de `physics.js` (rencontres, espace des caps sûrs) et de `density.js` (cartes de densité
positive/négative). Repère de l'outil : x vers la droite, y vers le BAS (écran), cap en degrés dans le sens horaire
depuis le haut (nord), vitesse en nœuds, distances en NM, temps en minutes. Validé contre le JS d'origine
(tests/test_vector.py, exécuté sous node).
"""
from dataclasses import dataclass, replace
from math import acos, asin, atan2, cos, degrees, hypot, radians, sin, sqrt

import numpy as np
from scipy.ndimage import convolve1d

EPS = 1e-9


@dataclass(frozen=True)
class Ac:
    id: str
    x: float
    y: float
    speed: float  # kt
    heading: float  # ° horaire depuis le nord


def velocity(a):
    """Vitesse en NM/min."""
    return sin(radians(a.heading)) * a.speed / 60, -cos(radians(a.heading)) * a.speed / 60


def position(a, minutes=0.0):
    vx, vy = velocity(a)
    return replace(a, x=a.x + vx * minutes, y=a.y + vy * minutes)


def encounter(a, b, horizon, separation):
    """Approche minimale de deux avions à vitesse constante sur [0, horizon] + point de croisement des routes."""
    va, vb = velocity(a), velocity(b)
    d, rv = (b.x - a.x, b.y - a.y), (vb[0] - va[0], vb[1] - va[1])
    vv = rv[0] ** 2 + rv[1] ** 2
    t = max(0.0, min(horizon, -(d[0] * rv[0] + d[1] * rv[1]) / vv)) if vv > 1e-12 else 0.0
    pa, pb = position(a, t), position(b, t)
    distance = hypot(pa.x - pb.x, pa.y - pb.y)
    det = va[0] * vb[1] - va[1] * vb[0]
    crossing = None
    if abs(det) > 1e-9:
        ta = (d[0] * vb[1] - d[1] * vb[0]) / det
        tb = (d[0] * va[1] - d[1] * va[0]) / det
        if -1e-9 <= ta <= horizon and -1e-9 <= tb <= horizon:
            crossing = dict(x=a.x + va[0] * ta, y=a.y + va[1] * ta, ta=max(0.0, ta), tb=max(0.0, tb), gap=abs(ta - tb))
    return dict(a=a.id, b=b.id, t=t, distance=distance, crossing=crossing, risk=distance < separation)


def analyze(aircraft, horizon, separation):
    out = [encounter(aircraft[i], aircraft[j], horizon, separation)
           for i in range(len(aircraft)) for j in range(i + 1, len(aircraft))]
    out = [e for e in out if e["crossing"] or e["risk"]]
    return sorted(out, key=lambda e: (not e["risk"], e["t"]))


def _norm(angle):
    return angle % 360


def _heading(x, y):
    return _norm(degrees(atan2(x, -y)))


def heading_space(aircraft, selected_id, horizon, separation):
    """Intervalles de caps sûrs / en conflit pour `selected_id` (autres avions en route directe, virage instantané).

    On découpe le cercle des caps en chaque frontière possible (tangence au disque de séparation d'un intrus, contact
    exactement à l'horizon), on teste chaque intervalle ouvert et on réunit les intervalles bloqués.
    """
    own = next((a for a in aircraft if a.id == selected_id), None)
    if own is None:
        return dict(safe=[], unsafe=[], safe_degrees=0.0, current_safe=False, already_inside=False)
    speed, blocked, already_inside = own.speed / 60, [], False
    for other in aircraft:
        if other.id == selected_id:
            continue
        rx, ry = other.x - own.x, other.y - own.y
        distance, v = hypot(rx, ry), velocity(other)
        if distance < separation:
            already_inside = True
            blocked.append([0.0, 360.0])
            break
        if horizon <= 0:
            continue
        cuts = [0.0, 360.0]

        def risk_at(angle):
            rad = radians(angle)
            wx, wy = sin(rad) * speed - v[0], -cos(rad) * speed - v[1]
            ww = wx * wx + wy * wy
            t = max(0.0, min(horizon, (rx * wx + ry * wy) / ww)) if ww > 1e-12 else 0.0
            return hypot(rx - wx * t, ry - wy * t) < separation

        if distance > 0 and speed > 0:
            alpha, base = asin(min(1.0, separation / distance)), atan2(ry, rx)
            for angle in (base - alpha, base + alpha):
                ux, uy = cos(angle), sin(angle)
                dot = v[0] * ux + v[1] * uy
                disc = dot * dot + speed * speed - v[0] ** 2 - v[1] ** 2
                if disc >= -EPS:
                    root = sqrt(max(0.0, disc))
                    for k in (-dot - root, -dot + root):
                        if k >= -EPS:
                            cuts.append(_heading(v[0] + k * ux, v[1] + k * uy))
            cx, cy = v[0] + rx / horizon, v[1] + ry / horizon
            c, radius = hypot(cx, cy), separation / horizon
            if c > EPS:
                cosine = (speed * speed + c * c - radius * radius) / (2 * speed * c)
                if -1 - EPS <= cosine <= 1 + EPS:
                    offset, center = degrees(acos(max(-1.0, min(1.0, cosine)))), _heading(cx, cy)
                    cuts += [_norm(center - offset), _norm(center + offset)]
        cuts.sort()
        for lo, hi in zip(cuts, cuts[1:]):
            if hi - lo > EPS and risk_at((lo + hi) / 2):
                blocked.append([lo, hi])
    blocked.sort()
    unsafe = []
    for lo, hi in blocked:
        if unsafe and lo <= unsafe[-1][1] + EPS:
            unsafe[-1][1] = max(unsafe[-1][1], hi)
        else:
            unsafe.append([lo, hi])
    safe, start = [], 0.0
    for lo, hi in unsafe:
        if lo - start > EPS:
            safe.append([start, lo])
        start = hi
    if 360 - start > EPS:
        safe.append([start, 360.0])
    current_safe = all(o.id == selected_id or not encounter(own, o, horizon, separation)["risk"] for o in aircraft)
    return dict(safe=safe, unsafe=unsafe, safe_degrees=sum(hi - lo for lo, hi in safe),
                current_safe=current_safe, already_inside=already_inside)


def gaussian_kernel(sigma_cells):
    if sigma_cells < 0:
        raise ValueError("La largeur du noyau doit être positive.")
    if sigma_cells == 0:
        return np.array([1.0])
    radius = int(np.ceil(3 * sigma_cells))
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma_cells) ** 2)
    return k / k.sum()


def _smooth(m, kx, ky):
    if len(kx) == 1 and len(ky) == 1:
        return m.copy()
    return convolve1d(convolve1d(m, kx, axis=1, mode="constant"), ky, axis=0, mode="constant")  # remplissage nul, comme le JS


def density_maps(aircraft, horizon=10.0, separation=5.0, cols=160, rows=120, width=120.0, height=90.0, sigma=1.5, ids=None):
    """Cartes de densité de l'outil : pour chaque avion, chaque cellule à portée (vitesse × horizon) est « positive » si le
    cap qui y mène est sans conflit, « négative » (valeur = nombre d'intrus en conflit) sinon. Somme sur les avions,
    lissage gaussien, puis priorité stricte : un négatif, même faible, l'emporte sur tout positif.
    """
    dx, dy = width / cols, height / rows
    kx, ky = gaussian_kernel(sigma / dx), gaussian_kernel(sigma / dy)
    xs, ys = (np.arange(cols) + 0.5) * dx, (np.arange(rows) + 0.5) * dy
    positive, negative = np.zeros((rows, cols)), np.zeros((rows, cols))
    for own in (a for a in aircraft if ids is None or a.id in ids):
        reach = own.speed / 60 * horizon
        rx, ry = xs[None, :] - own.x, ys[:, None] - own.y
        inside = (np.hypot(rx, ry) <= reach) & (np.hypot(rx, ry) >= 1e-10)
        h = (np.degrees(np.arctan2(rx, -ry)) + 360) % 360
        counts = np.zeros((rows, cols))
        for other in aircraft:
            if other.id == own.id:
                continue
            for lo, hi in heading_space([own, other], own.id, horizon, separation)["unsafe"]:
                counts += (h >= lo) & (h < hi)
        positive += np.where(inside & (counts == 0), 1.0, 0.0)
        negative += np.where(inside & (counts > 0), counts, 0.0)
    positive, negative = _smooth(positive, kx, ky), _smooth(negative, kx, ky)
    signed = np.where(negative > 0, -negative, positive)
    return dict(positive=positive, negative=negative, signed=signed, cols=cols, rows=rows, width=width, height=height)
