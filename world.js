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

const COUNTRIES = {
  AU: ['Australia', '🇦🇺'], NZ: ['New Zealand', '🇳🇿'],
  FJ: ['Fiji', '🇫🇯'], PF: ['French Polynesia', '🇵🇫'], VU: ['Vanuatu', '🇻🇺'],
  NC: ['New Caledonia', '🇳🇨'], WS: ['Samoa', '🇼🇸'], TO: ['Tonga', '🇹🇴'],
  CK: ['Cook Islands', '🇨🇰'], SB: ['Solomon Islands', '🇸🇧'],
  PG: ['Papua New Guinea', '🇵🇬'], PW: ['Palau', '🇵🇼'], NU: ['Niue', '🇳🇺'],
  NF: ['Norfolk Island', '🇳🇫'], FM: ['Micronesia', '🇫🇲'],
  MH: ['Marshall Islands', '🇲🇭'], KI: ['Kiribati', '🇰🇮'],
  TV: ['Tuvalu', '🇹🇻'], NR: ['Nauru', '🇳🇷'], TL: ['Timor-Leste', '🇹🇱'],
  GB: ['United Kingdom', '🇬🇧'], IE: ['Ireland', '🇮🇪'], FR: ['France', '🇫🇷'],
  IT: ['Italy', '🇮🇹'], ES: ['Spain', '🇪🇸'], PT: ['Portugal', '🇵🇹'],
  DE: ['Germany', '🇩🇪'], CH: ['Switzerland', '🇨🇭'], AT: ['Austria', '🇦🇹'],
  NL: ['Netherlands', '🇳🇱'], NO: ['Norway', '🇳🇴'], IS: ['Iceland', '🇮🇸'],
  GR: ['Greece', '🇬🇷'], CZ: ['Czechia', '🇨🇿'], HR: ['Croatia', '🇭🇷'],
  PL: ['Poland', '🇵🇱'], US: ['United States', '🇺🇸'], CA: ['Canada', '🇨🇦'],
  MX: ['Mexico', '🇲🇽'],
  DK: ['Denmark', '🇩🇰'], SE: ['Sweden', '🇸🇪'],
  JP: ['Japan', '🇯🇵'], KR: ['South Korea', '🇰🇷'], CN: ['China', '🇨🇳'],
  HK: ['Hong Kong', '🇭🇰'], SG: ['Singapore', '🇸🇬'], AE: ['United Arab Emirates', '🇦🇪'],
  ID: ['Indonesia', '🇮🇩'],
  // Middle East
  OM: ['Oman', '🇴🇲'], JO: ['Jordan', '🇯🇴'],
  IL: ['Israel', '🇮🇱'], PS: ['Palestine', '🇵🇸'],
  QA: ['Qatar', '🇶🇦'], SA: ['Saudi Arabia', '🇸🇦'],
  BH: ['Bahrain', '🇧🇭'], KW: ['Kuwait', '🇰🇼'],
  LB: ['Lebanon', '🇱🇧'], TR: ['Turkiye', '🇹🇷'],
  // Central America
  GT: ['Guatemala', '🇬🇹'], BZ: ['Belize', '🇧🇿'], CR: ['Costa Rica', '🇨🇷'],
  PA: ['Panama', '🇵🇦'], NI: ['Nicaragua', '🇳🇮'], HN: ['Honduras', '🇭🇳'],
  SV: ['El Salvador', '🇸🇻'],
  // Caribbean
  CU: ['Cuba', '🇨🇺'], JM: ['Jamaica', '🇯🇲'], BS: ['Bahamas', '🇧🇸'],
  DO: ['Dominican Republic', '🇩🇴'], PR: ['Puerto Rico', '🇵🇷'],
  BB: ['Barbados', '🇧🇧'], TT: ['Trinidad & Tobago', '🇹🇹'],
  LC: ['Saint Lucia', '🇱🇨'], DM: ['Dominica', '🇩🇲'], KY: ['Cayman Islands', '🇰🇾'],
  TC: ['Turks & Caicos', '🇹🇨'], AW: ['Aruba', '🇦🇼'], AG: ['Antigua & Barbuda', '🇦🇬'],
  GD: ['Grenada', '🇬🇩'], VG: ['British Virgin Islands', '🇻🇬'],
  VI: ['US Virgin Islands', '🇻🇮'], HT: ['Haiti', '🇭🇹'],
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

function countryName(code) { return (COUNTRIES[code] || [code])[0]; }
function countryFlag(code) { return (COUNTRIES[code] || ['', '🌍'])[1]; }

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
function drawWorldMap(canvas, counts, selected) {
  const css = getComputedStyle(document.documentElement);
  const land   = css.getPropertyValue('--eucalypt').trim() || '#3f6b52';
  const empty  = css.getPropertyValue('--line').trim() || '#ccc';
  const active = css.getPropertyValue('--ochre').trim() || '#8c3d1f';

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(rect.width, 1);
  const h = w * 0.52;                       // trims most of the empty polar rows
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const STEP = 2.5;                          // degrees per dot
  const LAT_TOP = 78, LAT_BOTTOM = -58;      // crop the poles
  const cols = 360 / STEP;
  const rows = (LAT_TOP - LAT_BOTTOM) / STEP;
  const cw = w / cols;
  const ch = h / rows;
  const r = Math.max(Math.min(cw, ch) * 0.38, 0.6);

  for (let row = 0; row < rows; row++) {
    const lat = LAT_TOP - row * STEP - STEP / 2;
    for (let col = 0; col < cols; col++) {
      const lon = -180 + col * STEP + STEP / 2;
      const cont = continentAt(lat, lon);
      if (!cont) continue;

      const has = (counts[cont] || 0) > 0;
      ctx.fillStyle = cont === selected ? active
                    : (has ? (CONTINENT_COLOUR[cont] || land) : empty);
      ctx.globalAlpha = cont === selected ? 1 : (has ? 0.92 : 0.3);
      ctx.beginPath();
      ctx.arc(col * cw + cw / 2, row * ch + ch / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// Turn a click on the canvas back into a continent.
function continentFromPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const STEP = 2.5, LAT_TOP = 78, LAT_BOTTOM = -58;
  const lon = ((clientX - rect.left) / rect.width) * 360 - 180;
  const lat = LAT_TOP - ((clientY - rect.top) / rect.height) * (LAT_TOP - LAT_BOTTOM);

  // Exact hit first, then a small tolerance so narrow landmasses stay tappable.
  const exact = continentAt(lat, lon);
  if (exact) return exact;
  for (const pad of [3, 6, 9]) {
    for (const [dLat, dLon] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) {
      const hit = continentAt(lat + dLat, lon + dLon);
      if (hit) return hit;
    }
  }
  return null;
}
