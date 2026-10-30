import { toast } from "sonner";
import type { LiveVisitor } from "@/lib/presence-utils";
import { visitorArrivalSound } from "@/lib/visitor-arrival-sound";

export function formatArrivalToast(visitor: LiveVisitor): string {
  const brand = visitor.brand_name?.trim() || `Brand #${visitor.brand_id}`;
  const page = visitor.page || "/";
  return `New visitor · ${brand} · ${page}`;
}

/**
 * In-app toast + optional chime. Never requests OS notification permission.
 */
export async function announceVisitorArrival(visitor: LiveVisitor): Promise<void> {
  toast(formatArrivalToast(visitor), {
    description: visitor.label,
    duration: 5_000,
  });

  const outcome = await visitorArrivalSound.playArrivalTone();
  if (outcome === "blocked") {
    toast.message("Sound is blocked", {
      description: "Click Enable sound on Live Visitors to hear arrival alerts.",
      duration: 6_000,
    });
  }
}
