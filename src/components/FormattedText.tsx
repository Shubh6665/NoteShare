import React, { useMemo } from 'react';

/**
 * Lightweight Markdown-ish renderer.
 * Parses: code blocks, headings, bold, bullets, horizontal rules.
 * Everything is React elements — zero innerHTML, zero XSS risk.
 * Only used when plainText mode is OFF.
 */

interface Props {
  content: string;
}

interface Block {
  type: 'code' | 'text';
  lang?: string;
  content: string;
}

function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before this code block
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    // The code block itself
    blocks.push({ type: 'code', lang: match[1] || '', content: match[2].replace(/\n$/, '') });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    blocks.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return blocks;
}

function renderInlineMarkdown(text: string, key: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match **bold** patterns
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part) {
      nodes.push(<span key={`${key}-${i}`}>{part}</span>);
    }
  });
  return nodes;
}

function renderTextBlock(text: string, blockKey: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const key = `${blockKey}-${i}`;

    // Horizontal rule
    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      elements.push(<hr key={key} className="fmt-hr" />);
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      elements.push(<div key={key} className="fmt-h3">{renderInlineMarkdown(trimmed.slice(4), key)}</div>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<div key={key} className="fmt-h2">{renderInlineMarkdown(trimmed.slice(3), key)}</div>);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(<div key={key} className="fmt-h1">{renderInlineMarkdown(trimmed.slice(2), key)}</div>);
      continue;
    }

    // Bullet points
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      elements.push(
        <div key={key} className="fmt-bullet">
          <span className="fmt-bullet-dot">•</span>
          <span>{renderInlineMarkdown(trimmed.slice(2), key)}</span>
        </div>
      );
      continue;
    }

    // Empty line = paragraph break
    if (trimmed === '') {
      elements.push(<div key={key} className="fmt-break" />);
      continue;
    }

    // Regular line with inline markdown
    elements.push(<div key={key} className="fmt-line">{renderInlineMarkdown(line, key)}</div>);
  }

  return elements;
}

export const FormattedText = React.memo(function FormattedText({ content }: Props) {
  const rendered = useMemo(() => {
    if (!content) return null;

    const blocks = splitIntoBlocks(content);

    return blocks.map((block, i) => {
      if (block.type === 'code') {
        return (
          <div key={`block-${i}`} className="fmt-code-block">
            {block.lang && <div className="fmt-code-lang">{block.lang}</div>}
            <pre className="fmt-code-pre"><code>{block.content}</code></pre>
          </div>
        );
      }
      return <div key={`block-${i}`}>{renderTextBlock(block.content, `b${i}`)}</div>;
    });
  }, [content]);

  return <div className="formatted-text">{rendered}</div>;
});
