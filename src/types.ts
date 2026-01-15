export type NodeKind =
  | "function"
  | "method"
  | "arrow"
  | "functionExpression";

export type CodeNode = {
  id: string;              // 一意ID（例: file#QualifiedName）
  name: string;            // 表示名（例: Plugin.onload / Foo.bar）
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
  kind: string;        // "function" | "method" | "arrow" など。まずは string でOK
  filePath: string;
  line: number;
};

export type CallGraphEdge = {
  fromId: string;
  toId: string;
  callText?: string;
  line?: number;
  kind?: string;       // "wiring" が入る可能性があるので optional
};

