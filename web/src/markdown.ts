// Minimal, safe markdown -> HTML (headings, lists, bold/italic/code, links).
// Content is HTML-escaped first, so rendered output can't inject markup.
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

/** A line that begins a block of its own, so it must never be swallowed as the
 * continuation of the paragraph above it. Bullets, headings and fences are
 * matched separately; these are the shapes this renderer draws as a paragraph
 * but which a reader still reads as a new item (numbered lists most of all). */
const NEW_BLOCK = /^\s*(?:\d+[.)]\s|>|\||\s{4,}\S)/;

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split("\n");
  let html = "";
  let inCode = false;
  let inList = false;
  // The paragraph or list item being built. Markdown treats a single newline as
  // a soft break, so wrapped prose joins its paragraph and a wrapped bullet
  // stays inside its <li> instead of escaping the list — which matters most for
  // the review and its reading guide, both hard-wrapped prose.
  let pending: { kind: "p" | "li"; text: string } | null = null;

  const flush = () => {
    if (!pending) return;
    const { kind, text } = pending;
    pending = null;
    if (kind === "li") {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(text)}</li>`;
    } else {
      html += `<p>${inline(text)}</p>`;
    }
  };
  const closeList = () => {
    flush();
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        html += "</pre>";
        inCode = false;
      } else {
        closeList();
        html += "<pre>";
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html += raw + "\n";
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) {
      closeList();
      html += "<hr>";
      continue;
    }
    const heading = raw.match(/^(#{1,4})\s+(.*)$/);
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    if (heading) {
      closeList();
      const lvl = heading[1].length;
      html += `<h${lvl}>${inline(heading[2])}</h${lvl}>`;
    } else if (bullet) {
      flush();
      pending = { kind: "li", text: bullet[1] };
    } else if (raw.trim() === "") {
      closeList();
    } else if (pending && !NEW_BLOCK.test(raw)) {
      // Soft line break: continue whatever block is open.
      pending.text += ` ${raw.trim()}`;
    } else {
      closeList();
      pending = { kind: "p", text: raw };
    }
  }
  if (inCode) html += "</pre>";
  closeList();
  return html;
}
