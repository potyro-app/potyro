// The mascot (DESIGN.md §4.2): the "y" of the logo — a person with their arms up, the pen in the
// negative space — for the edge moments: an empty page, a success, a long wait. One per screen;
// never in an error, a payment or a deletion. The shapes are the designer's (packages/design/logo/
// symbol-rosa.svg), untouched; only the one coloured stroke takes the app's hour, as §4.1 allows
// for an app's context (the ink follows the theme, as the on-dark file does).
export function Mascot({ className }: { className?: string }) {
  return (
    <svg className={`k-mascot${className ? ` ${className}` : ""}`} viewBox="392.697 273.684 32.825 30.716" aria-hidden="true" focusable="false">
      <path className="k-mascot-ink" d="M407.62,288.12c-.2-.23-.39-.46-.61-.68-3.29-3.38-7.17-5.49-7.37-10.57-.16-4.23-7.1-4.25-6.94,0,.18,4.78,2.05,8.41,5.57,11.76,2.48,2.35,4.57,4.27,5.88,6.72.7-2.66,1.85-5.05,3.46-7.22h0Z" />
      <path className="k-mascot-stroke" d="M418.58,276.87c-.19,5.09-4.07,7.18-7.37,10.57-3.81,3.92-5.41,8.47-5.57,13.78-.13,4.24,6.81,4.24,6.94,0,.18-6.01,3.23-8.67,7.37-12.6,3.51-3.33,5.39-6.99,5.57-11.76.16-4.24-6.78-4.23-6.94,0h0Z" />
      <circle className="k-mascot-ink" cx="409.16" cy="278.4" r="4.71" />
    </svg>
  );
}
