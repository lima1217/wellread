export declare const READER_STATE_CFI_MAX_LENGTH: 4096;
export declare const READER_STATE_CHAPTER_MAX_LENGTH: 512;

export declare const ENVELOPE_KEYS: Readonly<{
  book: 'book';
  bookId: 'bookId';
  extractStatus: 'extract_status';
  extractChunkCount: 'extract_chunk_count';
  position: 'position';
  chapter: 'chapter';
  cfi: 'cfi';
  sectionIndex: 'sectionIndex';
  focusChunksVia: 'focus_chunks_via';
  focusChunkCount: 'focus_chunk_count';
  focusChunks: 'focus_chunks';
  sectionChunksVia: 'section_chunks_via';
  sectionChunkCount: 'section_chunk_count';
  sectionChunksNote: 'section_chunks_note';
  sectionChunks: 'section_chunks';
  quotes: 'quotes';
  priorSources: 'prior_sources';
  notesIndex: 'notes_index';
}>;

export type ReaderState = {
  chapter?: string;
  cfi?: string;
  sectionIndex?: number;
};

export declare function normalizeReaderState(
  raw: unknown,
  opts?: { cfiMaxLength?: number; chapterMaxLength?: number },
): ReaderState | null;
