import { useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Check, Eye, EyeOff, House, LoaderCircle, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import "./auth.css";

type AuthShellProps = {
  children: ReactNode;
  title: string;
  description: string;
};

export function AuthShell({ children, title, description }: AuthShellProps) {
  return (
    
      <main className="auth-shell">
        <AuthBrandPanel />
        <AuthFormPanel title={title} description={description}>{children}</AuthFormPanel>
      </main>
    
  );
}

export function AuthBrandPanel() {
  return (
    <aside className="auth-brand" aria-label="Kavya">
      <Link to="/" className="auth-brand-name" aria-label="Kavya - kembali ke beranda">Kavya</Link>
      <div className="auth-brand-visual" aria-hidden="true">
        <div className="auth-brand-glow" />
        <span>K</span>
      </div>
      <div className="auth-brand-copy">
        <p>Produk digital, dalam satu alur.</p>
        <Link to="/" className="auth-brand-home"><House size={15} /> Kembali ke Beranda</Link>
      </div>
    </aside>
  );
}

export function AuthFormPanel({ title, description, children }: AuthShellProps) {
  return (
    <section className="auth-form-side">
      <div className="auth-mobile-brand">
        <Link to="/" aria-label="Kavya - kembali ke beranda"><span>K</span>Kavya</Link>
      </div>
      <div className="auth-form-panel">
        <header className="auth-form-header">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        <Link to="/" className="auth-home-link"><House size={15} /> Kembali ke Beranda</Link>
      </div>
    </section>
  );
}

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

export function AuthInput({ id, label, error, hint, className = "", ...props }: AuthInputProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={`auth-input ${error ? "is-invalid" : ""} ${className}`} aria-invalid={Boolean(error)} aria-describedby={descriptionId} {...props} />
      {error ? <AuthError id={`${id}-error`}>{error}</AuthError> : hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}

type PasswordInputProps = Omit<AuthInputProps, "type"> & { onCapsLockChange?: (active: boolean) => void };

export function PasswordInput({ onCapsLockChange, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const updateCapsLock = (event: KeyboardEvent<HTMLInputElement>) => onCapsLockChange?.(event.getModifierState("CapsLock"));
  return (
    <div className="auth-password-wrap">
      <AuthInput {...props} type={visible ? "text" : "password"} onKeyDown={updateCapsLock} onKeyUp={updateCapsLock} />
      <button type="button" className="auth-password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Sembunyikan password" : "Tampilkan password"} title={visible ? "Sembunyikan password" : "Tampilkan password"}>
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

type OtpInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
};

export function OtpInput({ id, label, value, onChange, error, disabled }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] || "");

  function setDigit(index: number, raw: string) {
    const numeric = raw.replace(/\D/g, "");
    if (numeric.length > 1) {
      const pasted = numeric.slice(0, 6);
      onChange(pasted);
      refs.current[Math.min(pasted.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = numeric;
    onChange(next.join(""));
    if (numeric && index < 5) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  }

  return (
    <fieldset className="auth-otp-field" aria-describedby={error ? `${id}-error` : undefined}>
      <legend>{label}</legend>
      <div className="auth-otp-row">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(node) => { refs.current[index] = node; }}
            id={index === 0 ? id : undefined}
            value={digit}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => { event.preventDefault(); setDigit(index, event.clipboardData.getData("text")); }}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            aria-label={`Digit OTP ${index + 1}`}
            aria-invalid={Boolean(error)}
          />
        ))}
      </div>
      {error ? <AuthError id={`${id}-error`}>{error}</AuthError> : null}
    </fieldset>
  );
}

export function AuthStepIndicator({ steps, activeStep }: { steps: string[]; activeStep: number }) {
  return (
    <ol className="auth-steps" aria-label="Tahap autentikasi" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((label, index) => {
        const state = index < activeStep ? "complete" : index === activeStep ? "active" : "upcoming";
        return (
          <li key={label} className={`is-${state}`} aria-current={state === "active" ? "step" : undefined}>
            <span>{state === "complete" ? <Check size={13} /> : index + 1}</span>
            <strong>{label}</strong>
          </li>
        );
      })}
    </ol>
  );
}

export function AuthError({ children, id }: { children: ReactNode; id?: string }) {
  return <p className="auth-error" id={id} role="alert">{children}</p>;
}

export function AuthSuccessState({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <div className="auth-success" role="status">
      <span><ShieldCheck size={24} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function AuthSubmitButton({ loading = false, loadingLabel = "Memproses...", children, disabled = false }: { loading?: boolean; loadingLabel?: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button className="auth-button is-full" disabled={disabled || loading} aria-busy={loading}>
      {loading ? <LoaderCircle className="auth-spinner" size={17} aria-hidden="true" /> : null}
      {loading ? loadingLabel : children}
    </button>
  );
}
