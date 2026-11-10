"""Python port of Vector — Aircraft crossing studio (ENAC / C. Hurter, offline, dependency-free JS).

Faithful port of `physics.js` (encounters, safe heading space) and `density.js` (positive/negative density maps).
Tool coordinates: x points right, y points DOWN (screen), headings are degrees clockwise from the top (north),
speed is in knots, distances in NM and time in minutes. Validated against the original JS
(tests/test_vector.py, executed under Node).
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
    heading: float  # ° clockwise from north
    z: float = 36000.0  # altitude in ft (3D extension; ignored by 2D functions)
    vz: float = 0.0  # vertical rate in ft/min (3D extension)


def velocity(a):
    """Velocity in NM/min."""
    return sin(radians(a.heading)) * a.speed / 60, -cos(radians(a.heading)) * a.speed / 60


def position(a, minutes=0.0):
    vx, vy = velocity(a)
    return replace(a, x=a.x + vx * minutes, y=a.y + vy * minutes)


def encounter(a, b, horizon, separation):
    """Closest approach of two constant-velocity aircraft over [0, horizon], plus their route crossing point."""
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
    """Safe/conflicting heading intervals for `selected_id` (other aircraft fly directly, with instantaneous turns).

    Split the heading circle at every possible boundary (tangency to another aircraft's separation disk, contact
    exactly at the horizon), test each open interval, then merge blocked intervals.
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
        raise ValueError("Kernel width must be nonnegative.")
    if sigma_cells == 0:
        return np.array([1.0])
    radius = int(np.ceil(3 * sigma_cells))
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma_cells) ** 2)
    return k / k.sum()


def _smooth(m, kx, ky):
    if len(kx) == 1 and len(ky) == 1:
        return m.copy()
    return convolve1d(convolve1d(m, kx, axis=1, mode="constant"), ky, axis=0, mode="constant")  # zero padding, matching the JS


