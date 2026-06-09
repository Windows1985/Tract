import { useMemo } from "react";
import katex from "katex";

// Renders text with inline $...$ and display $$...$$ KaTeX segments.
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
          <span key={i}>{p.value}</span>
        )
      )}
    </span>
  );
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
