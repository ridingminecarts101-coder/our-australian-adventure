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

  for (const width of [320, 768]) {
    const c = canvas(width); context.testCanvas = c;
    run(`drawWorldMap(testCanvas, Object.fromEntries(CONTINENT_ORDER.map(x=>[x,1])), null, null)`);
    assert(c.arcs.length > 150, `world view draws recognisable land at ${width}px`);
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

  console.log('PASS: world/continent/country dot maps, dateline wrapping, product geography and small-country markers');
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
