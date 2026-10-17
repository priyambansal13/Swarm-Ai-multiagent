export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4 56 18v28L32 60 8 46V18z" fill="var(--accent)" />
      <path d="M32 18 44 25v14l-12 7-12-7V25z" fill="var(--surface)" opacity="0.92" />
      <circle cx="32" cy="32" r="5" fill="var(--ink)" />
    </svg>
  );
}
