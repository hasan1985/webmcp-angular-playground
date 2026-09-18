/**
 * A deliberately small markdown renderer for assistant replies.
 *
 * The input is model output, so it is untrusted: everything is HTML-escaped first
 * and no raw HTML passes through. Covers what Claude actually emits in a chat —
 * fenced code, inline code, bold, italic, bullet and numbered lists, headings,
 * paragraphs. Links render as their text plus the URL rather than as anchors, so
 * nothing in a reply is clickable. A full parser (`marked`) is ~480 kB and would
 * be the largest thing in this demo.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 (<span class="url">$2</span>)');
  return out;
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code: everything until the closing fence, verbatim.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
      html.push(`<pre class="code"${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      html.push(`<p class="h${heading[1].length}">${inline(heading[2])}</p>`);
      i++;
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    const list = bullet.test(line) ? ([bullet, 'ul'] as const) : numbered.test(line) ? ([numbered, 'ol'] as const) : null;
    if (list) {
      const [re, tag] = list;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(`<li>${inline(re.exec(lines[i++])![1])}</li>`);
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Paragraph: consecutive non-blank, non-special lines joined with <br>.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^```/.test(lines[i]) && !/^#{1,3}\s/.test(lines[i]) &&
      !bullet.test(lines[i]) && !numbered.test(lines[i])
    ) para.push(inline(lines[i++]));
    html.push(`<p>${para.join('<br>')}</p>`);
  }

  return html.join('');
}
