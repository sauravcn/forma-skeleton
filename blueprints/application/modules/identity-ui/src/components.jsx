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
export function AuthButton({
  children,
  variant = "primary",
  className = "",
  ...props
}) {
  return (
    <button
      className={`forma-identity__button forma-identity__button--${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export const defaultComponents = { AuthLayout, AuthField, AuthButton };

/** Decorative, local vector marks: no provider network assets or tracking. */
export function ProviderIcon({ provider }) {
  const paths = {
    google:
      "M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.08v2.59A10 10 0 0 0 12 22ZM6.42 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.31.32-1.92V7.49H3.08a10 10 0 0 0 0 9.02l3.34-2.59ZM12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.49l3.34 2.59A6 6 0 0 1 12 5.96Z",
    facebook:
      "M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.62.77-1.62 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z",
    github:
      "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.6 9.6 0 0 1 12 6.83c.85 0 1.71.11 2.51.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.39.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z",
    apple:
      "M16.7 12.8c0-2 1.64-2.96 1.71-3-.94-1.38-2.4-1.57-2.92-1.59-1.24-.13-2.44.74-3.07.74-.64 0-1.61-.73-2.66-.71-1.37.02-2.66.81-3.36 2.04-1.45 2.5-.37 6.2 1.02 8.22.7.99 1.5 2.1 2.56 2.06 1.04-.04 1.43-.66 2.69-.66 1.25 0 1.61.66 2.7.63 1.12-.02 1.83-.99 2.5-1.99.8-1.14 1.12-2.27 1.14-2.33-.03-.01-2.31-.89-2.33-3.41ZM14.65 6.9c.56-.7.95-1.65.84-2.62-.82.04-1.84.57-2.43 1.25-.52.61-.99 1.6-.87 2.54.92.07 1.86-.46 2.46-1.17Z",
  };
  return (
    <svg
      className="forma-identity__provider-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {provider === "microsoft" ? (
        <>
          <path d="M2 2h9v9H2zM13 2h9v9h-9zM2 13h9v9H2zM13 13h9v9h-9z" />
        </>
      ) : (
        <path
          d={
            paths[provider] ||
            "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
          }
        />
      )}
    </svg>
  );
}
