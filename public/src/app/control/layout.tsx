import { InstanceSurface } from "../../components/InstanceMark";
import { resolveInstance } from "../../lib/instance";

/**
 * Exists only to put the instance badge over the operator console — /control
 * itself is a client component, and the badge has to be read from the SERVER
 * env at request time (lib/instance.ts explains why it can't be baked in).
 *
 * `force-dynamic` for the same reason: a prerendered shell would carry the
 * build box's identity to every deployment that runs the image.
 */
export const dynamic = "force-dynamic";

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    // Centred: the globe keeps its legend top-left and its reports top-right.
    <InstanceSurface instance={resolveInstance()} align="center">
      {children}
    </InstanceSurface>
  );
}
