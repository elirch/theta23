// Converts Natural Earth 1:110m geometry (via the world-atlas package) into
// pre-projected SVG path strings so the app needs no runtime map library or
// external map API. Run with `npm run build:map`; the output is committed.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature, mesh } from "topojson-client";

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve("world-atlas/countries-110m.json"), "utf8"));

// Must match src/lib/geo.ts
const W = 1000;
const LAT_TOP = 84;
const LAT_BOTTOM = -60;
const H = ((LAT_TOP - LAT_BOTTOM) / 360) * W;
const clampLat = (lat) => Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat));
const pt = ([lon, lat]) =>
  `${(((lon + 180) / 360) * W).toFixed(1)},${(((LAT_TOP - clampLat(lat)) / 360) * W).toFixed(1)}`;

const toPath = (coords, close) => {
  const pts = [];
  for (const c of coords) {
    const p = pt(c);
    if (pts[pts.length - 1] !== p) pts.push(p);
  }
  if (pts.length < 2) return "";
  return "M" + pts.join("L") + (close ? "Z" : "");
};

// Rings and lines that cross the antimeridian jump from +180° to −180°. Split
// them there so they do not streak across the whole map.
const ringPath = (ring, close) => {
  const jumps = [];
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) jumps.push(i);
  }
  if (jumps.length === 0) return toPath(ring, close);
  let coords = ring;
  if (close) {
    // Rotate the ring so it starts right after a jump; then every piece is contiguous.
    const open = ring.slice(0, -1);
    coords = [...open.slice(jumps[0]), ...open.slice(0, jumps[0])];
  }
  let out = "";
  let piece = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (Math.abs(coords[i][0] - coords[i - 1][0]) > 180) {
      out += toPath(piece, close);
      piece = [];
    }
    piece.push(coords[i]);
  }
  return out + toPath(piece, close);
};

const land = feature(topo, topo.objects.land);
const landGeoms = land.type === "FeatureCollection" ? land.features.map((f) => f.geometry) : [land.geometry];
let landPath = "";
for (const g of landGeoms) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    // Skip Antarctica (entirely below the cropped frame).
    if (poly[0].every(([, lat]) => lat < LAT_BOTTOM)) continue;
    for (const ring of poly) landPath += ringPath(ring, true);
  }
}

const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
let borderPath = "";
for (const line of borders.coordinates) {
  if (line.every(([, lat]) => lat < LAT_BOTTOM)) continue;
  borderPath += ringPath(line, false);
}

const out = {
  attribution: "Made with Natural Earth (public domain), via world-atlas 2.0.2",
  width: W,
  height: H,
  latTop: LAT_TOP,
  latBottom: LAT_BOTTOM,
  land: landPath,
  borders: borderPath,
};
writeFileSync(new URL("../src/data/world-110m.json", import.meta.url), JSON.stringify(out));
console.log(`land ${landPath.length} chars, borders ${borderPath.length} chars, height ${H}`);
