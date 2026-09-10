import { InstanceSurface } from "../../components/InstanceMark";
import { resolveInstance } from "../../lib/instance";

/**
 * The sign-in page is the first thing you see, so it's the cheapest place to
 * learn which box you just opened. Same server-side read + dynamic render as
 * the other operator surfaces (lib/instance.ts).
 */
export const dynamic = "force-dynamic";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <InstanceSurface instance={resolveInstance()} align="center">
      {children}
    </InstanceSurface>
  );
}
