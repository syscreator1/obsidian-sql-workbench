import type { EditorView } from "@codemirror/view";
import { StateCommand } from "@codemirror/state";

const BLOCK_START = "/*";
const BLOCK_END = "*/";

function isOnlyBlockStartLine(s: string) {
  return /^\s*\/\*\s*$/.test(s);
}
function isOnlyBlockEndLine(s: string) {
  return /^\s*\*\/\s*$/.test(s);
}

function getSelectedLineRange(view: EditorView, from: number, to: number) {
  const doc = view.state.doc;
  const fromLine0 = doc.lineAt(from);
  const toLine0 = doc.lineAt(to);

  // If the selection ends exactly at the start of a line, do not include that line (common behavior)
  const toLine =
    to === toLine0.from && toLine0.number > fromLine0.number
      ? doc.line(toLine0.number - 1)
      : toLine0;

  return { fromLine0, toLine0: toLine };
}

export const toggleSqlBlockCommentLines: StateCommand = (view: EditorView) => {
  const { state } = view;
  const doc = state.doc;

  const changes: { from: number; to: number; insert: string }[] = [];

  // Process from the end to avoid position shifts
  const ranges = [...state.selection.ranges].sort((a, b) => b.from - a.from);

  for (const range of ranges) {
    // If there is no selection, use the cursor line
    const from = range.from;
    const to = range.to === range.from ? doc.lineAt(range.from).to : range.to;

    let { fromLine0, toLine0 } = getSelectedLineRange(view, from, to);
    let fromLineNum = fromLine0.number;
    let toLineNum = toLine0.number;

    // --- ★Important: if the selection includes "/*" or "*/", shift to the inner range ---
    // Example: if the first selected line is "/*", exclude it and target the inner lines
    if (isOnlyBlockStartLine(fromLine0.text) && fromLineNum < doc.lines) {
      fromLineNum += 1;
      fromLine0 = doc.line(fromLineNum);
    }
    // Example: if the last selected line is "*/", exclude it and target the inner lines
    if (isOnlyBlockEndLine(toLine0.text) && toLineNum > 1) {
      toLineNum -= 1;
      toLine0 = doc.line(toLineNum);
    }

    // If the inner range disappears (e.g. only "/*" and "*/" were selected), fall back to the original range
    // → Prefer the "unwrap if already wrapped" behavior
    const innerExists = fromLineNum <= toLineNum;

    // Wrapped detection:
    // A) When innerExists: check whether the inner range is surrounded by standalone "/*" and "*/" lines
    // B) When innerExists is false (e.g. only wrapper lines): check whether the selected range itself is wrapper lines
    let wrapStartLine = -1;
    let wrapEndLine = -1;

    if (innerExists) {
      const hasPrev = fromLineNum > 1;
      const hasNext = toLineNum < doc.lines;

      const prevLine = hasPrev ? doc.line(fromLineNum - 1) : null;
      const nextLine = hasNext ? doc.line(toLineNum + 1) : null;

      if (prevLine && nextLine && isOnlyBlockStartLine(prevLine.text) && isOnlyBlockEndLine(nextLine.text)) {
        wrapStartLine = prevLine.number;
        wrapEndLine = nextLine.number;
      } else {
        // Additional safety: also treat it as wrapped if standalone wrapper lines exist at the "edges"
        // (Users often select the wrapper lines too)
        const firstLine = doc.line(fromLine0.number);
        const lastLine = doc.line(toLine0.number);

        // If the selection starts with "/*" and the line after the last line is "*/", treat it as wrapped
        const maybeStartIsWrapper = isOnlyBlockStartLine(firstLine.text);
        const maybeEndIsWrapper = isOnlyBlockEndLine(lastLine.text);

        if (maybeStartIsWrapper && wrapEndLine === -1) {
          const afterLast = lastLine.number < doc.lines ? doc.line(lastLine.number + 1) : null;
          if (afterLast && isOnlyBlockEndLine(afterLast.text)) {
            wrapStartLine = firstLine.number;
            wrapEndLine = afterLast.number;
          }
        }

        // If the selection ends with "*/" and the line before the first line is "/*", treat it as wrapped
        if (maybeEndIsWrapper && wrapStartLine === -1) {
          const beforeFirst = firstLine.number > 1 ? doc.line(firstLine.number - 1) : null;
          if (beforeFirst && isOnlyBlockStartLine(beforeFirst.text)) {
            wrapStartLine = beforeFirst.number;
            wrapEndLine = lastLine.number;
          }
        }

        // If the selection includes both "/*" and "*/" as the first/last lines (wrapper lines are selected)
        if (maybeStartIsWrapper && maybeEndIsWrapper) {
          wrapStartLine = firstLine.number;
          wrapEndLine = lastLine.number;
        }
      }
    } else {
      // innerExists = false: e.g. only wrapper lines are selected
      const firstLine = doc.line(fromLine0.number);
      const lastLine = doc.line(toLine0.number);

      if (isOnlyBlockStartLine(firstLine.text) && isOnlyBlockEndLine(lastLine.text)) {
        wrapStartLine = firstLine.number;
        wrapEndLine = lastLine.number;
      }
    }

    const wrapped = wrapStartLine !== -1 && wrapEndLine !== -1;

    if (wrapped) {
      // Unwrap: delete wrapStartLine and wrapEndLine
      const startLine = doc.line(wrapStartLine);
      const endLine = doc.line(wrapEndLine);

      // startLine: entire line + newline (until the start of the next line)
      const startFrom = startLine.from;
      const startTo = wrapStartLine < doc.lines ? doc.line(wrapStartLine + 1).from : startLine.to;

      // endLine: from line start to next line start (or to end if it's the last line)
      const endFrom = endLine.from;
      const endTo = wrapEndLine < doc.lines ? doc.line(wrapEndLine + 1).from : endLine.to;

      // Delete from the end first (ranges are processed backwards, but do it safely within this selection too)
      changes.push({ from: endFrom, to: endTo, insert: "" });
      changes.push({ from: startFrom, to: startTo, insert: "" });
    } else {
      // Wrap: wrap the target range (if wrapper lines were selected, we already shifted to the inner range)
      const targetFromLine = innerExists ? fromLine0 : doc.lineAt(from).number ? doc.line(fromLine0.number) : fromLine0;
      const targetToLine = innerExists ? toLine0 : toLine0;

      changes.push({ from: targetToLine.to, to: targetToLine.to, insert: "\n*/" });
      changes.push({ from: targetFromLine.from, to: targetFromLine.from, insert: "/*\n" });
    }
  }

  if (changes.length === 0) return true;
  view.dispatch({ changes });
  return true;
};
