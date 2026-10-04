import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterBody = {
  name?: string;
  email?: string;
  password?: string;
};

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const POST = async (req: Request) => {
  try {
    const body = (await req.json()) as RegisterBody;
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!name || !email || !password) {
      return NextResponse.json({ ok: false, error: "Name, email and password are required" }, { status: 400 });
    }

    if (!isEmail(email)) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const db = await getDb();
    const users = db.collection("users");

    const exists = await users.findOne({ email }, { projection: { _id: 1 } });
    if (exists) {
      return NextResponse.json({ ok: false, error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();

    await users.insertOne({
      name,
      email,
      passwordHash,
      emailVerified: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Failed to register user";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
};
