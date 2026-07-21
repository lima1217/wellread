import { describe, expect, it } from 'vitest';
import { migrateAssistantPanelSettings } from '@/services/settingsService';
import type { ReadSettings } from '@/types/settings';

const baseRead = (): ReadSettings =>
  ({
    assistantPanelWidth: '25%',
    isAssistantPanelPinned: false,
  }) as unknown as ReadSettings;

describe('migrateAssistantPanelSettings', () => {
  it('maps legacy notebookWidth / isNotebookPinned into assistant panel keys', () => {
    const read = baseRead();
    (read as unknown as { notebookWidth: string }).notebookWidth = '40%';
    (read as unknown as { isNotebookPinned: boolean }).isNotebookPinned = true;
    (read as unknown as { notebookActiveTab: string }).notebookActiveTab = 'notes';

    expect(migrateAssistantPanelSettings(read)).toBe(true);

    expect(read.assistantPanelWidth).toBe('40%');
    expect(read.isAssistantPanelPinned).toBe(true);
    expect((read as unknown as { notebookWidth?: unknown }).notebookWidth).toBeUndefined();
    expect((read as unknown as { isNotebookPinned?: unknown }).isNotebookPinned).toBeUndefined();
    expect((read as unknown as { notebookActiveTab?: unknown }).notebookActiveTab).toBeUndefined();
  });

  it('leaves already-migrated settings unchanged', () => {
    const read = baseRead();
    read.assistantPanelWidth = '33%';
    read.isAssistantPanelPinned = true;

    expect(migrateAssistantPanelSettings(read)).toBe(false);

    expect(read.assistantPanelWidth).toBe('33%');
    expect(read.isAssistantPanelPinned).toBe(true);
  });

  it('does not overwrite new keys when legacy keys are absent', () => {
    const read = baseRead();
    read.assistantPanelWidth = '18%';
    read.isAssistantPanelPinned = true;

    expect(migrateAssistantPanelSettings(read)).toBe(false);

    expect(read.assistantPanelWidth).toBe('18%');
    expect(read.isAssistantPanelPinned).toBe(true);
  });
});
