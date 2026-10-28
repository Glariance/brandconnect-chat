/**
 * Safe storage adapter for visitor session/conversation ids.
 * When sessionStorage is blocked or unavailable, values live in memory only —
 * persistence across reload cannot be guaranteed in that mode.
 */

export type SafeStorageMode = "session" | "memory";

export type SafeStorage = {
  mode: SafeStorageMode;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const memory = new Map<string, string>();

function canUseSessionStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const k = "__bc_storage_probe__";
    window.sessionStorage.setItem(k, "1");
    window.sessionStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function createSafeStorage(): SafeStorage {
  if (canUseSessionStorage()) {
    return {
      mode: "session",
      getItem: (key) => {
        try {
          return window.sessionStorage.getItem(key);
        } catch {
          return memory.get(key) ?? null;
        }
      },
      setItem: (key, value) => {
        try {
          window.sessionStorage.setItem(key, value);
          memory.set(key, value);
        } catch {
          memory.set(key, value);
        }
      },
      removeItem: (key) => {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        memory.delete(key);
      },
    };
  }

  return {
    mode: "memory",
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

/** Test helper: build an in-memory adapter without probing the browser. */
export function createMemoryStorage(initial?: Record<string, string>): SafeStorage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    mode: "memory",
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

export function storagePersistenceNotice(mode: SafeStorageMode): string | null {
  if (mode === "memory") {
    return "Browser storage is blocked. This chat session is in-memory only and will not survive a reload.";
  }
  return null;
}
