// Illustrative demo dataset for KESTREL-1.
//
// Real geography, fictional business entities. No supplier, route, part number
// or arrangement here describes a real company or a real commercial service.
//
// Dates are fixed constants around the initial analysis date (2027-04-12).
// They are written once when seeding and never shifted at startup.

import type { Component, Dataset, Location, Milestone, Route, Scenario } from "./types";

export const MISSION_ID = "mission-kestrel-1";

const locations: Location[] = [
  { id: "loc-sup-tls", code: "SUP-TLS", name: "Toulouse Supplier Site", city: "Toulouse", country: "France", latitude: 43.6047, longitude: 1.4442, type: "supplier" },
  { id: "loc-sup-muc", code: "SUP-MUC", name: "Munich Supplier Site", city: "Munich", country: "Germany", latitude: 48.1351, longitude: 11.582, type: "supplier" },
  { id: "loc-sup-yul", code: "SUP-YUL", name: "Montréal Supplier Site", city: "Montréal", country: "Canada", latitude: 45.5019, longitude: -73.5674, type: "supplier" },
  { id: "loc-sup-ngo", code: "SUP-NGO", name: "Nagoya Supplier Site", city: "Nagoya", country: "Japan", latitude: 35.1815, longitude: 136.9066, type: "supplier" },
  { id: "loc-sup-blr", code: "SUP-BLR", name: "Bengaluru Supplier Site", city: "Bengaluru", country: "India", latitude: 12.9716, longitude: 77.5946, type: "supplier" },
  { id: "loc-hub-fra", code: "HUB-FRA", name: "Frankfurt Air Cargo Hub", city: "Frankfurt", country: "Germany", latitude: 50.0379, longitude: 8.5622, type: "transit_hub" },
  { id: "loc-hub-anc", code: "HUB-ANC", name: "Anchorage Air Cargo Hub", city: "Anchorage", country: "United States", latitude: 61.1743, longitude: -149.9962, type: "transit_hub" },
  { id: "loc-fac-abq", code: "FAC-ABQ", name: "KESTREL Integration Facility", city: "Albuquerque", country: "United States", latitude: 35.0844, longitude: -106.6504, type: "integration_facility" },
  { id: "loc-fac-hsv", code: "FAC-HSV", name: "Environmental Test Facility", city: "Huntsville", country: "United States", latitude: 34.7304, longitude: -86.5861, type: "test_facility" },
  { id: "loc-lau-lpc", code: "LAU-LPC", name: "West Coast Launch Site", city: "Lompoc", country: "United States", latitude: 34.6391, longitude: -120.4579, type: "launch_site" },
];

const routes: Route[] = [
  { id: "route-tls-abq", code: "RT-TLS-ABQ", name: "Toulouse → Frankfurt → Albuquerque", locationIds: ["loc-sup-tls", "loc-hub-fra", "loc-fac-abq"] },
  { id: "route-muc-abq", code: "RT-MUC-ABQ", name: "Munich → Frankfurt → Albuquerque", locationIds: ["loc-sup-muc", "loc-hub-fra", "loc-fac-abq"] },
  { id: "route-yul-abq", code: "RT-YUL-ABQ", name: "Montréal → Albuquerque", locationIds: ["loc-sup-yul", "loc-fac-abq"] },
  { id: "route-ngo-abq", code: "RT-NGO-ABQ", name: "Nagoya → Anchorage → Albuquerque (trans-Pacific)", locationIds: ["loc-sup-ngo", "loc-hub-anc", "loc-fac-abq"] },
  { id: "route-blr-abq", code: "RT-BLR-ABQ", name: "Bengaluru → Frankfurt → Albuquerque", locationIds: ["loc-sup-blr", "loc-hub-fra", "loc-fac-abq"] },
  { id: "route-yul-lpc", code: "RT-YUL-LPC", name: "Montréal → Lompoc (launch-site delivery)", locationIds: ["loc-sup-yul", "loc-lau-lpc"] },
];

const milestones: Milestone[] = [
  { id: "ms-ait-rr", missionId: MISSION_ID, code: "AIT-RR", name: "AIT Readiness Review", type: "review", scheduledDate: "2027-05-10", sequence: 1, minDaysAfterPrevious: null, alternativeDate: null },
  // 30 days after the AIT Readiness Review: platform assembly and integration
  // that must be complete before the environmental test campaign can start.
  { id: "ms-env-test", missionId: MISSION_ID, code: "ENV-TEST", name: "Environmental Test Campaign", type: "test_campaign", scheduledDate: "2027-06-20", sequence: 2, minDaysAfterPrevious: 30, alternativeDate: null },
  // 12 days after the environmental test START: the test campaign itself plus
  // post-test preparation. A test start date is not proof the test is complete.
  { id: "ms-lic", missionId: MISSION_ID, code: "LIC", name: "Launch Integration Cutoff", type: "integration_cutoff", scheduledDate: "2027-07-20", sequence: 3, minDaysAfterPrevious: 12, alternativeDate: null },
];

