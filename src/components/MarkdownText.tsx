import React from 'react';

interface MarkdownTextProps {
  content: string;
  className?: string;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches: [label](url), `code`, **bold**, *italic*, or bare https:// URLs
  const regex =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|(https?:\/\/[^\s<)]+))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={key++}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--sf-accent)] underline underline-offset-4 decoration-[var(--sf-accent)]/40 hover:decoration-current transition-colors break-words"
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 text-[12px] font-mono bg-[var(--sf-surface-muted)] border border-[var(--sf-border)] rounded text-[var(--sf-text)]"
        >
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      nodes.push(
        <strong key={key++} className="font-semibold text-[var(--sf-text)]">
          {match[5]}
        </strong>
      );
    } else if (match[6]) {
      nodes.push(
        <em key={key++} className="italic">
          {match[6]}
        </em>
      );
    } else if (match[7]) {
      const cleanUrl = match[7].replace(/[.,;:!?]+$/, '');
      const trailing = match[7].slice(cleanUrl.length);
      nodes.push(
        <a
          key={key++}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--sf-accent)] underline underline-offset-4 decoration-[var(--sf-accent)]/40 hover:decoration-current transition-colors break-all"
        >
          {cleanUrl}
        </a>
      );
      if (trailing) nodes.push(trailing);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function MarkdownText({ content, className = '' }: MarkdownTextProps) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // Split fenced code blocks first
  const blocks: { type: 'code' | 'text'; value: string }[] = [];
  const fenceRegex = /```[\w-]*\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(trimmed)) !== null) {
    if (match.index > lastIdx) {
      blocks.push({ type: 'text', value: trimmed.slice(lastIdx, match.index) });
    }
    blocks.push({ type: 'code', value: match[1].replace(/\n$/, '') });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < trimmed.length) {
    blocks.push({ type: 'text', value: trimmed.slice(lastIdx) });
  }

  return (
    <div className={`space-y-3 text-[13.5px] leading-[1.7] text-[var(--sf-text-secondary)] ${className}`}>
      {blocks.map((block, bIdx) => {
        if (block.type === 'code') {
          return (
            <pre
              key={bIdx}
              className="p-3.5 overflow-x-auto text-[12px] font-mono leading-relaxed bg-[var(--sf-surface-muted)] border border-[var(--sf-border)] rounded text-[var(--sf-text)]"
            >
              <code>{block.value}</code>
            </pre>
          );
        }

        const paragraphs = block.value
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean);

        return paragraphs.map((para, pIdx) => {
          const lines = para.split('\n');
          const isQuote = lines.every((l) => l.trim().startsWith('>'));
          if (isQuote) {
            const quoteText = lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n');
            return (
              <blockquote
                key={`${bIdx}-${pIdx}`}
                className="px-3.5 py-2.5 bg-[var(--sf-surface-muted)] border border-[var(--sf-border)] rounded text-[var(--sf-text-secondary)] italic whitespace-pre-line"
              >
                {renderInline(quoteText)}
              </blockquote>
            );
          }

          const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l));
          if (isList) {
            return (
              <ul key={`${bIdx}-${pIdx}`} className="space-y-1.5 pl-4 list-disc marker:text-[var(--sf-text-muted)]">
                {lines.map((line, lIdx) => (
                  <li key={lIdx}>{renderInline(line.replace(/^\s*[-*•]\s+/, ''))}</li>
                ))}
              </ul>
            );
          }

          if (/^#{1,3}\s+/.test(para)) {
            const headingText = para.replace(/^#{1,3}\s+/, '');
            return (
              <h4
                key={`${bIdx}-${pIdx}`}
                className="text-[14px] font-semibold text-[var(--sf-text)] pt-1"
              >
                {renderInline(headingText)}
              </h4>
            );
          }

          return (
            <p key={`${bIdx}-${pIdx}`} className="whitespace-pre-line break-words">
              {renderInline(para)}
            </p>
          );
        });
      })}
    </div>
  );
}
