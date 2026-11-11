import type { PrSize } from "../../shared/fileKind.ts";

/** A PR's implementation lines, with "*" when tests, docs, or generated files
 * make the total bigger (the full total is in the hover tip). */
export function SizeCount({ size, files }: { size: PrSize; files?: number }) {
  const left = size.implAdditions !== size.additions || size.implDeletions !== size.deletions;
  const fileNote = files ? `${files} files. ` : "";
  const tip = size.partial
    ? `${fileNote}Over 100 files, so tests, docs, and generated files are counted too.`
    : left
      ? `${fileNote}+${size.additions} −${size.deletions} in all; tests, docs, and generated files left out.`
      : `${fileNote}All implementation.`;
  return (
    <span className="pr-size" title={tip}>
      +{size.implAdditions} −{size.implDeletions}
      {left && "*"}
    </span>
  );
}