type SeedComponent = Omit<Component, "id" | "missionId">;
const componentRows: SeedComponent[] = [
  { partNumber: "KS-FC-101", description: "Flight Computer", subsystem: "Avionics", supplierName: "Aurelia Avionique", supplierLocationId: "loc-sup-tls", routeId: "route-tls-abq", milestoneId: "ms-env-test", baselineArrivalDate: "2027-06-01", preparationDays: 10, isSingleSource: false, notes: "Flight unit with qualified flight software load." },
  { partNumber: "KS-ST-202", description: "Star Tracker", subsystem: "Attitude Control", supplierName: "Isarwerk Optik", supplierLocationId: "loc-sup-muc", routeId: "route-muc-abq", milestoneId: "ms-env-test", baselineArrivalDate: "2027-05-28", preparationDays: 12, isSingleSource: true, notes: "Only qualified source for this optical head; alignment needs 12 days." },
  { partNumber: "KS-RW-303", description: "Reaction Wheel Assembly", subsystem: "Attitude Control", supplierName: "Laurentide Motion", supplierLocationId: "loc-sup-yul", routeId: "route-yul-abq", milestoneId: "ms-env-test", baselineArrivalDate: "2027-05-25", preparationDays: 9, isSingleSource: false, notes: "Set of four wheels." },
  { partNumber: "KS-PD-404", description: "Power Conditioning and Distribution Unit", subsystem: "Power", supplierName: "Kaveri Power Systems", supplierLocationId: "loc-sup-blr", routeId: "route-blr-abq", milestoneId: "ms-ait-rr", baselineArrivalDate: "2027-04-16", preparationDays: 10, isSingleSource: false, notes: "" },
  { partNumber: "KS-BT-405", description: "Lithium-Ion Battery Module", subsystem: "Power", supplierName: "Hoshikawa Energy", supplierLocationId: "loc-sup-ngo", routeId: "route-ngo-abq", milestoneId: "ms-ait-rr", baselineArrivalDate: "2027-04-20", preparationDays: 8, isSingleSource: false, notes: "Ships at storage charge; acceptance cycling on arrival." },
  { partNumber: "KS-XT-505", description: "X-Band Transmitter", subsystem: "Communications", supplierName: "Chubu Microwave Works", supplierLocationId: "loc-sup-ngo", routeId: "route-ngo-abq", milestoneId: "ms-env-test", baselineArrivalDate: "2027-06-02", preparationDays: 12, isSingleSource: false, notes: "RF compatibility checks dominate preparation." },
  { partNumber: "KS-TH-606", description: "Thermal Control Kit", subsystem: "Thermal", supplierName: "Deccan Thermal Labs", supplierLocationId: "loc-sup-blr", routeId: "route-blr-abq", milestoneId: "ms-env-test", baselineArrivalDate: "2027-06-03", preparationDays: 7, isSingleSource: false, notes: "Heaters, thermistors and radiator panels." },
  { partNumber: "KS-SP-707", description: "Primary Structure Panel Set", subsystem: "Structure", supplierName: "Northfield Structures", supplierLocationId: "loc-sup-yul", routeId: "route-yul-abq", milestoneId: "ms-ait-rr", baselineArrivalDate: "2027-04-14", preparationDays: 14, isSingleSource: false, notes: "" },
  { partNumber: "KS-PC-808", description: "Propulsion Control Electronics", subsystem: "Propulsion Control", supplierName: "Kaveri Power Systems", supplierLocationId: "loc-sup-blr", routeId: "route-blr-abq", milestoneId: "ms-lic", baselineArrivalDate: "2027-06-30", preparationDays: 10, isSingleSource: false, notes: "Late-delivery flight unit; a qualification model supports testing." },
  { partNumber: "KS-SR-909", description: "Separation Ring and Adapter Harness", subsystem: "Structure", supplierName: "Northfield Structures", supplierLocationId: "loc-sup-yul", routeId: "route-yul-lpc", milestoneId: "ms-lic", baselineArrivalDate: "2027-07-05", preparationDays: 5, isSingleSource: false, notes: "Delivered directly to the launch site." },
];

const scenarios: Scenario[] = [
  {
    id: "scn-a",
    name: "A · Supplier production delay",
    description: "The Toulouse flight-computer supplier reports a production delay of 14 additional days.",
    targetType: "supplier_location",
    targetId: "loc-sup-tls",
    delayDays: 14,
  },
  {
    id: "scn-b",
    name: "B · Transport corridor disruption",
    description: "The trans-Pacific corridor via Anchorage is disrupted, adding 8 days to shipments on that route.",
    targetType: "route",
    targetId: "route-ngo-abq",
    delayDays: 8,
  },
  {
    id: "scn-c",
    name: "C · Single-source component delay",
    description: "The Munich supplier of the single-source star tracker slips by 21 additional days.",
    targetType: "supplier_location",
    targetId: "loc-sup-muc",
    delayDays: 21,
  },
];

export function componentIdFor(partNumber: string): string {
  return `cmp-${partNumber.toLowerCase()}`;
}

/** A fresh deep copy of the illustrative dataset. */
export function buildSeedDataset(): Dataset {
  return {
    mission: {
      id: MISSION_ID,
      name: "KESTREL-1 — Earth Observation Demonstrator",
      description:
        "A fictional small-satellite Earth observation demonstrator used to illustrate supply-chain readiness planning.",
      analysisDate: "2027-04-12",
    },
    locations: locations.map((l) => ({ ...l })),
    routes: routes.map((r) => ({ ...r, locationIds: [...r.locationIds] })),
    milestones: milestones.map((m) => ({ ...m })),
    components: componentRows.map((c) => ({ ...c, id: componentIdFor(c.partNumber), missionId: MISSION_ID })),
    scenarios: scenarios.map((s) => ({ ...s })),
    actions: [],
  };
}
