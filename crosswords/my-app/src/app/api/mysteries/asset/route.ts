import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..");
const ALLOWED_PREFIXES = [
  path.join(ROOT, "character_images"),
  path.join(ROOT, "location_images"),
];

const contentTypeFor = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
};

export const GET = async (req: Request) => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const raw = (url.searchParams.get("path") ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const normalized = raw.replace(/\\/g, "/");
  const absolute = path.resolve(ROOT, normalized);
  const allowed = ALLOWED_PREFIXES.some((prefix) => absolute.startsWith(prefix + path.sep));
  if (!allowed) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }

  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = await fs.readFile(absolute);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(absolute),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
};
