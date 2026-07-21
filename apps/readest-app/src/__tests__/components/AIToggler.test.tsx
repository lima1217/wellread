import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PiRobot } from 'react-icons/pi';

import AIToggler from '@/app/reader/components/AIToggler';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn() }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: 'book-1', setSideBarBookKey: vi.fn() }),
}));

vi.mock('@/store/assistantPanelStore', () => ({
  useAssistantPanelStore: () => ({
    isAssistantPanelVisible: false,
    toggleAssistantPanel: vi.fn(),
  }),
}));

afterEach(() => cleanup());

describe('AIToggler', () => {
  it('exposes user-facing label AI (not Notebook)', () => {
    render(<AIToggler bookKey='book-1' />);
    expect(screen.getByRole('button', { name: 'AI' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Notebook' })).toBeNull();
  });

  it('uses the PiRobot icon (same as Ask about this)', () => {
    const { container } = render(<AIToggler bookKey='book-1' />);
    const { container: robot } = render(<PiRobot size={18} />);
    expect(container.querySelector('svg')?.innerHTML).toBe(robot.querySelector('svg')?.innerHTML);
  });
});
