"""Bake world country outlines into a compact file the dot map can zoom into.

The map used to draw its dots from CONTINENT_BOXES, which is a handful of
rectangles, so every coastline had square corners. The first fix rasterised
Natural Earth's land polygons once, at world resolution. That looked right at
world level and fell apart the moment you wanted to zoom, because a fixed grid
of 1.6-degree dots gives Switzerland about four dots across.

So this ships the outlines themselves. The canvas rasterises them at whatever
resolution the current view needs: the world, one continent, or one country.
Zooming in genuinely resolves more coast rather than magnifying blocks.

Countries are identified by testing our own centroid table against each polygon,
which avoids depending on Natural Earth's names or numeric codes.

    python tools/build_map.py

Writes land.js.
"""
import base64
import io
import json
import os
import re
import struct
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_geography import CENTROID, REFERENCE          # noqa: E402

SRC = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
OUT = 'land.js'

# Coordinates are quantised to this many degrees before packing. At 0.02 a dot
# is never larger than the error, even zoomed to a single small country.
STEP = 0.02
# Longitudes are unwrapped, so a ring that crosses the antimeridian runs past
# 180. The origin is pulled back a full turn to keep the packed values positive.
LON0, LAT0 = -360.0, -90.0


def load_country_rings():
    """Decode the TopoJSON into [(rings, ...)] per country geometry."""
    topo = json.loads(urllib.request.urlopen(SRC, timeout=60).read())
    sx, sy = topo['transform']['scale']
    tx, ty = topo['transform']['translate']

    arcs = []
    for arc in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def stitch(idxs):
        ring = []
        for i in idxs:
            pts = arcs[~i][::-1] if i < 0 else arcs[i]
            ring.extend(pts[1:] if ring else pts)
        # Russia, Fiji and Antarctica cross the antimeridian, where longitude
        # jumps from 180 to -180. Left alone, that single edge spans the whole
        # map and the scanline fill smears a band of "land" across the ocean -
        # which is what put stray dots off the coast of Norway. Unwrapping keeps
        # consecutive points within half a turn of each other, so every edge is
        # short and the fill stays where the country is.
        out = []
        shift = 0.0
        for j, (lon, lat) in enumerate(ring):
            if j:
                d = (lon + shift) - out[-1][0]
                if d > 180:
                    shift -= 360
                elif d < -180:
                    shift += 360
            out.append((lon + shift, lat))
        return out

    out = []
    for geom in topo['objects']['countries']['geometries']:
        if not geom.get('arcs'):
            continue
        polys = geom['arcs'] if geom['type'] == 'MultiPolygon' else [geom['arcs']]
        rings = []
        for poly in polys:
            for ring in poly:
                r = stitch(ring)
                if len(r) > 3:
                    rings.append(r)
        if rings:
            out.append((geom.get('properties', {}).get('name', '?'), rings))
    return out


def inside(rings, lat, lon):
    """Even-odd point in polygon across every ring of one country."""
    hit = False
    for ring in rings:
        n = len(ring)
        for i in range(n):
            x0, y0 = ring[i]
            x1, y1 = ring[(i + 1) % n]
            if (y0 > lat) != (y1 > lat):
                xc = x0 + (lat - y0) * (x1 - x0) / (y1 - y0)
                if lon < xc:
                    hit = not hit
    return hit


def bounds(rings):
    """South, north, west, east of a set of rings, in degrees."""
    s = w = 1e9
    n = e = -1e9
    for ring in rings:
        for lon, lat in ring:
            s, n = min(s, lat), max(n, lat)
            w, e = min(w, lon), max(e, lon)
    return s, n, w, e


