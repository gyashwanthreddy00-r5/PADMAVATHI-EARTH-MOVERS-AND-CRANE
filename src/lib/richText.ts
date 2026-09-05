export interface StyleRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface RichTextBlock {
  type: 'paragraph' | 'bullet' | 'numbered';
  runs: StyleRun[];
}

const BLOCK_TAGS = new Set(['div', 'p', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function parseRichText(html: string | null | undefined): RichTextBlock[] {
  if (!html || !html.trim()) return [];
  const cleaned = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, 'text/html');
  const blocks: RichTextBlock[] = [];

  const collectRuns = (node: ChildNode): StyleRun[] => {
    const runs: StyleRun[] = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text) runs.push({ text, bold: false, italic: false, underline: false });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (BLOCK_TAGS.has(tag)) return;
      const bold = tag === 'b' || tag === 'strong';
      const italic = tag === 'i' || tag === 'em';
      const underline = tag === 'u';
      const innerRuns = collectRuns(el);
      innerRuns.forEach((r) => {
        runs.push({ text: r.text, bold: r.bold || bold, italic: r.italic || italic, underline: r.underline || underline });
      });
    });
    return runs;
  };

  const flushInline = (runs: StyleRun[]): void => {
    const text = runs.map((r) => r.text).join('').replace(/\u00a0/g, ' ').trim();
    if (text) blocks.push({ type: 'paragraph', runs });
  };

  const processNode = (el: Element): void => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul') {
      el.querySelectorAll(':scope > li').forEach((li) => {
        const runs = collectRuns(li);
        const text = runs.map((r) => r.text).join('').replace(/\u00a0/g, ' ').trim();
        if (text) blocks.push({ type: 'bullet', runs });
      });
      return;
    }
    if (tag === 'ol') {
      el.querySelectorAll(':scope > li').forEach((li) => {
        const runs = collectRuns(li);
        const text = runs.map((r) => r.text).join('').replace(/\u00a0/g, ' ').trim();
        if (text) blocks.push({ type: 'numbered', runs });
      });
      return;
    }
    if (tag === 'br') return;

    let inlineRuns: StyleRun[] = [];
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (text) inlineRuns.push({ text, bold: false, italic: false, underline: false });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as Element;
        const childTag = childEl.tagName.toLowerCase();
        if (BLOCK_TAGS.has(childTag)) {
          flushInline(inlineRuns);
          inlineRuns = [];
          processNode(childEl);
        } else {
          const childRuns = collectRuns(childEl);
          inlineRuns.push(...childRuns);
        }
      }
    });
    flushInline(inlineRuns);
  };

  doc.body.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      if (text) blocks.push({ type: 'paragraph', runs: [{ text, bold: false, italic: false, underline: false }] });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      processNode(child as Element);
    }
  });

  if (blocks.length === 0) {
    const text = doc.body.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
    if (text) {
      const lines = text.split('\n').filter((l) => l.trim());
      lines.forEach((line) => {
        const isBullet = line.trim().startsWith('•') || line.trim().startsWith('*') || line.trim().startsWith('-');
        blocks.push({
          type: isBullet ? 'bullet' : 'paragraph',
          runs: [{ text: line.replace(/^[•*-]\s*/, ''), bold: false, italic: false, underline: false }],
        });
      });
    }
  }

  return blocks;
}

export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html.replace(/\r\n/g, '\n'), 'text/html');
  const lines: string[] = [];

  const processList = (el: Element, marker: string): void => {
    el.querySelectorAll(':scope > li').forEach((li) => {
      lines.push(`${marker} ${li.textContent?.trim() ?? ''}`);
    });
  };

  doc.body.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').trim();
      if (text) lines.push(text);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'ul') processList(el, '•');
      else if (tag === 'ol') el.querySelectorAll(':scope > li').forEach((li, i) => lines.push(`${i + 1}. ${li.textContent?.trim() ?? ''}`));
      else {
        const text = el.textContent?.trim() ?? '';
        if (text) lines.push(text);
      }
    }
  });

  return lines.filter(Boolean).join('\n');
}
