export type WordListItem = {
  _id: string;
  norm?: string;
  word?: string;
  length?: number;
  clueCount?: number;
  enrichment?: {
    status?: string;
    reason?: string | null;
    model?: string | null;
    attempts?: unknown[];
  };
  validation?: {
    version?: number;
    runAt?: string;
    decision?: "accepted" | "review" | "reject" | string;
    score?: number;
    notes?: string[];
    sources?: Record<string, Record<string, unknown>>;
  };
  pos?: string[];
  categorySlugs?: string[];
  flags?: Record<string, unknown>;
  senses?: unknown[];
};

export type WordClue = {
  clue: string;
  difficulty?: number;
  source?: {
    name?: string;
    ref?: string;
    createdBy?: string;
  };
};

export type WordsApiResponse = {
  ok: boolean;
  q: string;
  status: string;
  sort?: string;
  approved?: boolean;
  page: number;
  limit: number;
  total: number;
  statusTotals?: Record<string, number>;
  validationTotals?: Record<string, number>;
  items: WordListItem[];
};
