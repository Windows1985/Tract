import { Fragment, useMemo } from "react";
import katex from "katex";

// Renders AI-generated text: inline $...$ / display $$...$$ KaTeX, plus
// lightweight inline markdown (**bold**, *italic*, `code`) and line breaks.
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.math ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(p.value, {
                displayMode: p.display,
                throwOnError: false,
              }),
            }}
          />
        ) : (
          <Fragment key={i}>{renderInlineMarkdown(p.value)}</Fragment>
        )
      )}
    </span>
  );
}

// --- inline markdown ---------------------------------------------------------

const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let key = 0;
  for (const line of text.split("\n")) {
    if (key > 0) out.push(<br key={`br-${key++}`} />);
    for (const token of line.split(INLINE_RE)) {
      if (!token) continue;
      if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
        out.push(
          <strong key={key++} className="font-semibold">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (
        (token.startsWith("*") && token.endsWith("*") && token.length > 2) ||
        (token.startsWith("_") && token.endsWith("_") && token.length > 2)
      ) {
        out.push(<em key={key++}>{token.slice(1, -1)}</em>);
      } else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
        out.push(
          <code key={key++} className="rounded bg-ink/[0.07] px-1 py-0.5 font-mono text-[0.9em] dark:bg-ink-dark/10">
            {token.slice(1, -1)}
          </code>
        );
      } else {
        out.push(<Fragment key={key++}>{token}</Fragment>);
      }
    }
  }
  return out;
}

function splitMath(text: string): { value: string; math: boolean; display: boolean }[] {
  const out: { value: string; math: boolean; display: boolean }[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ value: text.slice(last, m.index), math: false, display: false });
    if (m[1] !== undefined) out.push({ value: m[1], math: true, display: true });
    else out.push({ value: m[2], math: true, display: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ value: text.slice(last), math: false, display: false });
  return out;
}
