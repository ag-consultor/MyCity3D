"""Triangulation (Ear-Clipping) fuer 3D-Polygone der Gebaeude. Nur Standardbibliothek.

Aus dem ersten Prototyp herausgeloest, weil prepare_gemeinde.py nur diese Funktion braucht.
"""
import math


# ---------------------------------------------------------------- Triangulation
def newell(pts):
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        x1, y1, z1 = pts[i]
        x2, y2, z2 = pts[(i + 1) % len(pts)]
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return nx / ln, ny / ln, nz / ln


def tri_area2(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def in_tri(p, a, b, c):
    d1 = tri_area2(p, a, b)
    d2 = tri_area2(p, b, c)
    d3 = tri_area2(p, c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def ear_clip(p2):
    n = len(p2)
    if n < 3:
        return []
    area = sum(tri_area2((0, 0), p2[i], p2[(i + 1) % n]) for i in range(n))
    idx = list(range(n)) if area > 0 else list(range(n))[::-1]
    out = []
    guard = 0
    while len(idx) > 3 and guard < 4 * n * n:
        guard += 1
        clipped = False
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = p2[i0], p2[i1], p2[i2]
            if tri_area2(a, b, c) <= 1e-9:
                continue
            if any(in_tri(p2[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            out.append((i0, i1, i2))
            del idx[k]
            clipped = True
            break
        if not clipped:
            break
    if len(idx) == 3:
        out.append((idx[0], idx[1], idx[2]))
    return out


def triangulate(pts):
    nx, ny, nz = newell(pts)
    ax = max(range(3), key=lambda i: abs((nx, ny, nz)[i]))
    keep = [i for i in range(3) if i != ax]
    p2 = [(p[keep[0]], p[keep[1]]) for p in pts]
    return ear_clip(p2), (nx, ny, nz)


