// app/api/tts/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // important: need streaming + no edge limitations
export const dynamic = "force-dynamic";

export const POST = async (req: Request) => {
  try {
    // Pass through multipart (text + optional speaker_wav)
    const formData = await req.formData();

    const pyUrl = process.env.TTS_API_URL ?? "http://127.0.0.1:3002/tts";

    const pyRes = await fetch(pyUrl, {
      method: "POST",
      body: formData,
      // DO NOT set Content-Type manually for FormData
      // headers: { } 
    });

    if (!pyRes.ok) {
      const detail = await pyRes.text().catch(() => "TTS error");
      return NextResponse.json({ error: detail }, { status: pyRes.status });
    }

    // Stream bytes back to client
    const contentType = pyRes.headers.get("content-type") ?? "audio/wav";

    return new NextResponse(pyRes.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Optional: allow caching if you want (or set no-store)
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Proxy failed" },
      { status: 500 }
    );
  }
};
