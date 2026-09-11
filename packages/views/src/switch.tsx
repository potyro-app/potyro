// A boolean is a switch (#97): the phone convention, and the one control in a generated form that
// used to be a bare 13px browser checkbox floating under a grey label.
//
// `SwitchRow` is the form's version: one full-width row, at least 44px tall, the whole row the hit
// target — label on the left, an optional line of help under it, the toggle on the right. `Switch`
// is the toggle alone, for places that carry their own label (a list row, a filter chip). Both are
// real buttons with `role="switch"` and `aria-checked`, so Space toggles and the focus ring is the
// browser's own; the knob moves on `transform` and stops moving under `prefers-reduced-motion`.

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The accessible name when nothing else labels it. */
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`k-switch${className ? ` ${className}` : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="k-switch-knob" aria-hidden />
    </button>
  );
}

export interface SwitchRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** One line under the label: what "on" means, when the label alone does not say. */
  help?: string;
  required?: boolean;
  disabled?: boolean;
}

export function SwitchRow({ checked, onChange, label, help, required, disabled }: SwitchRowProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="k-switch-row" onClick={() => onChange(!checked)}>
      <span className="k-switch-text">
        <span className="k-switch-label">
          {label}
          {required ? <em aria-hidden> *</em> : null}
        </span>
        {help ? <span className="k-switch-help">{help}</span> : null}
      </span>
      <span className="k-switch" aria-hidden>
        <span className="k-switch-knob" />
      </span>
    </button>
  );
}
