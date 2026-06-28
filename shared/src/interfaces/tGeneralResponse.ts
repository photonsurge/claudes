/**
 * The standard result envelope returned by every DB/repo call across the stack
 * (see db/generic.ts and db/mongoose-generic.ts). `{ success, data?, errors?,
 * totalCount? }` — callers branch on `success` and read `data` rather than
 * relying on thrown exceptions.
 */
export type tGeneralResponse<T = any> = {
  success: boolean;
  errors?: Record<string, string[]>;
  data?: T;
  totalCount?: number;
};
