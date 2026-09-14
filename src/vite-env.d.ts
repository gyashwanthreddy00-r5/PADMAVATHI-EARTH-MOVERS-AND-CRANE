/// <reference types="vite/client" />

// Injected at build/dev time by Vite's `define` (see vite.config.ts).
// Declared in this ambient file (not inline) so esbuild treats them as free
// identifiers and applies the `define` replacement.
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
