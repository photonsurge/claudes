"use client";

/**
 * /crossword/:channel?token=… — the crossword channel's output page, an OBS
 * browser source tokened like /watch/:scene but not a watch page: its own look,
 * none of the weather chrome. A globe scene opened here is sent to
 * /watch/:scene. Everything below the route lives in
 * components/crossword/CrosswordPage.
 */
import { Suspense, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSurfaceGate } from "../../../lib/crossword";
import CrosswordPage from "../../../components/crossword/CrosswordPage";

function CrosswordRouteInner() {
  const params = useParams<{ channel: string }>();
  const token = useSearchParams().get("token") ?? undefined;
  const sceneId = useMemo(() => {
    const s = params?.channel;
    return decodeURIComponent(Array.isArray(s) ? s[0] : s ?? "");
  }, [params]);

  const gate = useSurfaceGate(sceneId, "crossword");
  if (gate !== "here") return null;
  return <CrosswordPage sceneId={sceneId} token={token} />;
}

export default function CrosswordRoute() {
  return (
    <Suspense fallback={null}>
      <CrosswordRouteInner />
    </Suspense>
  );
}
