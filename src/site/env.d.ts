// Types for Astro's client router module (the project's tsconfig loads Node types only).
declare module 'astro:transitions/client' {
  export function navigate(href: string, options?: { history?: 'auto' | 'push' | 'replace'; sourceElement?: Element }): Promise<void>;
}
