// Syntax highlighting for the diff view (#18): highlight.js core plus only the
// languages den's diffs hold, to keep the bundle small.
//
// A diff must stay one DOM row per line (the gutter, the tint, and the review
// column key off it), but highlighting line by line would lose anything that
// spans lines, like a block comment. So a file's hunk lines are highlighted as
// one text and the HTML is split back into lines, closing the open spans at
// each line end and reopening them on the next.
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import ruby from "highlight.js/lib/languages/ruby";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import erb from "highlight.js/lib/languages/erb";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import python from "highlight.js/lib/languages/python";

for (const [name, lang] of Object.entries({
  typescript, javascript, ruby, css, scss, erb, xml, yaml, json, markdown, bash, sql, python,
})) {
  hljs.registerLanguage(name, lang);
}

const BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  rb: "ruby", rake: "ruby", gemspec: "ruby",
  css: "css", scss: "scss",
  erb: "erb", html: "xml", xml: "xml", svg: "xml",
  yml: "yaml", yaml: "yaml",
  json: "json",
  md: "markdown",
  sh: "bash", bash: "bash", zsh: "bash",
  sql: "sql",
  py: "python",
};
const BY_NAME: Record<string, string> = { Gemfile: "ruby", Rakefile: "ruby", Dockerfile: "bash" };

/** The highlight.js language for a path, or null to leave it plain. */
export function languageFor(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXT[ext] ?? null;
}

/** Split highlight.js HTML into one balanced HTML string per source line. */
export function splitHighlighted(html: string): string[] {
  const out: string[] = [];
  const open: string[] = []; // the <span ...> tags open at this point
  let cur = "";
  for (const m of html.matchAll(/(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g)) {
    if (m[1]) {
      open.push(m[1]);
      cur += m[1];
    } else if (m[2]) {
      open.pop();
      cur += m[2];
    } else if (m[3]) {
      out.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else {
      cur += m[4];
    }
  }
  out.push(cur + "</span>".repeat(open.length));
  return out;
}

/** Lines past these sizes are left plain: a minified bundle or a huge
 * generated file costs more to highlight than it is worth reading. */
const MAX_LINES = 4000;
const MAX_LINE_CHARS = 1500;

/** Highlighted HTML for each line, or null to render the lines as plain text.
 * The HTML is escaped by highlight.js, so it is safe to set as innerHTML. */
export function highlightLines(lines: string[], language: string | null): string[] | null {
  if (!language || lines.length === 0 || lines.length > MAX_LINES) return null;
  if (lines.some((l) => l.length > MAX_LINE_CHARS)) return null;
  try {
    const html = hljs.highlight(lines.join("\n"), { language, ignoreIllegals: true }).value;
    const split = splitHighlighted(html);
    return split.length === lines.length ? split : null;
  } catch {
    return null;
  }
}
