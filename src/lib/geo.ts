// Equirectangular projection and great-circle arcs for the bundled SVG map.
// Constants must match scripts/build-map.mjs.

export const MAP_WIDTH = 1000;
export const MAP_LAT_TOP = 84;
export const MAP_LAT_BOTTOM = -60;
export const MAP_HEIGHT = ((MAP_LAT_TOP - MAP_LAT_BOTTOM) / 360) * MAP_WIDTH;

export interface Point {
  x: number;
  y: number;
}

export function project(longitude: number, latitude: number): Point {
  const lat = Math.max(MAP_LAT_BOTTOM, Math.min(MAP_LAT_TOP, latitude));
  return { x: ((longitude + 180) / 360) * MAP_WIDTH, y: ((MAP_LAT_TOP - lat) / 360) * MAP_WIDTH };
}

const RAD = Math.PI / 180;

/**
 * Samples the great circle between two points and returns projected polyline
 * segments. A path that crosses the antimeridian (±180°) is split into two
 * segments that each run to the map edge instead of streaking across the map.
 */
export function greatCircleSegments(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  steps = 48,
): Point[][] {
  const lat1 = from.latitude * RAD, lon1 = from.longitude * RAD;
  const lat2 = to.latitude * RAD, lon2 = to.longitude * RAD;
  const a = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)] as const;
  const b = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)] as const;
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);

  const coords: { lon: number; lat: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let x: number, y: number, z: number;
    if (omega < 1e-9) {
      [x, y, z] = a;
    } else {
      const k1 = Math.sin((1 - t) * omega) / Math.sin(omega);
      const k2 = Math.sin(t * omega) / Math.sin(omega);
      x = k1 * a[0] + k2 * b[0];
      y = k1 * a[1] + k2 * b[1];
      z = k1 * a[2] + k2 * b[2];
    }
    coords.push({ lon: Math.atan2(y, x) / RAD, lat: Math.atan2(z, Math.hypot(x, y)) / RAD });
  }

  const segments: Point[][] = [[]];
  for (let i = 0; i < coords.length; i++) {
    const cur = coords[i]!;
    const prev = i > 0 ? coords[i - 1]! : null;
    if (prev && Math.abs(cur.lon - prev.lon) > 180) {
      // Crossing ±180°: interpolate the latitude at the edge and split.
      const prevEdge = prev.lon > 0 ? 180 : -180;
      const curUnwrapped = cur.lon + (prev.lon > 0 ? 360 : -360);
      const f = (prevEdge - prev.lon) / (curUnwrapped - prev.lon);
      const edgeLat = prev.lat + f * (cur.lat - prev.lat);
      segments[segments.length - 1]!.push(project(prevEdge, edgeLat));
      segments.push([project(-prevEdge, edgeLat)]);
    }
    segments[segments.length - 1]!.push(project(cur.lon, cur.lat));
  }
  return segments.filter((s) => s.length > 1);
}

export function segmentsToPath(segments: Point[][]): string {
  return segments
    .map((s) => "M" + s.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L"))
    .join("");
}
