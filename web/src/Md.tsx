import { renderMarkdown } from "./markdown.ts";

/** Rendered markdown block. Its own module so PrGuide can use it without an
 * import cycle through PrViews. */
export function Md({ text }: { text: string }) {
  return (
    <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
  );
}
