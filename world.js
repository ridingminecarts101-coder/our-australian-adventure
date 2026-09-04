/* Geography + the world map.
 *
 * The map is drawn as a dot grid on a canvas rather than hand-authored SVG
 * coastlines: at this size a dot matrix reads clearly on a phone, stays a few
 * kilobytes, and the same boxes that decide which dots are land also decide
 * which continent a tap landed on. Coarse by design — it's a navigation
 * control, not an atlas.
 */
'use strict';

// Continent land, as unions of [south, north, west, east] boxes in degrees.
const CONTINENT_BOXES = {
  'North America': [
    [55, 71, -168, -141],   // Alaska
    [49, 70, -141, -95],    // western Canada
    [45, 70, -95, -55],     // eastern Canada
    [32, 49, -125, -95],    // western US
    [25, 49, -95, -67],     // eastern US
    [15, 32, -117, -87],    // Mexico
    [7, 18, -92, -77],      // Central America
    [60, 83, -55, -20],     // Greenland
    // Caribbean. Too small to draw at this dot resolution, but they must
    // resolve to the right continent when tapped near.
    [17.5, 23.5, -85, -66],     // Cuba, Jamaica, Hispaniola, Puerto Rico, Cayman
    [20.5, 27.5, -79, -70],     // Bahamas and Turks & Caicos
    [11.8, 18.8, -65.5, -59],   // Lesser Antilles, Virgins down to Barbados
    [10.0, 11.5, -62.0, -60.3], // Trinidad & Tobago - claimed here deliberately,
                                // because North America is tested before South
                                // America and Trinidad sits on the latter's shelf
    [11.9, 13.0, -70.3, -68.1], // Aruba, Curacao, Bonaire
  ],
  'South America': [
    [0, 12, -78, -60],      // Colombia / Venezuela
    [-10, 0, -80, -35],     // Amazon basin, at its widest
    [-20, -10, -72, -35],
    [-30, -20, -70, -40],   // tapering
    [-40, -30, -73, -50],
    [-55, -40, -75, -63],   // Patagonia to the tip
  ],
  'Europe': [
    [36, 48, -10, 30],      // Iberia through the Balkans
    [43, 55, -5, 30],       // France to Poland
    [50, 60, 5, 32],
    [55, 71, 5, 32],        // Scandinavia
    [40, 60, 28, 45],       // eastern Europe
    [50, 59, -11, 2],       // Britain & Ireland
    [63, 67, -25, -13],     // Iceland
    // Mediterranean islands sit below the 36-degree line the mainland
    // boxes start at, so they need their own. Kept tight so they cannot
    // reach across to the North African coast.
    [35.7, 36.2, 14.0, 14.7],   // Malta and Gozo
    [34.7, 35.8, 23.3, 26.5],   // Crete
  ],
  // Its own region rather than a slice of Asia. Geographically this is Western
  // Asia; every travel guide splits it out, and so does this app.
  'Middle East': [
    [12, 32, 34, 60],       // Arabian Peninsula
    [29, 38, 34, 49],       // Levant and Iraq
    [36, 42, 30, 45],       // Anatolia - the European side falls to Europe above
    [25, 40, 44, 63],       // Iran
  ],
  'Africa': [
    [20, 37, -17, 12],      // Maghreb
    [20, 33, 12, 35],       // Libya / Egypt
    [5, 20, -17, 20],       // Sahel, west to east
    [5, 20, 20, 43],        // Sudan / Horn
    [-5, 5, 8, 42],         // equatorial
    [-18, -5, 11, 40],
    [-35, -18, 14, 33],     // southern Africa, narrowing
    [-26, -12, 43, 50],     // Madagascar
  ],
  'Asia': [
    [40, 75, 40, 100],      // western Siberia
    [45, 72, 100, 180],     // eastern Siberia
    [35, 50, 45, 90],       // Central Asia
    [20, 35, 60, 78],       // India, upper
    [8, 20, 72, 82],        // India, tapering to the point
    [5.5, 10, 79.4, 82.2],  // Sri Lanka, below the tip of India
    [-1, 7.5, 72.4, 74.0],  // Maldives, strung down the 73rd meridian
    [20, 32, 78, 97],       // north-east India / Myanmar
    [-10, 20, 95, 130],     // South-East Asia and Indonesia
    [22, 45, 100, 145],     // China and the Koreas
    [30, 46, 128, 146],     // Japan
  ],
  'Oceania': [
    [-39, -11, 113, 154],   // Australia
    [-47, -34, 166, 179],   // New Zealand
    [-11, -1, 131, 156],    // New Guinea
    [-22, -15, 165, 170],   // New Caledonia / Vanuatu
    [-19, -16, 177, 180],   // Fiji
    // The scattered Pacific nations. Same as the Caribbean above: not big
    // enough to render, but they have to answer correctly to a tap.
    [4.5, 10.5, 131, 172],      // Palau, Micronesia, Marshall Islands
    [-9.5, 1.0, 166, 180],      // Nauru and Tuvalu
    [-11.5, -5.5, 155, 168],    // Solomon Islands
    [-22.5, -12.5, -176, -157], // Samoa, Tonga, Niue, Cook Islands
    [-20.5, -15.0, -152, -146], // French Polynesia
    [-3.0, 4.0, -160, -150],    // Kiribati, Line Islands
    [-30.0, -28.0, 167.0, 168.5], // Norfolk Island
  ],
};


