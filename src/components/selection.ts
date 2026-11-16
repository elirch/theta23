export type Selection =
  | { kind: "location"; id: string }
  | { kind: "route"; id: string }
  | { kind: "component"; id: string }
  | null;
