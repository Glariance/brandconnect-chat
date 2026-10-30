import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Btn } from "@/components/app-shell";
import { visitorArrivalSound, type SoundState } from "@/lib/visitor-arrival-sound";

/** Sound unlock + mute/volume for Live Visitors (in-app only). */
export function VisitorArrivalControls() {
  const [state, setState] = useState<SoundState>(() => visitorArrivalSound.getState());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => visitorArrivalSound.subscribe(setState), []);

  const needsUnlock = state.preferredEnabled && !state.unlocked;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      {needsUnlock ? (
        <Btn
          type="button"
          className="gap-2"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void visitorArrivalSound.unlock().then((ok) => {
              setBusy(false);
              setFlash(ok ? "Sound enabled" : "Could not unlock audio — try again");
            });
          }}
        >
          <Volume2 className="size-4" />
          Enable sound
        </Btn>
      ) : (
        <Btn
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => visitorArrivalSound.setPreferredEnabled(!state.preferredEnabled)}
          aria-pressed={!state.preferredEnabled}
        >
          {state.preferredEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          {state.preferredEnabled ? "Mute" : "Unmute"}
        </Btn>
      )}

      <Btn
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void visitorArrivalSound.testSound().then((outcome) => {
            setBusy(false);
            setFlash(
              outcome === "played"
                ? "Test tone played"
                : outcome === "blocked"
                  ? "Blocked — click Enable sound first"
                  : outcome === "muted"
                    ? "Unmute to hear arrivals"
                    : "Audio unavailable",
            );
          });
        }}
      >
        Test sound
      </Btn>

      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.volume}
          aria-label="Arrival sound volume"
          onChange={(e) => visitorArrivalSound.setVolume(Number(e.target.value))}
          className="w-24 accent-primary"
        />
      </label>

      {needsUnlock && (
        <p className="basis-full text-xs text-amber-700 dark:text-amber-400" role="status">
          Browser audio is locked until you click Enable sound. Arrivals still show as toasts.
        </p>
      )}
      {flash && (
        <p className="basis-full text-xs text-muted-foreground" role="status">
          {flash}
        </p>
      )}
      {state.lastError && !needsUnlock && (
        <p className="basis-full text-xs text-destructive" role="alert">
          {state.lastError}
        </p>
      )}
    </div>
  );
}
