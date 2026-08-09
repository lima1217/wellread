export type PendingQuoteForTurn = {
  text: string;
  chapterTitle?: string | null;
  id?: string;
};

export type ParsedPendingQuote = {
  text: string;
  chapterTitle: string | null;
};

export declare function formatPendingQuotesForTurn(
  quotes: PendingQuoteForTurn[],
  userText: string,
): string;

export declare function peelLeadingQuoteWire(wire: string): {
  quoteParts: string[];
  content: string;
};

export declare function parsePendingQuotesFromWire(wire: string): {
  quotes: ParsedPendingQuote[];
  content: string;
};

export declare function stripLeadingQuoteBlocks(message: string): string;

export declare function stripQuoteWireProtection(text: string): string;