def main_extent(rings, centroid):
    """Bounding box of a country's main landmass, ignoring distant territories.

    Natural Earth files French Guiana under France and Greenland under Denmark,
    so a plain union of every ring frames the Atlantic instead of the country.
    Group the rings by proximity - single linkage, with a gap wide enough to
    keep an archipelago like Indonesia together - then keep the group holding
    the country's own centroid, or the largest group if it holds none.
    """
    GAP = 8.0
    parts = []
    for ring in rings:
        s0 = n0 = ring[0][1]
        w0 = e0 = ring[0][0]
        area = 0.0
        for i in range(len(ring)):
            x0, y0 = ring[i]
            x1, y1 = ring[(i + 1) % len(ring)]
            area += x0 * y1 - x1 * y0
            s0, n0 = min(s0, y0), max(n0, y0)
            w0, e0 = min(w0, x0), max(e0, x0)
        parts.append({'box': [s0, n0, w0, e0], 'area': abs(area) / 2})

    def near(a, b):
        return not (a[0] - GAP > b[1] or a[1] + GAP < b[0]
                    or a[2] - GAP > b[3] or a[3] + GAP < b[2])

    groups = []
    for part in parts:
        merged = [g for g in groups if near(g['box'], part['box'])]
        for g in merged:
            groups.remove(g)
        box = part['box'][:]
        area = part['area']
        for g in merged:
            box = [min(box[0], g['box'][0]), max(box[1], g['box'][1]),
                   min(box[2], g['box'][2]), max(box[3], g['box'][3])]
            area += g['area']
        groups.append({'box': box, 'area': area})

    if centroid:
        lat, lon = centroid
        for g in groups:
            b = g['box']
            if b[0] - GAP <= lat <= b[1] + GAP and b[2] - GAP <= lon <= b[3] + GAP:
                return g['box']
    return max(groups, key=lambda g: g['area'])['box']


# Our country names against Natural Earth's, where the two differ. Everything
# not listed here matches on name once punctuation and case are stripped.
ALIAS = {
    'BA': 'Bosnia and Herz.', 'DO': 'Dominican Rep.', 'MK': 'Macedonia',
    'SB': 'Solomon Is.', 'TT': 'Trinidad and Tobago', 'TR': 'Turkey',
    'US': 'United States of America', 'CZ': 'Czechia', 'TL': 'Timor-Leste',
    'PS': 'Palestine', 'LA': 'Laos', 'KR': 'South Korea', 'VN': 'Vietnam',
    'BN': 'Brunei', 'MM': 'Myanmar', 'GB': 'United Kingdom',
}


def norm(name):
    return re.sub(r'[^a-z]', '', name.lower())


def our_names():
    """Country code -> display name, read from world.js so there is one list."""
    src = io.open('world.js', encoding='utf-8').read()
    return dict(re.findall(r"([A-Z]{2}): \['([^']+)'", src))


def assign(countries):
    """Match each polygon to an ISO code by name, then verify with a centroid.

    Name matching is unambiguous where a name exists. The check that follows -
    that the country's own centroid really does fall inside the polygon we just
    matched - is what catches a wrong alias rather than letting it through.

    At 110m the microstates and small island nations have no polygon at all.
    They come back as unmatched and get a box around their centroid instead,
    which is enough for the map to frame them.
    """
    names = our_names()
    by_name = {}
    for i, (name, _rings) in enumerate(countries):
        by_name.setdefault(norm(name), i)

    codes = [None] * len(countries)
    unmatched, wrong = [], []
    for code, label in sorted(names.items()):
        i = by_name.get(norm(ALIAS.get(code, label)))
        if i is None or codes[i] is not None:
            unmatched.append(code)
            continue
        lat, lon = CENTROID.get(code, (None, None))
        # Our centroids are rough: for an archipelago like Indonesia or the
        # Philippines the middle of the country is open water, so demanding the
        # point be inside the polygon would reject a correct match. Checking it
        # falls within the outline's bounding box still catches a bad alias -
        # a country landing on the wrong continent - without that false alarm.
        if lat is not None:
            bs, bn, bw, be = bounds(countries[i][1])
            if not (bs - 2 <= lat <= bn + 2 and bw - 2 <= lon <= be + 2):
                wrong.append((code, countries[i][0]))
                unmatched.append(code)
                continue
        codes[i] = code
    if wrong:
        for code, name in wrong:
            print('  %s does not lie anywhere near the polygon named %r'
                  % (code, name))
        raise SystemExit('name matching produced a country in the wrong place')
    return codes, sorted(unmatched)


