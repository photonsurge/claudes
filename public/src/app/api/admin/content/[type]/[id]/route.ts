import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { isAdminEntityType } from "@photonsurge/shared/admin-content/types";
import { editableFieldKeys } from "@photonsurge/shared/admin-content/schema";
import { resolveAdminContent } from "@photonsurge/shared/admin-content/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/admin/content/[type]/[id] — the merged view of one catalog/signal
 * entity: its base doc with saved TEXT overrides applied, plus every uploaded
 * image (primary first). Powers the admin detail page + the on-air preview.
 * Admin-gated by proxy.ts.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;
  if (!isAdminEntityType(type)) {
    return NextResponse.json({ error: "unknown entity type" }, { status: 404, headers: NO_CACHE });
  }
  try {
    const db = await getAppDb();
    const content = await resolveAdminContent(db, type, decodeURIComponent(id));
    if (!content) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_CACHE });
    }
    return NextResponse.json(content, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

/**
 * PATCH /api/admin/content/[type]/[id] — save the entity's TEXT overrides. Body
 * `{ text: { <field>: value } }`; only keys in the entity's edit schema are
 * kept, empties clear the override (falling back to the base value). Returns the
 * freshly re-resolved content.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
) {
  const { type, id } = await params;
  if (!isAdminEntityType(type)) {
    return NextResponse.json({ error: "unknown entity type" }, { status: 404, headers: NO_CACHE });
  }

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    /* empty body → clears overrides */
  }

  const rawText = (body.text ?? {}) as Record<string, unknown>;
  const allowed = new Set(editableFieldKeys(type));
  const text: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawText)) {
    if (allowed.has(k) && typeof v === "string") text[k] = v;
  }

  try {
    const db = await getAppDb();
    const entityId = decodeURIComponent(id);
    // Confirm the entity exists before persisting an override for a phantom id.
    const before = await resolveAdminContent(db, type, entityId);
    if (!before) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_CACHE });
    }
    await db.adminEdits.setText(type, before.entityId, text);
    const content = await resolveAdminContent(db, type, before.entityId);
    return NextResponse.json(content, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
