"use client";

import { Fragment, type ReactNode } from "react";

interface MarkdownTextProps {
  text: string;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-inline-${index++}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a href={link[2]} key={key} rel="noreferrer" target="_blank">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = start + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isSpecialLine(line: string): boolean {
  return (
    /^(#{1,6})\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*([-*_])\1{2,}\s*$/.test(line)
  );
}

function renderTextBlock(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let index = 0;
  let block = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const key = `${keyPrefix}-block-${block++}`;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 4);
      nodes.push(
        <h3 className={`md-heading md-heading-${level}`} key={key}>
          {renderInline(heading[2] ?? "", key)}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      nodes.push(<hr key={key} />);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        const raw = (lines[index] ?? "").replace(/^\s*[-*]\s+/, "");
        const itemKey = `${key}-item-${items.length}`;
        const taskItem = /^\[([ xX])]\s+(.*)$/.exec(raw);
        items.push(
          <li key={itemKey}>
            {taskItem ? (
              <span className={`md-check${taskItem[1]?.toLowerCase() === "x" ? " checked" : ""}`}>
                {taskItem[1]?.toLowerCase() === "x" ? "✓" : ""}
              </span>
            ) : null}
            {renderInline(taskItem ? (taskItem[2] ?? "") : raw, itemKey)}
          </li>,
        );
        index += 1;
      }
      nodes.push(<ul key={key}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        const raw = (lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, "");
        const itemKey = `${key}-item-${items.length}`;
        items.push(<li key={itemKey}>{renderInline(raw, itemKey)}</li>);
        index += 1;
      }
      nodes.push(<ol key={key}>{items}</ol>);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      nodes.push(<blockquote key={key}>{renderInline(quoted.join("\n"), key)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim() || isSpecialLine(current)) break;
      paragraph.push(current);
      index += 1;
    }
    nodes.push(
      <p key={key}>
        {paragraph.map((part, partIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraph lines are static text, never reordered
          <Fragment key={`${key}-line-${partIndex}`}>
            {partIndex > 0 ? <br /> : null}
            {renderInline(part, `${key}-line-${partIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return nodes;
}

export function MarkdownText({ text }: MarkdownTextProps) {
  const blocks: ReactNode[] = [];
  const pattern = /```([\w+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    const start = match.index;
    if (start > last) {
      blocks.push(...renderTextBlock(text.slice(last, start), `md-${index++}`));
    }
    const language = match[1] ?? "";
    blocks.push(
      <pre className="md-pre" key={`md-code-${index++}`}>
        <code className={language ? `language-${language}` : undefined}>{match[2] ?? ""}</code>
      </pre>,
    );
    last = start + match[0].length;
    match = pattern.exec(text);
  }

  if (last < text.length) {
    blocks.push(...renderTextBlock(text.slice(last), `md-${index++}`));
  }

  return <div className="markdown-text">{blocks.length > 0 ? blocks : text}</div>;
}