def density_maps(aircraft, horizon=10.0, separation=5.0, cols=160, rows=120, width=120.0, height=90.0, sigma=1.5, ids=None):
    """Tool density maps: for each aircraft, a cell within reach (speed × horizon) is positive when its heading
    is conflict-free, otherwise negative (value = number of conflicting aircraft). Sum over aircraft,
    apply Gaussian smoothing, then give strict priority to negative values, however small, over positive ones.
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


# ---------------------------------------------------------------------------------------------------------------------
# 3D extension (altitude): absent from the original tool, which assumes a single level.
# Conflict = horizontal distance < sep AND altitude difference < sep_v. Vertical rates are constant and independent of heading.
# Times where |dz| < sep_v form an interval [t_lo, t_hi] independent of the chosen heading. A heading conflicts when the minimum
# horizontal distance over that interval is < sep. With no altitude difference, this reduces to the 2D model.
# ---------------------------------------------------------------------------------------------------------------------
def vertical_window(own, other, horizon, sep_v):
    """Interval [t_lo, t_hi] ⊂ [0, horizon] (min) where the altitude difference is < sep_v, or None."""
    dz0, dvz = other.z - own.z, other.vz - own.vz  # ft, ft/min
    if sep_v is None or sep_v <= 0:
        return 0.0, horizon
    if abs(dvz) < 1e-9:
        return (0.0, horizon) if abs(dz0) < sep_v else None
    t1, t2 = sorted(((-sep_v - dz0) / dvz, (sep_v - dz0) / dvz))
    lo, hi = max(0.0, t1), min(horizon, t2)
    return (lo, hi) if hi > lo else None


def conflict_counts(own, aircraft, headings, horizon, separation, sep_v):
    """Number of conflicting aircraft for each heading in `headings` (arbitrary-shaped array, in degrees)."""
    h = np.radians(np.asarray(headings, float))
    vox, voy = np.sin(h) * own.speed / 60, -np.cos(h) * own.speed / 60
    counts = np.zeros(h.shape)
    for other in aircraft:
        if other.id == own.id:
            continue
        win = vertical_window(own, other, horizon, sep_v)
        if win is None:
            continue
        lo, hi = win
        vx, vy = velocity(other)
        rx, ry = other.x - own.x, other.y - own.y
        wx, wy = vx - vox, vy - voy  # other aircraft's relative velocity
        ww = wx * wx + wy * wy
        t = np.clip(np.where(ww > 1e-12, -(rx * wx + ry * wy) / np.where(ww > 1e-12, ww, 1), lo), lo, hi)
        counts += np.hypot(rx + wx * t, ry + wy * t) < separation
    return counts


def encounter3d(a, b, horizon, separation, sep_v):
    """Like `encounter`, with altitude: `risk` means a cylindrical conflict; `vertical_sep` is the altitude difference at approach (ft)."""
    e = encounter(a, b, horizon, separation)
    va, vb = velocity(a), velocity(b)
    win = vertical_window(a, b, horizon, sep_v)
    risk, t, dist = False, e["t"], e["distance"]
    if win is not None:
        lo, hi = win
        rv = (vb[0] - va[0], vb[1] - va[1])
        d, vv = (b.x - a.x, b.y - a.y), rv[0] ** 2 + rv[1] ** 2
        t = max(lo, min(hi, -(d[0] * rv[0] + d[1] * rv[1]) / vv)) if vv > 1e-12 else lo
        dist = hypot(d[0] + rv[0] * t, d[1] + rv[1] * t)
        risk = dist < separation
    e.update(t=t, distance=dist, risk=risk, vertical_sep=abs((b.z + b.vz * t) - (a.z + a.vz * t)),
             separated_vertically=win is None and (e["distance"] < separation))
    return e


def analyze3d(aircraft, horizon, separation, sep_v):
    out = [encounter3d(aircraft[i], aircraft[j], horizon, separation, sep_v)
           for i in range(len(aircraft)) for j in range(i + 1, len(aircraft))]
    out = [e for e in out if e["crossing"] or e["risk"]]
    return sorted(out, key=lambda e: (not e["risk"], e["t"]))


def heading_space3d(aircraft, selected_id, horizon, separation, sep_v, step=0.05):
    """Safe/conflicting heading intervals with altitude, sampled every `step` degrees (0.05° by default)."""
    own = next((a for a in aircraft if a.id == selected_id), None)
    if own is None:
        return dict(safe=[], unsafe=[], safe_degrees=0.0, current_safe=False, already_inside=False)
    hs = np.arange(0.0, 360.0, step) + step / 2
    bad = conflict_counts(own, aircraft, hs, horizon, separation, sep_v) > 0
    edges = np.flatnonzero(np.diff(np.concatenate([[False], bad, [False]]).astype(int)))
    unsafe = [[float(hs[a] - step / 2), float(hs[b - 1] + step / 2)] for a, b in zip(edges[::2], edges[1::2])]
    safe, start = [], 0.0
    for lo, hi in unsafe:
        if lo - start > 1e-9:
            safe.append([start, lo])
        start = hi
    if 360 - start > 1e-9:
        safe.append([start, 360.0])
    others = [o for o in aircraft if o.id != selected_id]
    return dict(safe=safe, unsafe=unsafe, safe_degrees=sum(hi - lo for lo, hi in safe),
                current_safe=not any(encounter3d(own, o, horizon, separation, sep_v)["risk"] for o in others),
                already_inside=any(hypot(o.x - own.x, o.y - own.y) < separation and vertical_window(own, o, horizon, sep_v) is not None for o in others))


def density_maps3d(aircraft, horizon=10.0, separation=5.0, sep_v=1000.0, cols=160, rows=120, width=120.0, height=90.0, sigma=1.5, ids=None):
    """Like `density_maps`, but a heading conflicts only within the separation cylinder (including altitude)."""
    dx, dy = width / cols, height / rows
    kx, ky = gaussian_kernel(sigma / dx), gaussian_kernel(sigma / dy)
    xs, ys = (np.arange(cols) + 0.5) * dx, (np.arange(rows) + 0.5) * dy
    positive, negative = np.zeros((rows, cols)), np.zeros((rows, cols))
    for own in (a for a in aircraft if ids is None or a.id in ids):
        reach = own.speed / 60 * horizon
        rx, ry = xs[None, :] - own.x, ys[:, None] - own.y
        inside = (np.hypot(rx, ry) <= reach) & (np.hypot(rx, ry) >= 1e-10)
        counts = conflict_counts(own, aircraft, (np.degrees(np.arctan2(rx, -ry)) + 360) % 360, horizon, separation, sep_v)
        positive += np.where(inside & (counts == 0), 1.0, 0.0)
        negative += np.where(inside & (counts > 0), counts, 0.0)
    positive, negative = _smooth(positive, kx, ky), _smooth(negative, kx, ky)
    return dict(positive=positive, negative=negative, signed=np.where(negative > 0, -negative, positive),
                cols=cols, rows=rows, width=width, height=height)
