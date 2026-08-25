import { renderMarkdown } from "./markdown.ts";

/** Rendered markdown block. Shared by the PR views and the guide view (it used
 * to live in PrViews; the guide needs it too and importing back would cycle). */
export function Md({ text }: { text: string }) {
  return (
    <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
  );
}
