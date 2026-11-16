// Domain model for Theta23 — Space Mission Readiness Radar (Phase 1).
// All dates are date-only ISO strings (YYYY-MM-DD) interpreted in UTC.

export type IsoDate = string;

export type LocationType =
  | "supplier"
  | "transit_hub"
  | "integration_facility"
  | "test_facility"
  | "launch_site";

export interface Mission {
  id: string;
  name: string;
  description: string;
  /** Explicit "as of" date. Calculations never read the wall clock. */
  analysisDate: IsoDate;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  type: LocationType;
}

/** A planned physical path, not a verified commercial freight service. */
export interface Route {
  id: string;
  code: string;
  name: string;
  /** Ordered: supplier first, receiving facility last. */
  locationIds: string[];
}

export type MilestoneType = "review" | "test_campaign" | "integration_cutoff";

export interface Milestone {
  id: string;
  missionId: string;
  code: string;
  name: string;
  type: MilestoneType;
  scheduledDate: IsoDate;
  sequence: number;
  /**
   * Minimum elapsed days between the preceding milestone's occurrence and this
   * milestone's readiness. It includes the preceding campaign's own duration
   * and any follow-on preparation. Ignored for the first milestone.
   */
  minDaysAfterPrevious: number | null;
  /** A known, confirmed alternative date (e.g. a backup test slot). */
  alternativeDate: IsoDate | null;
}

export interface Component {
  id: string;
  missionId: string;
  partNumber: string;
  description: string;
  subsystem: string;
  supplierName: string;
  supplierLocationId: string;
  routeId: string | null;
  milestoneId: string | null;
  /** Baseline expected arrival at the receiving facility. */
  baselineArrivalDate: IsoDate | null;
  /** Inspection, installation and verification days after arrival. */
  preparationDays: number | null;
  isSingleSource: boolean;
  notes: string;
}

export type ScenarioTargetType = "supplier_location" | "route";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  targetType: ScenarioTargetType;
  targetId: string;
  delayDays: number;
}

export const ACTION_TYPES = [
  "contact_supplier",
  "investigate_alternate_source",
  "investigate_alternate_transport",
  "confirm_alternative_test_slot",
  "accept_and_monitor",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  contact_supplier: "Contact supplier",
  investigate_alternate_source: "Investigate alternate source",
  investigate_alternate_transport: "Investigate alternate transport",
  confirm_alternative_test_slot: "Confirm alternative test slot",
  accept_and_monitor: "Accept and monitor",
};

export const ACTION_STATUSES = ["open", "in_progress", "closed"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};

/** Ordinary operational log entry — not an immutable audit trail. */
export interface ActionRecord {
  id: string;
  componentId: string;
  actionType: ActionType;
  owner: string;
  status: ActionStatus;
  note: string;
  createdAt: string; // ISO timestamp
}

export interface Dataset {
  mission: Mission;
  locations: Location[];
  routes: Route[];
  milestones: Milestone[];
  components: Component[];
  scenarios: Scenario[];
  actions: ActionRecord[];
}

// ---- Mutation inputs (shared by the server and the browser sandbox) ----

export interface ComponentInput {
  partNumber: string;
  description: string;
  subsystem: string;
  supplierName: string;
  supplierLocationId: string;
  routeId: string | null;
  milestoneId: string | null;
  baselineArrivalDate: IsoDate | null;
  preparationDays: number | null;
  isSingleSource: boolean;
  notes: string;
}

export interface PlanInput {
  analysisDate: IsoDate;
  milestones: {
    id: string;
    scheduledDate: IsoDate;
    alternativeDate: IsoDate | null;
    minDaysAfterPrevious: number | null;
  }[];
}

export interface ActionInput {
  componentId: string;
  actionType: ActionType;
  owner: string;
  note: string;
}

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  supplier: "Supplier",
  transit_hub: "Transit hub",
  integration_facility: "Integration facility",
  test_facility: "Test facility",
  launch_site: "Launch site",
};
