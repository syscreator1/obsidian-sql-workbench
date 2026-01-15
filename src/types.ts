export type NodeKind =
  | "function"
  | "method"
  | "arrow"
  | "functionExpression";

export type CodeNode = {
  id: string;              // Unique ID (e.g., file#QualifiedName)
  name: string;            // Display name (e.g., Plugin.onload / Foo.bar)
  kind: NodeKind;
  filePath: string;
  line: number;            // 1-based
};

export type CallEdge = {
  fromId: string;
  toId: string;
  callText: string;
  line: number;
  kind?: "call" | "wiring";
};

export type CallGraph = {
  nodes: Record<string, CodeNode>;
  edges: CallEdge[];
};

// src/types.ts
export type CallGraphNode = {
  id: string;
  name: string;
  kind: string;        // e.g., "function" | "method" | "arrow". Using string for now is fine.
  filePath: string;
  line: number;
};

export type CallGraphEdge = {
  fromId: string;
  toId: string;
  callText?: string;
  line?: number;
  kind?: string;       // Optional because values like "wiring" may appear
};
