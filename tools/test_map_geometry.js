'use strict';

// Deterministic geometry/render checks for the world, continent and country
// dot-map views. No browser profile, network, account or live state is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function canvas(width) {
  const arcs = [];
  const context = {
    fillStyle: '', globalAlpha: 1,
    setTransform() {}, clearRect() {}, beginPath() {}, fill() {},
    arc(x, y, r) { arcs.push({x, y, r, fill:this.fillStyle, alpha:this.globalAlpha}); },
  };
  const result = {
    width: 0, height: 0, style: {}, arcs,
    getBoundingClientRect: () => ({left:0,top:0,width,height: Number.parseFloat(result.style.height) || width}),
    getContext: () => context,
  };
  return result;
}

function main() {
  const context = {
    console, Uint8Array, Uint16Array, Math,
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    document: {documentElement:{}},
    getComputedStyle: () => ({getPropertyValue: () => ''}),
  };
  context.window = context;
  context.devicePixelRatio = 2;
  vm.createContext(context);
  for (const file of ['countries.js', 'land.js', 'world.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename:file});
  }
  const run = code => vm.runInContext(code, context);

  assert.deepEqual(JSON.parse(run('JSON.stringify(mapWindow(null))')), [-90,78,-180,180]);
  assert.equal(run(`Object.entries(LAND.cont).filter(([code,cont]) => COUNTRY_CONT[code] !== cont).length`), 0,
    'named map polygons use the same product geography as country navigation');
  assert.equal(run(`Object.keys(LAND.box).filter(code => {
    const [s,n,w,e]=mapWindow({country:code}); return !(n>s && e>w && n<=90 && s>=-90 && e-w<=360);
  }).length`), 0, 'every country has a finite non-empty map window');
  assert.equal(run(`Object.keys(LAND.contBox).filter(cont => {
    const [s,n,w,e]=mapWindow({continent:cont}); return !(n>s && e>w && n<=90 && s>=-90 && e-w<=360);
  }).length`), 0, 'every continent has a finite non-empty map window');

  const worldSamples = [];
  for (const width of [320, 390, 430, 768, 1440]) {
    const c = canvas(width); context.testCanvas = c;
    run(`drawWorldMap(testCanvas, Object.fromEntries(CONTINENT_ORDER.map(x=>[x,1])), null, null)`);
    assert(c.arcs.length > 150, `world view draws recognisable land at ${width}px`);
    const sample = JSON.parse(run('JSON.stringify({cols:lastMap.cols,rows:lastMap.rows,pitch:lastMap.pitch,cells:lastMap.grid.length})'));
    const height = Number.parseFloat(c.style.height);
    const baselineCells = Math.max(Math.round(width / 5), 12)
      * Math.max(Math.round(height / 5), 8);
    worldSamples.push({width, baselineCells, ...sample});
    if (width <= 430) {
      assert(sample.cols >= Math.floor(width / 3.5),
        `phone world view uses detailed responsive sampling at ${width}px`);
      assert(sample.cells >= baselineCells * 2,
        `phone world view has at least twice the former five-pixel grid detail at ${width}px`);
    }
    assert(sample.cols <= 240 && sample.cells < 30000,
      `world render stays within its bounded grid budget at ${width}px`);
    assert(c.height > 0 && Number.parseFloat(c.style.height) >= width * .35
      && Number.parseFloat(c.style.height) <= width * .95);
    assert.equal(run(`lastMap.grid.reduce((n,v,i) => {
      if (!v) return n;
      const row=Math.floor(i/lastMap.cols), col=i%lastMap.cols;
      const code=v===255?null:LAND.codes[v-1];
      const lat=lastMap.n-(row+.5)*((lastMap.n-lastMap.s)/lastMap.rows);
      let lon=lastMap.w+(col+.5)*((lastMap.e-lastMap.w)/lastMap.cols); if(lon>180)lon-=360;
      return n + (CONTINENT_ORDER.includes(contOf(code,lat,lon))?0:1);
    },0)`), 0, 'every visible world land dot has a navigation geography');
  }
  assert(worldSamples[0].pitch < worldSamples.at(-1).pitch,
    'world dot spacing responds smoothly from phones to wide screens');

  // The denser world silhouette must retain the recognisable extremes: land
  // on both sides of the antimeridian and a visible Antarctic coast/cap.
  {
    const c = canvas(390); context.testCanvas = c;
    run(`drawWorldMap(testCanvas, Object.fromEntries(CONTINENT_ORDER.map(x=>[x,1])), null, null)`);
    const features = JSON.parse(run(`JSON.stringify(lastMap.grid.reduce((out,v,i) => {
      if (!v) return out;
      const row=Math.floor(i/lastMap.cols), col=i%lastMap.cols;
      const lat=lastMap.n-(row+.5)*((lastMap.n-lastMap.s)/lastMap.rows);
      const lon=lastMap.w+(col+.5)*((lastMap.e-lastMap.w)/lastMap.cols);
      if (lon < -165) out.westDateline++;
      if (lon > 165) out.eastDateline++;
      if (lat < -60) out.antarctica++;
      return out;
    }, {westDateline:0,eastDateline:0,antarctica:0}))`));
    assert(features.westDateline > 0 && features.eastDateline > 0,
      'world silhouette keeps land on both sides of the dateline');
    assert(features.antarctica > 40, 'world silhouette retains a detailed Antarctica');

    // Stable interior points exercise the visible silhouette and tap routing
    // across every product region, including the separate Middle East group.
    const knownLand = [
      [40, -100, 'North America'], [-15, -60, 'South America'],
      [50, 10, 'Europe'], [0, 20, 'Africa'], [45, 100, 'Asia'],
      [30, 45, 'Middle East'], [-25, 135, 'Oceania'], [-75, 0, 'Antarctica'],
    ];
    const rect = c.getBoundingClientRect();
    for (const [lat, lon, continent] of knownLand) {
      const x = (lon + 180) / 360 * rect.width;
      const y = (78 - lat) / 168 * rect.height;
      context.hit = run(`mapHit(testCanvas,${x},${y})`);
      assert(context.hit, `${continent} interior is present in the phone world silhouette`);
      assert.equal(context.hit.continent, continent, `${continent} phone tap routes correctly`);
    }
  }

  // A canvas laid out inside a hidden tab reports zero width. Once that tab
  // is visible, the next draw must replace the 1px fallback bitmap rather
  // than leaving the map blank for the rest of the session.
  {
    let width = 0;
    const c = canvas(0);
    c.getBoundingClientRect = () => ({left:0, top:0, width,
      height:Number.parseFloat(c.style.height) || width});
    context.testCanvas = c;
    run(`drawWorldMap(testCanvas, Object.fromEntries(CONTINENT_ORDER.map(x=>[x,1])), null, null)`);
    assert.equal(c.width, 2, 'hidden map initially uses only the guarded 1 CSS pixel fallback');
    width = 566;
    run(`drawWorldMap(testCanvas, Object.fromEntries(CONTINENT_ORDER.map(x=>[x,1])), null, null)`);
    assert.equal(c.width, 1132, 'visible redraw restores a device-pixel-sized backing bitmap');
    assert(Number.parseFloat(c.style.height) > 100 && c.arcs.length > 150,
      'visible redraw restores useful map height and land geometry');
  }

  for (const continent of JSON.parse(run('JSON.stringify(CONTINENT_ORDER)'))) {
    const c = canvas(390); context.testCanvas = c; context.testContinent = continent;
    run('drawWorldMap(testCanvas, null, null, {continent:testContinent})');
    assert(c.arcs.length > 0, `${continent} continent view draws land`);
    assert.equal(run('lastMap.pitch'), 5, `${continent} keeps established zoom-view density`);
  }

  // Smaller visual dots must not reduce nearby-land discovery for a thumb.
  // A synthetic phone grid isolates the hit-radius contract from coast shape.
  {
    const c = canvas(390); context.testCanvas = c;
    run(`(() => {
      const cols=120, rows=56, grid=new Uint8Array(cols*rows);
      grid[28*cols+60]=LAND.codes.indexOf('AU')+1;
      lastMap={canvas:testCanvas,s:-90,n:78,w:-180,e:180,cols,rows,grid,pitch:3.25};
    })()`);
    const rect = c.getBoundingClientRect();
    const x = (60.5 * rect.width / 120) + 18;
    const y = 28.5 * rect.height / 56;
    context.hit = run(`mapHit(testCanvas,${x},${y})`);
    assert.equal(context.hit.country, 'AU', 'phone map finds land 18 CSS pixels from a tap');
    assert.equal(context.hit.continent, 'Oceania');
    assert.equal(run('mapHit(testCanvas,-1,100)'), null,
      'tap left of the canvas cannot resolve nearby land');
    assert.equal(run('mapHit(testCanvas,391,100)'), null,
      'tap right of the canvas cannot resolve nearby land');

    const hidden = canvas(0); context.testCanvas = hidden;
    run(`lastMap={canvas:testCanvas,s:-90,n:78,w:-180,e:180,cols:12,rows:8,
      grid:new Uint8Array(96),pitch:3.1}`);
    assert.equal(run('mapHit(testCanvas,0,0)'), null,
      'zero-width canvas cannot produce invalid hit geometry');
  }

  // South America is stored in an east-of-180 window to avoid a planet-wide
  // frame. A hit must wrap back to the correct negative longitude and country.
  {
    const c = canvas(420); context.testCanvas = c;
    run("drawWorldMap(testCanvas,null,null,{continent:'South America'})");
    const cell = JSON.parse(run(`JSON.stringify((() => {
      for(let i=0;i<lastMap.grid.length;i++){
        const v=lastMap.grid[i]; if(v && v!==255 && LAND.codes[v-1]==='BR')
          return {row:Math.floor(i/lastMap.cols),col:i%lastMap.cols};
      } return null;
    })())`));
    assert(cell, 'shifted South America window contains Brazil');
    const rect = c.getBoundingClientRect();
    const x = (cell.col + .5) * rect.width / run('lastMap.cols');
    const y = (cell.row + .5) * rect.height / run('lastMap.rows');
    context.hit = run(`mapHit(testCanvas,${x},${y})`);
    assert.equal(context.hit.country, 'BR');
    assert.equal(context.hit.continent, 'South America');
  }

  for (const country of ['AU','BR','GB','JP','RU','ZA']) {
    const c = canvas(390); context.testCanvas = c; context.testCountry = country;
    run('drawWorldMap(testCanvas,null,null,{country:testCountry})');
    assert(run('lastMap.countryDots') > 0, `${country} country view lights its real outline`);
    assert.equal(run('lastMap.fallbackMarker'), null);
  }

  for (const country of ['AD','FJ','PF','SG','VA']) {
    const c = canvas(390); context.testCanvas = c; context.testCountry = country;
    run('drawWorldMap(testCanvas,null,null,{country:testCountry})');
    assert(run('lastMap.countryDots > 0 || lastMap.fallbackMarker?.country === testCountry'),
      `${country} country view cannot be an empty canvas`);
  }

  console.log('World grids: ' + worldSamples.map(s =>
    `${s.width}px ${s.cols}x${s.rows}=${s.cells} cells (5px baseline ${s.baselineCells})`).join('; '));
  console.log('PASS: detailed responsive world map, thumb hit radius, continent/country maps, dateline wrapping, product geography and small-country markers');
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
