"use client";
export function AuthLayout({ variant, title, children, aside }) {
  return (
    <section
      className={`forma-identity forma-identity--${variant}`}
      aria-label={title}
    >
      {variant === "split" && (
        <aside className="forma-identity__aside">{aside}</aside>
      )}
      <div className="forma-identity__panel">{children}</div>
    </section>
  );
}
export function AuthField({ id, label, errorId, ...input }) {
  return (
    <div className="forma-identity__field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={errorId} {...input} />
    </div>
  );
}
export function AuthButton({ children, ...props }) {
  return <button {...props}>{children}</button>;
}
export const defaultComponents = { AuthLayout, AuthField, AuthButton };
