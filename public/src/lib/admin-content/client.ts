import type { AdminEntityType, AdminImage, AdminTextOverrides } from "@photonsurge/shared/admin-content/types";
import { adminMediaPath } from "@photonsurge/shared/admin-content/types";
import type { ResolvedContent } from "@photonsurge/shared/admin-content/resolve";

export type { AdminImage, AdminTextOverrides, ResolvedContent };
export { adminMediaPath };

const base = (type: AdminEntityType, id: string) =>
  `/api/admin/content/${type}/${encodeURIComponent(id)}`;

/** One row in the admin content list. */
export interface ContentListItem {
  id: string;
  name: string;
  subtitle: string;
  edited: boolean;
  imageCount: number;
  primaryImageId: string | null;
}

/** The full list of one entity type (name/subtitle override-applied). */
export async function listContent(type: AdminEntityType): Promise<ContentListItem[]> {
  const res = await fetch(`/api/admin/content/${type}`, { cache: "no-store" });
  const data = await j<{ items: ContentListItem[] }>(res);
  return data.error ? [] : data.items ?? [];
}

async function j<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    return { error: `HTTP ${res.status}` } as T & { error?: string };
  }
}

/** The merged entity + images + saved overrides, or null if it doesn't exist. */
export async function getContent(
  type: AdminEntityType,
  id: string,
): Promise<ResolvedContent | null> {
  const res = await fetch(base(type, id), { cache: "no-store" });
  if (res.status === 404) return null;
  const data = await j<ResolvedContent>(res);
  return data.error ? null : data;
}

/** Save the entity's text overrides; returns the re-resolved content or an error. */
export async function saveText(
  type: AdminEntityType,
  id: string,
  text: AdminTextOverrides,
): Promise<ResolvedContent | { error: string }> {
  const res = await fetch(base(type, id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await j<ResolvedContent>(res);
  if (data.error) return { error: data.error };
  return data;
}

/** Upload one image (multipart). Returns the created image or an error. */
export async function uploadImage(
  type: AdminEntityType,
  id: string,
  file: File,
  meta: { caption?: string; credit?: string } = {},
): Promise<{ image: AdminImage } | { error: string }> {
  const form = new FormData();
  form.append("file", file);
  if (meta.caption) form.append("caption", meta.caption);
  if (meta.credit) form.append("credit", meta.credit);
  const res = await fetch(`${base(type, id)}/images`, { method: "POST", body: form });
  return j<{ image: AdminImage }>(res);
}

const imageUrl = (type: AdminEntityType, id: string, imageId: string) =>
  `${base(type, id)}/images/${encodeURIComponent(imageId)}`;

export async function setPrimaryImage(
  type: AdminEntityType,
  id: string,
  imageId: string,
): Promise<{ image: AdminImage } | { error: string }> {
  const res = await fetch(imageUrl(type, id, imageId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primary: true }),
  });
  return j<{ image: AdminImage }>(res);
}

export async function patchImage(
  type: AdminEntityType,
  id: string,
  imageId: string,
  patch: { caption?: string; credit?: string; sort?: number },
): Promise<{ image: AdminImage } | { error: string }> {
  const res = await fetch(imageUrl(type, id, imageId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return j<{ image: AdminImage }>(res);
}

export async function deleteImage(
  type: AdminEntityType,
  id: string,
  imageId: string,
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(imageUrl(type, id, imageId), { method: "DELETE" });
  return j<{ ok: true }>(res);
}
