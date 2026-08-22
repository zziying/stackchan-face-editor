// face.json document shape (schema v1). Kept intentionally loose: panels
// address fields by dotted path, and the C++ parser is the real validator.
export interface FaceDoc {
  version: number;
  meta?: { name?: string; author?: string };
  canvas: { width: number; height: number };
  palette: Record<string, string>;
  parts: Record<string, PartNode | undefined>;
  animation: PartNode;
  expressions?: Record<string, PartNode>;
  overlay?: PartNode;  // static top pixel layer (P6)
}

// Recursive bag of schema values. string[] admits sprite frame palettes.
export type PartNode = { [key: string]: number | string | boolean | string[] | PartNode };

export const EXPRESSIONS = ['happy', 'angry', 'sad', 'doubt', 'sleepy'] as const;
export type ExprName = (typeof EXPRESSIONS)[number];
export type Tab = 'base' | ExprName;

// WASM setExpression index; order fixed by the C++ enum.
export const EXPR_INDEX: Record<Tab, number> = {
  base: 0, happy: 1, angry: 2, sad: 3, doubt: 4, sleepy: 5,
};

export const PART_KEYS = ['eyeL', 'eyeR', 'browL', 'browR', 'mouth'] as const;
export type PartKey = (typeof PART_KEYS)[number];

export const MIRROR_PAIR: Partial<Record<PartKey, PartKey>> = {
  eyeL: 'eyeR', eyeR: 'eyeL', browL: 'browR', browR: 'browL',
};