// Small island nations are collected behind one row rather than listed beside
// Australia — a country with three adventures shouldn't sit at the same level
// as one with five hundred. Papua New Guinea is deliberately NOT here: it's a
// major country that simply hasn't been filled in yet.
const ISLAND_GROUP = new Set([
  'FJ', 'PF', 'VU', 'NC', 'WS', 'TO', 'CK', 'SB', 'PW', 'NU',
  'NF', 'FM', 'MH', 'KI', 'TV', 'NR', 'TL', 'MV', 'SC', 'MU',
  // Caribbean
  'BB', 'LC', 'DM', 'KY', 'TC', 'AW', 'AG', 'GD', 'VG', 'VI', 'BS', 'TT',
]);
// Below this many, they're just listed as ordinary countries — collapsing two
// nations behind a group row hides them for no benefit.
const ISLAND_GROUP_MIN = 3;

const CONTINENT_ORDER = ['Oceania', 'Europe', 'North America', 'Asia',
                         'Middle East', 'South America', 'Africa'];

// One muted colour per continent. Deliberately desaturated - the map is a
// navigation control sitting under a list, not the loudest thing on screen.
const CONTINENT_COLOUR = {
  'Oceania':       '#4f8a6b',   // eucalypt green
  'Europe':        '#5b7fa6',   // slate blue
  'North America': '#b0713c',   // clay
  'Asia':          '#9a5a86',   // mulberry
  'Middle East':   '#c19a3e',   // sand gold
  'South America': '#5f9aa0',   // teal
  'Africa':        '#a2603f',   // terracotta
};

// Paid packs are per continent. Slug must match the `pack` field in the data.
const PACK_SLUG = {
  'Oceania': 'oceania', 'Europe': 'europe', 'North America': 'north-america',
  'Asia': 'asia', 'Middle East': 'middle-east',
  'South America': 'south-america', 'Africa': 'africa',
};

// Names and flags live in countries.js, which is generated from one list.
function countryName(code) { return COUNTRY_NAME[code] || code; }
function countryFlag(code) { return COUNTRY_FLAG[code] || '🌍'; }

function continentAt(lat, lon) {
  for (const [name, boxes] of Object.entries(CONTINENT_BOXES)) {
    for (const [s, n, w, e] of boxes) {
      if (lat >= s && lat <= n && lon >= w && lon <= e) return name;
    }
  }
  return null;
}

/* ── The map ──────────────────────────────────────────────────────────
 * Draws into a canvas sized to its container. `counts` maps continent
 * name -> number of adventures, so empty continents can be drawn muted.
 */
/* ── The dot map ──────────────────────────────────────────────────────
 * One renderer for three zoom levels. `view` is null for the whole world,
 * {continent} for one continent, or {country} for one country; the window it
 * frames comes from the outlines themselves rather than the tap-target boxes,
 * so a country fills its canvas properly.
 *
 * The grid is rasterised at the resolution the view needs, so zooming in
 * resolves more coastline instead of magnifying the same dots.
 */
// Which continent a dot belongs to. LAND.cont only names countries we hold
// adventures for, so land we have nothing in - most of Africa and South
// America - falls back to the boxes, which cover the whole world. Without this
// a tap on Brazil resolves to nothing at all.
function contOf(code, lat, lon) {
  return (code && LAND.cont[code]) || continentAt(lat, lon);
}

const DOT_PITCH = 5;              // css px between dot centres
const MAP_PAD = 0.06;             // fraction of the span left as margin

// The last grid drawn, kept so a tap can be resolved without rasterising again.
let lastMap = null;

const WORLD_WINDOW = [-58, 78, -180, 180];   // poles cropped, no padding

