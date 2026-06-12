// session-state.schema types (schemaVersion "1.0") — ported from skill repo

export interface Priority {
  impact: number;      // 1-5
  likelihood: number;  // 1-5
  cost: number;        // 1-5
  score: number;       // computed: impact * likelihood / cost (leave 0, render side recomputes)
}

export interface Evidence {
  ts: string;
  kind: "data" | "experiment" | "reflection";
  summary: string;
  verdict: "supports" | "refutes" | "mixed";
}

export interface Node {
  id: string;
  parent: string | null;
  label: string;
  lens: "business" | "career";
  type: "hypothesis" | "metric" | "experiment" | "sub-question";
  priority: Priority;
  status: "open" | "testing" | "confirmed" | "refuted" | "parked";
  evidence: Evidence[];
  note?: string;
}

export interface Insight {
  id: string;
  finding: string;
  why: string;
  magnitude: string;
  fromNodes: string[];
}

export interface DecisionOption {
  label: string;
  tradeoffs: string;
  expectedImpact: string;
  risks: string;
}

export interface NextStep {
  who: string;
  what: string;
  when: string;
}

export interface Decision {
  options: DecisionOption[];
  chosen: string;
  nextSteps: NextStep[];
}

export interface TimelineEntry {
  ts: string;
  type:
    | "phase-change"
    | "inject"
    | "repivot"
    | "reprioritize"
    | "branch"
    | "switch-lens"
    | "note";
  detail: string;
}

export interface Frame {
  rawAsk: string;
  decision: string;
  owner: string;
  stakes: string;
  successCriteria: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type Lens = "business" | "career" | "hybrid";
export type Phase =
  | "frame"
  | "decompose"
  | "prioritize"
  | "test"
  | "converge"
  | "decide"
  | "communicate"
  | "iterate";

export interface SessionState {
  schemaVersion: "1.0";
  session: SessionMeta;
  lens: Lens;
  phase: Phase;
  frame: Frame;
  nodes: Node[];
  insights: Insight[];
  decision: Decision;
  timeline: TimelineEntry[];
  redFlags: string[];
}

export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
}
