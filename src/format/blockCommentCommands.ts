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

  // 選択終端が行頭ちょうどなら、その行は含めない（一般的）
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

  // 変更ズレ防止で後ろから処理
  const ranges = [...state.selection.ranges].sort((a, b) => b.from - a.from);

  for (const range of ranges) {
    // 選択なしならカーソル行
    const from = range.from;
    const to = range.to === range.from ? doc.lineAt(range.from).to : range.to;

    let { fromLine0, toLine0 } = getSelectedLineRange(view, from, to);
    let fromLineNum = fromLine0.number;
    let toLineNum = toLine0.number;

    // --- ★重要：選択範囲が /* や */ を含んでいたら、内側の範囲に寄せる ---
    // 例：先頭が /* 行ならそれを除外して内側を対象にする
    if (isOnlyBlockStartLine(fromLine0.text) && fromLineNum < doc.lines) {
      fromLineNum += 1;
      fromLine0 = doc.line(fromLineNum);
    }
    // 例：末尾が */ 行ならそれを除外して内側を対象にする
    if (isOnlyBlockEndLine(toLine0.text) && toLineNum > 1) {
      toLineNum -= 1;
      toLine0 = doc.line(toLineNum);
    }

    // 内側がなくなった（/* と */ だけ選んでた等）場合は、元の範囲で判定
    // → 「囲われているものを外す」動作を優先
    const innerExists = fromLineNum <= toLineNum;

    // 囲われ判定：
    // A) innerExists のとき：内側の前後に単独行 /* */ があるか
    // B) innerExists でない（/* と */ だけ等）のとき：選択範囲自体が包み行か
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
        // 追加で安全策：選択範囲の中に単独行 /* */ が “端” として存在する場合も unwrap 対象にする
        // （ユーザーが /* 行も一緒に選びがちなので）
        const firstLine = doc.line(fromLine0.number);
        const lastLine = doc.line(toLine0.number);

        // もし選択の最初が /* 行で、最後の次行が */ 行ならそれも囲いとみなす
        const maybeStartIsWrapper = isOnlyBlockStartLine(firstLine.text);
        const maybeEndIsWrapper = isOnlyBlockEndLine(lastLine.text);

        if (maybeStartIsWrapper && wrapEndLine === -1) {
          const afterLast = lastLine.number < doc.lines ? doc.line(lastLine.number + 1) : null;
          if (afterLast && isOnlyBlockEndLine(afterLast.text)) {
            wrapStartLine = firstLine.number;
            wrapEndLine = afterLast.number;
          }
        }

        // もし選択の最後が */ 行で、先頭の前行が /* 行ならそれも囲いとみなす
        if (maybeEndIsWrapper && wrapStartLine === -1) {
          const beforeFirst = firstLine.number > 1 ? doc.line(firstLine.number - 1) : null;
          if (beforeFirst && isOnlyBlockStartLine(beforeFirst.text)) {
            wrapStartLine = beforeFirst.number;
            wrapEndLine = lastLine.number;
          }
        }

        // もし選択範囲の最初が /* かつ最後が */ なら（包み行ごと選択）
        if (maybeStartIsWrapper && maybeEndIsWrapper) {
          wrapStartLine = firstLine.number;
          wrapEndLine = lastLine.number;
        }
      }
    } else {
      // innerExists = false：包み行だけ選択している等
      const firstLine = doc.line(fromLine0.number);
      const lastLine = doc.line(toLine0.number);

      if (isOnlyBlockStartLine(firstLine.text) && isOnlyBlockEndLine(lastLine.text)) {
        wrapStartLine = firstLine.number;
        wrapEndLine = lastLine.number;
      }
    }

    const wrapped = wrapStartLine !== -1 && wrapEndLine !== -1;

    if (wrapped) {
      // unwrap：wrapStartLine と wrapEndLine を削除
      const startLine = doc.line(wrapStartLine);
      const endLine = doc.line(wrapEndLine);

      // startLine：行全体 + 改行（次行頭まで）
      const startFrom = startLine.from;
      const startTo = wrapStartLine < doc.lines ? doc.line(wrapStartLine + 1).from : startLine.to;

      // endLine：行頭から次行頭まで（最終行なら末尾まで）
      const endFrom = endLine.from;
      const endTo = wrapEndLine < doc.lines ? doc.line(wrapEndLine + 1).from : endLine.to;

      // 後ろから消す（changes は後ろ優先だけど同range内でも安全に）
      changes.push({ from: endFrom, to: endTo, insert: "" });
      changes.push({ from: startFrom, to: startTo, insert: "" });
    } else {
      // wrap：元の選択（ユーザーが /* */ 行も含めてたら inner に寄せた範囲）に対して包む
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
