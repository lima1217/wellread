import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { BookNote, HighlightStyle } from '@/types/book';
import {
  pollReaderCommands,
  postReaderCommandResult,
} from '@/services/wellread/assistant/eveClient';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { buildSpineChapterTitleLookup } from '@/services/wellread/extract/spineChapterTitles';
import {
  runAgentReaderCommand,
  type AgentReaderDeps,
  type AgentReaderResult,
} from '../utils/agentReaderCommands';

const RETRY_MS = 3000;

/**
 * Carry out reader actions external agents request over MCP (navigate,
 * highlight, annotate, bookmark, …) for this open book: long-poll the
 * sidecar, run each command, post the result back.
 */
export function useAgentReaderCommands(bookKey: string) {
  const { envConfig } = useEnv();

  useEffect(() => {
    let stopped = false;
    let controller = new AbortController();
    const bookId = () => useBookDataStore.getState().getBookData(bookKey)?.book?.hash;

    const deps = (): AgentReaderDeps | null => {
      const view = useReaderStore.getState().getView(bookKey);
      const data = useBookDataStore.getState().getBookData(bookKey);
      if (!view || !data?.bookDoc) return null;
      const chapterTitle = buildSpineChapterTitleLookup(data.bookDoc);
      return {
        view,
        views: () => useReaderStore.getState().getViewsById(bookKey.split('-')[0]!),
        getBooknotes: () => useBookDataStore.getState().getConfig(bookKey)?.booknotes ?? [],
        saveBooknotes: (notes: BookNote[]) => {
          const { updateBooknotes, saveConfig } = useBookDataStore.getState();
          const updated = updateBooknotes(bookKey, notes);
          if (updated) {
            void saveConfig(envConfig, bookKey, updated, useSettingsStore.getState().settings);
          }
        },
        highlightDefaults: (style?: HighlightStyle) => {
          const read = useSettingsStore.getState().settings.globalReadSettings;
          const chosen = style ?? read.highlightStyle;
          return { style: chosen, color: read.highlightStyles[chosen] };
        },
        chapterTitle,
      };
    };

    const run = async (command: { id: string; type: string; args: Record<string, unknown> }) => {
      let result: AgentReaderResult;
      try {
        const d = deps();
        result = d
          ? await runAgentReaderCommand(d, command)
          : { ok: false, error: 'not_ready', message: 'The book is still loading in Wellread.' };
      } catch (error) {
        result = {
          ok: false,
          error: 'reader_error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      await postReaderCommandResult(command.id, result).catch(() => {});
    };

    const loop = async () => {
      while (!stopped) {
        const id = bookId();
        if (!id || !useEveConnectionStore.getState().ready) {
          await new Promise((r) => setTimeout(r, RETRY_MS));
          continue;
        }
        try {
          const commands = await pollReaderCommands(id, controller.signal);
          // Sequential: a highlight after an open_in_reader sees the new page.
          for (const command of commands) await run(command);
        } catch {
          if (stopped) return;
          if (controller.signal.aborted) controller = new AbortController();
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
    };

    // A restarted sidecar has a new URL: drop the hanging poll and reconnect.
    const unsubscribe = useEveConnectionStore.subscribe((s, prev) => {
      if (s.info !== prev.info) controller.abort();
    });
    void loop();
    return () => {
      stopped = true;
      unsubscribe();
      controller.abort();
    };
  }, [bookKey, envConfig]);
}
