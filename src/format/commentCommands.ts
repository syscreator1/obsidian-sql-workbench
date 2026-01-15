import type { EditorView } from "@codemirror/view";
import { StateCommand } from "@codemirror/state";

const LINE_PREFIX = "--";

function isBlank(s: string) {
  return /^\s*$/.test(s);
}

function isLineCommented(text: string): boolean {
  // 行頭に -- がある（今回の新ルール）
  if (text.startsWith(LINE_PREFIX)) return true;

  // 旧ルール（インデント後ろに --）にも一応対応してアンコメントできるようにする
  const m = text.match(/^\s*/);
  const wsLen = m ? m[0].length : 0;
  return text.slice(wsLen).startsWith(LINE_PREFIX);
}

function removeLinePrefix(text: string): string {
  // 1) 行頭 -- を外す
  if (text.startsWith(LINE_PREFIX)) {
    let rest = text.slice(LINE_PREFIX.length);
    if (rest.startsWith(" ")) rest = rest.slice(1);
    return rest;
  }

  // 2) 旧形式（インデント後ろ --）も外せるようにする
  const m = text.match(/^\s*/);
  const ws = m ? m[0] : "";
  let rest = text.slice(ws.length);

  if (!rest.startsWith(LINE_PREFIX)) return text;

  rest = rest.slice(LINE_PREFIX.length);
  if (rest.startsWith(" ")) rest = rest.slice(1);
  return ws + rest;
}

function addLinePrefixAtLineHead(text: string): string {
  if (isBlank(text)) return text; // 空行はそのまま（好みで変えてOK）
  return `${LINE_PREFIX} ${text}`;
}

/**
 * 選択範囲にかかる行を -- コメントの付け外し（トグル）
 */
export const toggleSqlLineComment: StateCommand = (view: EditorView) => {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;

    // range.to が行頭ちょうどの場合、その行は含めない（一般的な挙動）
    const toLineAdjusted =
      range.to === state.doc.line(toLine).from && toLine > fromLine ? toLine - 1 : toLine;

    // トグル判定：空行以外が全部コメント済みならアンコメント、そうでなければコメント
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

