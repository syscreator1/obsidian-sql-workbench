import type { EditorView } from "@codemirror/view";
import { StateCommand } from "@codemirror/state";

const LINE_PREFIX = "--";

function isBlank(s: string) {
  return /^\s*$/.test(s);
}

function isLineCommented(text: string): boolean {
  // Line starts with "--" (new rule)
  if (text.startsWith(LINE_PREFIX)) return true;

  // Also support the legacy rule ("--" after indentation) so we can still uncomment old-style lines
  const m = text.match(/^\s*/);
  const wsLen = m ? m[0].length : 0;
  return text.slice(wsLen).startsWith(LINE_PREFIX);
}

function removeLinePrefix(text: string): string {
  // 1) Remove leading "--"
  if (text.startsWith(LINE_PREFIX)) {
    let rest = text.slice(LINE_PREFIX.length);
    if (rest.startsWith(" ")) rest = rest.slice(1);
    return rest;
  }

  // 2) Also remove the legacy form ("--" after indentation)
  const m = text.match(/^\s*/);
  const ws = m ? m[0] : "";
  let rest = text.slice(ws.length);

  if (!rest.startsWith(LINE_PREFIX)) return text;

  rest = rest.slice(LINE_PREFIX.length);
  if (rest.startsWith(" ")) rest = rest.slice(1);
  return ws + rest;
}

function addLinePrefixAtLineHead(text: string): string {
  if (isBlank(text)) return text; // Keep blank lines as-is (feel free to change this if you prefer)
  return `${LINE_PREFIX} ${text}`;
}

/**
 * Toggle "--" line comments for lines covered by the current selection
 */
export const toggleSqlLineComment: StateCommand = (view: EditorView) => {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;

    // If range.to is exactly at a line start, exclude that line (common editor behavior)
    const toLineAdjusted =
      range.to === state.doc.line(toLine).from && toLine > fromLine ? toLine - 1 : toLine;

    // Toggle decision: if all non-blank lines are already commented, uncomment; otherwise comment
    let allCommented = true;
    for (let n = fromLine; n <= toLineAdjusted; n++) {
      const line = state.doc.line(n);
      const text = line.text;
      if (isBlank(text)) continue;
      if (!isLineCommented(text)) {
        allCommented = false;
        break;
      }
    }

    for (let n = fromLine; n <= toLineAdjusted; n++) {
      const line = state.doc.line(n);
      const text = line.text;

      const newText = allCommented ? removeLinePrefix(text) : addLinePrefixAtLineHead(text);

      if (newText !== text) {
        changes.push({ from: line.from, to: line.to, insert: newText });
      }
    }
  }

  if (changes.length === 0) return true;

  view.dispatch({ changes });
  return true;
};
