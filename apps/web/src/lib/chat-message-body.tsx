import React, { Fragment } from "react";

/** Render a small, safe Markdown subset as React text; never interpret response HTML. */
function inline(text: string) {
  return text
    .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("`") && part.endsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}
export function ChatMessageBody({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push(
        <div className="abi-chat-code" key={i}>
          {language && <span>{language}</span>}
          <pre>
            <code>{code.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }
    const cells = (row: string) =>
      row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    const separator = lines[i + 1];
    if (
      line.includes("|") &&
      separator &&
      cells(separator).length > 1 &&
      cells(separator).every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      const headers = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|"))
        rows.push(cells(lines[i++]!));
      blocks.push(
        <div
          className="abi-chat-table"
          role="region"
          aria-label="Response table"
          tabIndex={0}
          key={i}
        >
          <table>
            <thead>
              <tr>
                {headers.map((cell, key) => (
                  <th key={key} scope="col">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, key) => (
                <tr key={key}>
                  {headers.map((_, cell) => (
                    <td key={cell}>{inline(row[cell] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h4 key={i}>{inline(heading[1]!)}</h4>);
      i++;
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.+)$/;
    const numbered = /^\s*\d+[.)]\s+(.+)$/;
    const pattern = bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
    if (pattern) {
      const items = [];
      while (i < lines.length) {
        const item = pattern.exec(lines[i]!);
        if (!item) break;
        items.push(<li key={i++}>{inline(item[1]!)}</li>);
      }
      blocks.push(pattern === bullet ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>);
      continue;
    }
    const paragraph = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i]!)
    )
      paragraph.push(lines[i++]!);
    blocks.push(<p key={i}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="abi-chat-prose">{blocks}</div>;
}