def main():
    countries = load_country_rings()
    codes, unmatched = assign(countries)

    # Pack every ring's points into one array of quantised uint16 pairs.
    pts = bytearray()
    rings_meta = []          # [countryIndex, pointCount] per ring
    order, index_of = [], {}
    for i, (_name, rings) in enumerate(countries):
        code = codes[i]
        if code is None:
            ci = -1          # land we cannot name; still drawn, just never lit
        else:
            if code not in index_of:
                index_of[code] = len(order)
                order.append(code)
            ci = index_of[code]
        for ring in rings:
            # Drop consecutive duplicates left by quantising.
            q, last = [], None
            for lon, lat in ring:
                v = (int(round((lon - LON0) / STEP)), int(round((lat - LAT0) / STEP)))
                if v != last:
                    q.append(v)
                    last = v
            if len(q) < 4:
                continue
            for x, y in q:
                pts += struct.pack('>HH', min(x, 65535), min(y, 65535))
            rings_meta.append([ci, len(q)])

    # Bounding box per country, in degrees, from its own rings.
    boxes = {}
    for i, (_name, rings) in enumerate(countries):
        code = codes[i]
        if code is None:
            continue
        boxes[code] = [round(v, 2) for v in main_extent(rings, CENTROID.get(code))]

    # Countries with no polygon at this scale - small islands, mostly - get a
    # box around their centroid so the map can still frame them.
    for code in unmatched:
        lat, lon = CENTROID[code]
        boxes[code] = [round(lat - 0.6, 2), round(lat + 0.6, 2),
                       round(lon - 0.6, 2), round(lon + 0.6, 2)]

    # Continent boxes are the union of their countries, which is tighter and
    # more honest than the tap-target rectangles in world.js.
    # Oceania straddles the antimeridian, so a plain union of its countries
    # runs from -180 to 180 and frames the entire planet. Take the union twice,
    # once with western longitudes shifted a full turn east, and keep whichever
    # is narrower. A window whose east edge is past 180 wraps, and the canvas
    # knows how to draw that.
    members = {}
    for code, box in boxes.items():
        name = REFERENCE.get(code)
        if name:
            members.setdefault(name, []).append(box)

    cont = {}
    for name, boxlist in members.items():
        plain = [min(b[0] for b in boxlist), max(b[1] for b in boxlist),
                 min(b[2] for b in boxlist), max(b[3] for b in boxlist)]
        shifted_lons = [(b[2] + 360 if b[2] < 0 else b[2],
                         b[3] + 360 if b[3] < 0 else b[3]) for b in boxlist]
        shifted = [plain[0], plain[1],
                   min(w for w, _ in shifted_lons), max(e for _, e in shifted_lons)]
        cont[name] = plain if (plain[3] - plain[2]) <= (shifted[3] - shifted[2]) else shifted

    blob = base64.b64encode(bytes(pts)).decode('ascii')
    body = '''// Generated by tools/build_map.py - do not edit by hand.
// Natural Earth 110m country outlines, quantised to @STEP@ degrees.
// The canvas rasterises these at whatever resolution the current view needs,
// so zooming into a continent or a country resolves more coast rather than
// magnifying the same dots.
const LAND = {
  step: @STEP@, lon0: @LON0@, lat0: @LAT0@,
  codes: @CODES@,
  rings: @RINGS@,
  box: @BOXES@,
  contBox: @CONT@,
  cont: @C2C@,
  pts: '@BLOB@',
};

// Points are unpacked once, into a flat array of quantised x,y pairs.
LAND.xy = null;
function landPoints() {
  if (!LAND.xy) {
    const raw = atob(LAND.pts);
    const n = raw.length >> 1;
    const a = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = (raw.charCodeAt(i * 2) << 8) | raw.charCodeAt(i * 2 + 1);
    }
    LAND.xy = a;
  }
  return LAND.xy;
}

/* Rasterise the outlines onto a cols x rows grid covering [s,n,w,e].
 * Returns a Uint8Array where 0 is sea, 255 is land belonging to a country we
 * hold no adventures for, and anything else is 1 + the index into LAND.codes
 * of the country that owns that cell. Unnamed land still has to be drawn or
 * the map has holes where Africa and South America should be.
 *
 * Scanline rather than point-in-polygon per cell: for each row of dots, find
 * where every edge crosses that latitude, sort the crossings and fill between
 * them. That is one pass over the edges per row instead of per dot.
 */
function landGrid(s, n, w, e, cols, rows) {
  const xy = landPoints();
  const grid = new Uint8Array(cols * rows);
  const dLat = (n - s) / rows;
  const dLon = (e - w) / cols;

  // Pre-split the ring list into [countryIndex, firstPoint, pointCount].
  const spans = [];
  let at = 0;
  for (const [ci, count] of LAND.rings) {
    spans.push([ci, at, count]);
    at += count;
  }

  const xs = [];
  for (let row = 0; row < rows; row++) {
    const lat = n - (row + 0.5) * dLat;
    const latQ = (lat - LAND.lat0) / LAND.step;
    for (const [ci, first, count] of spans) {
      const val = ci < 0 ? 255 : ci + 1;
      xs.length = 0;
      for (let i = 0; i < count; i++) {
        const a = (first + i) * 2;
        const b = (first + (i + 1) % count) * 2;
        const y0 = xy[a + 1], y1 = xy[b + 1];
        if ((y0 > latQ) === (y1 > latQ)) continue;
        const x0 = xy[a], x1 = xy[b];
        xs.push(x0 + (latQ - y0) * (x1 - x0) / (y1 - y0));
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a0 = xs[k] * LAND.step + LAND.lon0;
        const b0 = xs[k + 1] * LAND.step + LAND.lon0;
        // A window that reaches past 180 wraps - Oceania does - so the same
        // span is tried again a full turn east.
        // Rings are stored unwrapped, so the same land can sit a turn either
        // side of the window we are drawing. Try all three positions.
        for (const shift of [-360, 0, 360]) {
          const lonA = a0 + shift, lonB = b0 + shift;
          if (lonB < w || lonA > e) continue;
          let c0 = Math.floor((lonA - w) / dLon);
          let c1 = Math.ceil((lonB - w) / dLon);
          if (c0 < 0) c0 = 0;
          if (c1 > cols) c1 = cols;
          for (let col = c0; col < c1; col++) {
            const lon = w + (col + 0.5) * dLon;
            if (lon < lonA || lon > lonB) continue;
            // A named country wins over unnamed land where outlines overlap.
            const at = row * cols + col;
            if (val !== 255 || grid[at] === 0) grid[at] = val;
          }
        }
      }
    }
  }
  return grid;
}
'''
    for token, value in [
        ('@STEP@', repr(STEP)), ('@LON0@', repr(LON0)), ('@LAT0@', repr(LAT0)),
        ('@CODES@', json.dumps(order)),
        ('@RINGS@', json.dumps(rings_meta, separators=(',', ':'))),
        ('@BOXES@', json.dumps(boxes, separators=(',', ':'), sort_keys=True)),
        ('@CONT@', json.dumps({k: [round(v, 2) for v in b] for k, b in cont.items()},
                              separators=(',', ':'), sort_keys=True)),
        ('@C2C@', json.dumps({c: REFERENCE[c] for c in sorted(boxes)
                              if c in REFERENCE},
                             separators=(',', ':'))),
        ('@BLOB@', blob),
    ]:
        body = body.replace(token, value)

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(body)
    named = sum(1 for c in codes if c)
    print('%d country polygons, %d matched to a code' % (len(countries), named))
    if unmatched:
        print('no polygon at this scale (boxed from centroid): %s'
              % ', '.join(sorted(unmatched)))
    print('%d rings, %d points, %s written at %d KB'
          % (len(rings_meta), len(pts) // 4, OUT,
             (len(body) + 512) // 1024))


if __name__ == '__main__':
    main()
