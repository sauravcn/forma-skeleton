"use client";
import { useEffect, useId, useRef, useState } from "react";
import { en } from "./en.js";
import { defaultComponents } from "./components.jsx";

const views = new Set([
  "login",
  "verify",
  "resetRequest",
  "reset",
  "challenge",
  "recovery",
]);
const fields = {
  login: [
    ["identifier", "text", "username"],
    ["password", "password", "current-password"],
  ],
  verify: [],
  resetRequest: [["email", "email", "email"]],
  reset: [["newPassword", "password", "new-password"]],
  challenge: [["code", "text", "one-time-code"]],
  recovery: [["recoveryCode", "text", "off"]],
};
/** View-only adapter. The parent/server owns view transitions, tokens, session and assurance. */
export default function AuthPresentation({
  view = "login",
  variant = "minimal",
  onSubmit,
  onNavigate,
  providers = [],
  components = {},
  messages = {},
  busy = false,
  errorCode = null,
  noticeCode = null,
  aside = null,
}) {
  if (!views.has(view) || !["minimal", "split"].includes(variant))
    throw new Error("Unsupported identity presentation");
  if (typeof onSubmit !== "function")
    throw new Error("Identity controller callback required");
  if (
    !Array.isArray(providers) ||
    providers.some(
      (p) =>
        !p ||
        typeof p.id !== "string" ||
        !/^[a-z][a-z0-9-]*$/.test(p.id) ||
        typeof p.label !== "string" ||
        !p.label.trim() ||
        typeof p.onSelect !== "function",
    ) ||
    new Set(providers.map((p) => p.id)).size !== providers.length
  )
    throw new Error("Explicit provider callback contract required");
  const t = { ...en, ...messages };
  const { AuthLayout, AuthField, AuthButton } = {
    ...defaultComponents,
    ...components,
  };
  const id = useId(),
    form = useRef(null),
    heading = useRef(null),
    error = useRef(null);
  const [submitting, setSubmitting] = useState(false),
    [localError, setLocalError] = useState(false);
  const pending = busy || submitting,
    failed = localError || Boolean(errorCode);
  useEffect(() => {
    form.current?.reset();
    setLocalError(false);
    heading.current?.focus();
  }, [view]);
  useEffect(() => {
    if (failed) error.current?.focus();
  }, [failed]);
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (fields[view].some(([key]) => !String(values[key] || "").trim())) {
      setLocalError(true);
      return;
    }
    setSubmitting(true);
    setLocalError(false);
    try {
      await onSubmit({ view, values });
    } catch {
      setLocalError(true);
    } finally {
      // Never expose thrown backend details or credentials.
      form.current?.reset();
      setSubmitting(false);
    }
  }
  async function providerAction(provider) {
    if (pending) return;
    setSubmitting(true);
    setLocalError(false);
    try {
      await provider.onSelect();
    } catch {
      setLocalError(true);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <AuthLayout variant={variant} title={t[view]} aside={aside}>
      <h1 ref={heading} tabIndex={-1}>
        {t[view]}
      </h1>
      {view === "verify" && <p>{t.verifyHelp}</p>}
      {failed && (
        <p id={`${id}-error`} ref={error} tabIndex={-1} role="alert">
          {t.error}
        </p>
      )}
      {noticeCode === "accepted" && <p role="status">{t.accepted}</p>}
      <form ref={form} onSubmit={submit} aria-busy={pending}>
        {fields[view].map(([key, type, autoComplete]) => (
          <AuthField
            key={`${view}-${key}`}
            id={`${id}-${key}`}
            name={key}
            label={t[key]}
            type={type}
            autoComplete={autoComplete}
            required
            disabled={pending}
            errorId={failed ? `${id}-error` : undefined}
            aria-invalid={failed || undefined}
            spellCheck={false}
          />
        ))}
        <AuthButton type="submit" disabled={pending}>
          {pending ? t.pending : view === "verify" ? t.resend : t.submit}
        </AuthButton>
      </form>
      {view === "login" &&
        providers.map((provider) => (
          <AuthButton
            key={provider.id}
            type="button"
            disabled={pending}
            onClick={() => providerAction(provider)}
          >
            {t.provider} {provider.label}
          </AuthButton>
        ))}
      {typeof onNavigate === "function" && (
        <nav aria-label={t.login}>
          {view === "login" ? (
            <AuthButton
              type="button"
              disabled={pending}
              onClick={() => onNavigate("resetRequest")}
            >
              {t.resetRequest}
            </AuthButton>
          ) : (
            <AuthButton
              type="button"
              disabled={pending}
              onClick={() => onNavigate("login")}
            >
              {t.back}
            </AuthButton>
          )}
          {view === "challenge" && (
            <AuthButton
              type="button"
              disabled={pending}
              onClick={() => onNavigate("recovery")}
            >
              {t.recovery}
            </AuthButton>
          )}
        </nav>
      )}
    </AuthLayout>
  );
}
