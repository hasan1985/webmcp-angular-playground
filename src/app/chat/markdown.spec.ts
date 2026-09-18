import {renderMarkdown} from './markdown';

describe('renderMarkdown', () => {
  it('escapes HTML in model output', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('renders fenced code verbatim, escaped', () => {
    expect(renderMarkdown('```ts\nconst a = 1 < 2;\n```')).toBe(
      '<pre class="code" data-lang="ts"><code>const a = 1 &lt; 2;</code></pre>',
    );
  });

  it('renders inline code, bold and lists', () => {
    expect(renderMarkdown('Use `get_board` **first**.\n- one\n- two')).toBe(
      '<p>Use <code>get_board</code> <strong>first</strong>.</p><ul><li>one</li><li>two</li></ul>',
    );
  });

  it('renders links as text, never anchors', () => {
    expect(renderMarkdown('see [docs](https://x.test/a)')).toBe(
      '<p>see docs (<span class="url">https://x.test/a</span>)</p>',
    );
  });

  it('keeps single newlines inside a paragraph', () => {
    expect(renderMarkdown('Board:\nX . .\n. O .')).toBe('<p>Board:<br>X . .<br>. O .</p>');
  });
});
