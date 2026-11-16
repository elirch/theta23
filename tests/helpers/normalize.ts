import type { Dataset } from "@/lib/types";

const by = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** Row order is not significant; sort so datasets can be compared. */
export function normalize(d: Dataset | null): Dataset | null {
  if (!d) return d;
  return {
    ...d,
    locations: [...d.locations].sort(by((x) => x.id)),
    routes: [...d.routes].sort(by((x) => x.id)),
    milestones: [...d.milestones].sort(by((x) => x.id)),
    components: [...d.components].sort(by((x) => x.id)),
    scenarios: [...d.scenarios].sort(by((x) => x.id)),
    actions: [...d.actions].sort(by((x) => x.id)),
  };
}
