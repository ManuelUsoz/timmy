const blank = (line: string): boolean => line.trim() === '';

/**
 * The last lines of a Terminal's output, as a glance at what it is doing: the empty rows below the prompt are skipped,
 * blank lines between output lines are kept, and the padding at the end of each line is trimmed.
 */
export const previewLines = (lines: ReadonlyArray<string>, count = 4): ReadonlyArray<string> => {
  let end = lines.length;
  while (end > 0 && blank(lines[end - 1]!)) end--;
  return lines.slice(Math.max(0, end - count), end).map((line) => line.trimEnd());
};
