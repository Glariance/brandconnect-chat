/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_REAL_CHAT?: string;
  readonly VITE_REVERB_APP_KEY?: string;
  readonly VITE_REVERB_HOST?: string;
  readonly VITE_REVERB_PORT?: string;
  readonly VITE_REVERB_SCHEME?: string;
  /** Comma-separated exact origins allowed to embed /widget in addition to brand allowlists. */
  readonly VITE_WIDGET_PREVIEW_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
