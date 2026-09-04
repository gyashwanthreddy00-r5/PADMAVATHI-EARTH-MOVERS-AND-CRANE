export interface SStyleRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface SRichTextBlock {
  type: 'paragraph' | 'bullet' | 'numbered';
  runs: SStyleRun[];
}

export function richTextToPlainTextServer(html: string | null | undefined): string {
  if (!html) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '')
    .replace(/<b[^>]*>/gi, '')
    .replace(/<\/b>/gi, '')
    .replace(/<strong[^>]*>/gi, '')
    .replace(/<\/strong>/gi, '')
    .replace(/<i[^>]*>/gi, '')
    .replace(/<\/i>/gi, '')
    .replace(/<em[^>]*>/gi, '')
    .replace(/<\/em>/gi, '')
    .replace(/<u[^>]*>/gi, '')
    .replace(/<\/u>/gi, '')
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<p[^>]*>/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
  while (text.includes('\n\n\n')) text = text.replace(/\n\n\n/g, '\n\n');
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

export function parseRichTextServer(html: string | null | undefined): SRichTextBlock[] {
  if (!html || !html.trim()) return [];
  const blocks: SRichTextBlock[] = [];

  const decodeEntities = (s: string): string =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ');

  const stripTags = (s: string): string =>
    decodeEntities(s.replace(/<[^>]*>/g, ''));

  const extractRuns = (segment: string): SStyleRun[] => {
    const runs: SStyleRun[] = [];
    const tagPattern = /<(\/?)(b|strong|i|em|u)([^>]*)>/gi;
    let lastIndex = 0;
    const stack: { bold: boolean; italic: boolean; underline: boolean }[] = [{ bold: false, italic: false, underline: false }];
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(segment)) !== null) {
      if (match.index > lastIndex) {
        const text = decodeEntities(segment.slice(lastIndex, match.index));
        if (text) {
          const current = stack[stack.length - 1];
          runs.push({ text, bold: current.bold, italic: current.italic, underline: current.underline });
        }
      }
      const isClosing = match[1] === '/';
      const tag = match[2].toLowerCase();
      if (isClosing && stack.length > 1) {
        stack.pop();
      } else if (!isClosing) {
        const current = stack[stack.length - 1];
        stack.push({
          bold: current.bold || tag === 'b' || tag === 'strong',
          italic: current.italic || tag === 'i' || tag === 'em',
          underline: current.underline || tag === 'u',
        });
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < segment.length) {
      const text = decodeEntities(segment.slice(lastIndex));
      if (text) {
        const current = stack[stack.length - 1];
        runs.push({ text, bold: current.bold, italic: current.italic, underline: current.underline });
      }
    }
    return runs.length ? runs : [{ text: stripTags(segment), bold: false, italic: false, underline: false }];
  };

  const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br']);

  interface Token {
    type: 'text' | 'block-open' | 'block-close' | 'inline' | 'inline-close';
    tag?: string;
    content?: string;
  }

  const tokenize = (htmlStr: string): Token[] => {
    const tokens: Token[] = [];
    const tagRe = /<\/?([a-z][a-z0-9]*)[^>]*>/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(htmlStr)) !== null) {
      if (m.index > last) {
        const text = htmlStr.slice(last, m.index);
        if (text.trim()) tokens.push({ type: 'text', content: text });
      }
      const fullTag = m[0];
      const tagName = m[1].toLowerCase();
      const isClosing = fullTag.startsWith('</');
      if (tagName === 'br') {
        tokens.push({ type: 'block-open', tag: 'br' });
        tokens.push({ type: 'block-close', tag: 'br' });
      } else if (BLOCK_TAGS.has(tagName)) {
        tokens.push({ type: isClosing ? 'block-close' : 'block-open', tag: tagName });
      } else {
        tokens.push({ type: isClosing ? 'inline-close' : 'inline', tag: tagName, content: fullTag });
      }
      last = m.index + fullTag.length;
    }
    if (last < htmlStr.length) {
      const text = htmlStr.slice(last);
      if (text.trim()) tokens.push({ type: 'text', content: text });
    }
    return tokens;
  };

  const listStack: string[] = [];
  let inlineBuffer = '';

  const flushInline = (): void => {
    const trimmed = inlineBuffer.trim();
    if (trimmed) {
      const inList = listStack.length > 0 && listStack[listStack.length - 1] === 'li';
      const listType = listStack.find((t) => t === 'ul' || t === 'ol');
      if (inList && listType) {
        const blockType = listType === 'ul' ? 'bullet' : 'numbered';
        const runs = extractRuns(trimmed);
        const text = runs.map((r) => r.text).join('').trim();
        if (text) blocks.push({ type: blockType, runs });
      } else {
        const runs = extractRuns(trimmed);
        const text = runs.map((r) => r.text).join('').trim();
        if (text) blocks.push({ type: 'paragraph', runs });
      }
    }
    inlineBuffer = '';
  };

  const tokens = tokenize(html);

  for (const token of tokens) {
    if (token.type === 'text') {
      inlineBuffer += token.content;
    } else if (token.type === 'inline' || token.type === 'inline-close') {
      if (token.content) inlineBuffer += token.content;
    } else if (token.type === 'block-open') {
      if (token.tag === 'br') {
        flushInline();
      } else if (token.tag === 'ul' || token.tag === 'ol') {
        flushInline();
        listStack.push(token.tag);
      } else if (token.tag === 'li') {
        flushInline();
        listStack.push('li');
      } else {
        flushInline();
      }
    } else if (token.type === 'block-close') {
      if (token.tag === 'br') {
        flushInline();
      } else if (token.tag === 'ul' || token.tag === 'ol') {
        flushInline();
        const idx = listStack.lastIndexOf(token.tag);
        if (idx >= 0) listStack.splice(idx);
      } else if (token.tag === 'li') {
        flushInline();
        const idx = listStack.lastIndexOf('li');
        if (idx >= 0) listStack.splice(idx);
      } else {
        flushInline();
      }
    }
  }
  flushInline();

  if (blocks.length === 0) {
    const plain = stripTags(html).split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of plain) {
      const isBullet = /^[•*-]\s/.test(line);
      blocks.push({
        type: isBullet ? 'bullet' : 'paragraph',
        runs: [{ text: isBullet ? line.replace(/^[•*-]\s*/, '') : line, bold: false, italic: false, underline: false }],
      });
    }
  }

  return blocks;
}