function mapWindow(view) {
  let box = null;
  if (view && view.country) box = LAND.box[view.country];
  else if (view && view.continent) box = LAND.contBox[view.continent];
  // The world is already framed exactly as we want it, and padding it would
  // push the east edge past the antimeridian and shift the whole map west.
  if (!box) return WORLD_WINDOW.slice();

  let [s, n, w, e] = box;
  const padLat = Math.max((n - s) * MAP_PAD, 0.4);
  const padLon = Math.max((e - w) * MAP_PAD, 0.4);
  s -= padLat; n += padLat; w -= padLon; e += padLon;

  // A window whose east edge is past 180 wraps the dateline on purpose -
  // Oceania does. Anything else gets clamped to the map.
  const wraps = box[3] > 180;
  return [Math.max(s, -85), Math.min(n, 85),
          Math.max(w, -180), wraps ? Math.min(e, 360) : Math.min(e, 180)];
}

function drawWorldMap(canvas, counts, selected, view) {
  const css = getComputedStyle(document.documentElement);
  const land   = css.getPropertyValue('--eucalypt').trim() || '#3f6b52';
  const empty  = css.getPropertyValue('--line').trim() || '#ccc';
  const active = css.getPropertyValue('--ochre').trim() || '#8c3d1f';

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(rect.width, 1);

  const [s, n, west, east] = mapWindow(view);
  // Latitude degrees are taller than longitude degrees away from the equator.
  const mid = (s + n) / 2;
  const squash = Math.max(Math.cos(mid * Math.PI / 180), 0.25);
  let h = w * ((n - s) / ((east - west) * squash));
  h = Math.min(Math.max(h, w * 0.35), w * 0.95);

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cols = Math.max(Math.round(w / DOT_PITCH), 12);
  const rows = Math.max(Math.round(h / DOT_PITCH), 8);
  const grid = landGrid(s, n, west, east, cols, rows);
  lastMap = { canvas, s, n, w: west, e: east, cols, rows, grid };

  const cw = w / cols, ch = h / rows;
  const r = Math.max(Math.min(cw, ch) * 0.40, 0.6);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = grid[row * cols + col];
      if (!v) continue;                      // sea
      const code = v === 255 ? null : LAND.codes[v - 1];
      const cont = contOf(code, n - (row + 0.5) * ((n - s) / rows),
                                west + (col + 0.5) * ((east - west) / cols));

      // What counts as "lit" depends on how far in you are: the world and a
      // continent light everything that has adventures, a country view lights
      // only that country so its shape reads against its neighbours.
      let lit, colour;
      if (view && view.country) {
        lit = code === view.country;
        colour = lit ? (CONTINENT_COLOUR[cont] || land) : empty;
      } else if (view && view.continent) {
        lit = cont === view.continent;
        colour = lit ? (CONTINENT_COLOUR[cont] || land) : empty;
      } else {
        lit = cont && (counts[cont] || 0) > 0;
        colour = cont === selected ? active : (lit ? (CONTINENT_COLOUR[cont] || land) : empty);
      }

      ctx.fillStyle = colour;
      ctx.globalAlpha = (!view && cont === selected) ? 1 : (lit ? 0.92 : 0.26);
      ctx.beginPath();
      ctx.arc(col * cw + cw / 2, row * ch + ch / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// Turn a tap on the canvas into whatever that dot belongs to. Returns
// { country, continent } for the dot under the finger, searching outwards a
// little so a narrow country or an island is still reachable with a thumb.
function mapHit(canvas, clientX, clientY) {
  if (!lastMap || lastMap.canvas !== canvas) return null;
  const { s, n, w, e, cols, rows, grid } = lastMap;
  const rect = canvas.getBoundingClientRect();
  const col0 = Math.floor(((clientX - rect.left) / rect.width) * cols);
  const row0 = Math.floor(((clientY - rect.top) / rect.height) * rows);

  for (const pad of [0, 1, 2, 3, 4]) {
    for (let dr = -pad; dr <= pad; dr++) {
      for (let dc = -pad; dc <= pad; dc++) {
        if (pad && Math.max(Math.abs(dr), Math.abs(dc)) !== pad) continue;
        const row = row0 + dr, col = col0 + dc;
        if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
        const v = grid[row * cols + col];
        if (!v) continue;
        const code = v === 255 ? null : LAND.codes[v - 1];
        const lat = n - (row + 0.5) * ((n - s) / rows);
        let lon = w + (col + 0.5) * ((e - w) / cols);
        if (lon > 180) lon -= 360;
        return { country: code, continent: contOf(code, lat, lon) };
      }
    }
  }
  return null;
}

// Kept for the world map, which only ever needs the continent.
function continentFromPoint(canvas, clientX, clientY) {
  const hit = mapHit(canvas, clientX, clientY);
  return hit ? hit.continent : null;
}
