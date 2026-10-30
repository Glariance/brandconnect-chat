/**
 * Agent dashboard visitor-arrival audio.
 * Preferred mute/volume persist in localStorage; AudioContext unlock requires a user gesture.
 */

const PREF_KEY = "bc_visitor_sound_prefs_v1";

export type SoundPrefs = {
  /** User wants sounds when unlocked (persisted). */
  preferredEnabled: boolean;
  volume: number; // 0..1
};

export type SoundState = SoundPrefs & {
  /** Browser AudioContext actually resumed after a gesture. */
  unlocked: boolean;
  lastError: string | null;
};

const defaultPrefs = (): SoundPrefs => ({ preferredEnabled: true, volume: 0.55 });

function readPrefs(): SoundPrefs {
  if (typeof localStorage === "undefined") return defaultPrefs();
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    const volume = typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : 0.55;
    return {
      preferredEnabled: parsed.preferredEnabled !== false,
      volume,
    };
  } catch {
    return defaultPrefs();
  }
}

function writePrefs(prefs: SoundPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

type Listener = (state: SoundState) => void;

class VisitorArrivalSound {
  private prefs = readPrefs();
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private lastError: string | null = null;
  private listeners = new Set<Listener>();

  getState(): SoundState {
    return {
      ...this.prefs,
      unlocked: this.unlocked,
      lastError: this.lastError,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const state = this.getState();
    for (const l of this.listeners) l(state);
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      this.lastError = "Web Audio is not available in this browser.";
      this.emit();
      return null;
    }
    if (!this.ctx) this.ctx = new AC();
    return this.ctx;
  }

  /** Must be called from a click/tap handler. */
  async unlock(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended") await ctx.resume();
      // Tiny silent buffer proves unlock.
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      this.unlocked = ctx.state === "running";
      this.lastError = this.unlocked ? null : "Audio context is still suspended.";
      this.prefs = { ...this.prefs, preferredEnabled: true };
      writePrefs(this.prefs);
      this.emit();
      return this.unlocked;
    } catch (e) {
      this.unlocked = false;
      this.lastError = e instanceof Error ? e.message : "Could not unlock audio.";
      this.emit();
      return false;
    }
  }

  setPreferredEnabled(enabled: boolean) {
    this.prefs = { ...this.prefs, preferredEnabled: enabled };
    writePrefs(this.prefs);
    this.emit();
  }

  setVolume(volume: number) {
    this.prefs = { ...this.prefs, volume: Math.min(1, Math.max(0, volume)) };
    writePrefs(this.prefs);
    this.emit();
  }

  /**
   * Play a short two-tone chime. Returns outcome for UI messaging.
   * Never throws to callers.
   */
  async playArrivalTone(opts?: { force?: boolean }): Promise<"played" | "muted" | "blocked" | "unavailable"> {
    if (!opts?.force && !this.prefs.preferredEnabled) return "muted";
    const ctx = this.ensureContext();
    if (!ctx) return "unavailable";
    try {
      if (ctx.state === "suspended") {
        // Attempt resume; without a gesture this usually fails.
        await ctx.resume().catch(() => undefined);
      }
      if (ctx.state !== "running") {
        this.unlocked = false;
        this.lastError = "Click Enable sound to allow audio in this browser.";
        this.emit();
        return "blocked";
      }
      this.unlocked = true;
      this.lastError = null;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.prefs.volume * 0.35), now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      gain.connect(ctx.destination);

      const beep = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + dur);
      };
      beep(880, now, 0.12);
      beep(1174.7, now + 0.12, 0.16);
      this.emit();
      return "played";
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : "Playback failed.";
      this.emit();
      return "blocked";
    }
  }

  async testSound(): Promise<"played" | "muted" | "blocked" | "unavailable"> {
    const unlocked = this.unlocked || (await this.unlock());
    if (!unlocked) return "blocked";
    return this.playArrivalTone({ force: true });
  }
}

export const visitorArrivalSound = new VisitorArrivalSound();
