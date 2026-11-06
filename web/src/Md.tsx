import { renderMarkdown } from "./markdown.ts";
import { sourceChips } from "./reviewNotes.ts";

/** Rendered markdown block. Its own module so PrGuide can use it without an
 * import cycle through PrViews. */
export function Md({ text, sources = false }: { text: string; sources?: boolean }) {
  const html = renderMarkdown(text);
  return <div className="md" dangerouslySetInnerHTML={{ __html: sources ? sourceChips(html) : html }} />;
}
