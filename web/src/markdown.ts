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

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split("\n");
  let html = "";
  let inCode = false;
  let inList = false;
  const closeList = () => {
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
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(bullet[1])}</li>`;
    } else if (raw.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(raw)}</p>`;
    }
  }
  if (inCode) html += "</pre>";
  closeList();
  return html;
}
