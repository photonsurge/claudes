"use client";

/**
 * /watch/crossword/:scene?token=… — the crossword channel's watch page, an OBS
 * browser source like /watch/:scene and tokened the same way. A globe scene
 * opened here is sent to /watch/:scene (and the weather page does the reverse).
 * Everything below the route lives in components/crossword/CrosswordWatch.
 */
import { Suspense, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSurfaceRedirect } from "../../../../lib/crossword";
import CrosswordWatch from "../../../../components/crossword/CrosswordWatch";

function CrosswordWatchPageInner() {
  const params = useParams<{ scene: string }>();
  const token = useSearchParams().get("token") ?? undefined;
  const sceneId = useMemo(() => {
    const s = params?.scene;
    return decodeURIComponent(Array.isArray(s) ? s[0] : s ?? "");
  }, [params]);

  const redirecting = useSurfaceRedirect(sceneId, "crossword");
  if (redirecting) return null;
  return <CrosswordWatch sceneId={sceneId} token={token} />;
}

export default function CrosswordWatchPage() {
  return (
    <Suspense fallback={null}>
      <CrosswordWatchPageInner />
    </Suspense>
  );
}
