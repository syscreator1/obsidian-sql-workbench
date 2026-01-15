import { formatJoinOnOnly, formatDerivedJoinBlocks } from "./joinOnFormatter";
import { mergeSelectTop } from "./selectTopFormatter";
import { moveSemicolonToOwnLine } from "./semicolonFormatter";

export function formatSqlAll(text: string, opts: { indentSize: number }) {
  const indent = " ".repeat(opts.indentSize);
  let t = text;
  t = formatJoinOnOnly(t, opts.indentSize);
  t = formatDerivedJoinBlocks(t, opts.indentSize);
  t = mergeSelectTop(t);
  t = moveSemicolonToOwnLine(t);

  return t;
}
