// A database, drawn: stacked cylinder, in the text colour and at the text size of wherever it sits.
// Drawn because no glyph says "database" — the ones that come close render as a box on half the
// devices people use.

export function DatabaseIcon({ size = "1em" }: { size?: string }) {
  return (
    <svg className="k-db-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden focusable="false">
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
      <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13" />
      <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
    </svg>
  );
}
