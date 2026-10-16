import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="rounded bg-secondary px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function lines(text: string) {
  return text.split('\n').map((line, index, all) => (
    <Fragment key={index}>
      {inline(line)}
      {index < all.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

/**
 * An answer as the Agent wrote it: paragraphs, bulleted and numbered lists, **bold** and `code`.
 * Everything else is shown as plain text. It builds React elements from the text and never parses
 * HTML, so nothing the model returns can inject markup or a link.
 */
export function AnswerText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 wrap-break-word">
      {blocks.map((block, index) => {
        const rows = block.split('\n');
        if (rows.every((row) => BULLET.test(row))) {
          return (
            <ul key={index} className="ml-4 flex list-disc flex-col gap-1">
              {rows.map((row, rowIndex) => <li key={rowIndex}>{inline(row.replace(BULLET, ''))}</li>)}
            </ul>
          );
        }
        if (rows.every((row) => NUMBERED.test(row))) {
          return (
            <ol key={index} className="ml-4 flex list-decimal flex-col gap-1">
              {rows.map((row, rowIndex) => <li key={rowIndex}>{inline(row.replace(NUMBERED, ''))}</li>)}
            </ol>
          );
        }
        return <p key={index}>{lines(block)}</p>;
      })}
    </div>
  );
}
