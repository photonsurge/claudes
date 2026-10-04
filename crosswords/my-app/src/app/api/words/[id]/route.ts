import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/auth";
import { getDb } from "@/lib/mongo";

export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = await getDb();
  const words = db.collection("words");
  const clues = db.collection("clues");

  const _id = new ObjectId(id);

  const [word, wordClues] = await Promise.all([
    words.findOne({ _id }),
    clues
      .find({ answerId: _id })
      .project({ clue: 1, difficulty: 1, style: 1, createdAt: 1, source: 1 })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray(),
  ]);

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ word, clues: wordClues });
};
