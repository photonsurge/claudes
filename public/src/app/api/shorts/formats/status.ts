/** HTTP status for each refusal of the shared format helpers (short-format-copy.ts). */
import type { FormatCopyResult, FormatDeleteResult } from "@photonsurge/shared/db/short-format-copy";

export const COPY_STATUS: Record<Extract<FormatCopyResult, { ok: false }>["code"], number> = {
  "bad-name": 400,
  "no-source": 404,
  exists: 409,
};

export const DELETE_STATUS: Record<Extract<FormatDeleteResult, { ok: false }>["code"], number> = {
  default: 400,
  "not-found": 404,
  "in-use": 409,
};
