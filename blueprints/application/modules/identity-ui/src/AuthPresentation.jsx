"use client";
import { useEffect, useId, useRef, useState } from "react";
import { identityMessages, identityText } from "./messages.js";
import { defaultComponents } from "./components.jsx";

const views = new Set([
  "login",
  "register",
  "enroll",
  "setPassword",
  "enrollmentConfirm",
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
  register: [
    ["name", "text", "name"],
    ["username", "text", "username"],
    ["email", "email", "email"],
    ["password", "password", "new-password"],
  ],
  enroll: [["currentPassword", "password", "current-password"]],
  setPassword: [["newPassword", "password", "new-password"]],
  enrollmentConfirm: [["code", "text", "one-time-code"]],
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
  enrollmentDetails = null,
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
  const t = identityMessages(messages);
  const { AuthLayout, AuthField, AuthButton } = {
    ...defaultComponents,
    ...components,
  };
  const id = useId(),
    form = useRef(null),
    heading = useRef(null),
    error = useRef(null),
    generation = useRef(0);
  const [submitting, setSubmitting] = useState(false),
    [localError, setLocalError] = useState(false);
  const pending = busy || submitting,
    failed = localError || Boolean(errorCode);
  useEffect(() => {
    generation.current += 1;
    setSubmitting(false);
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
    const submittedForm = event.currentTarget;
    const submittedView = view;
    const submittedGeneration = generation.current;
    const values = Object.fromEntries(new FormData(submittedForm));
    let rejected = false;
    if (fields[view].some(([key]) => !String(values[key] || "").trim())) {
      setLocalError(true);
      return;
    }
    setSubmitting(true);
    setLocalError(false);
    try {
      await onSubmit({ view, values });
    } catch {
      rejected = true;
      if (generation.current === submittedGeneration) setLocalError(true);
    } finally {
      // Clear secrets; preserve only nonsecret identifier on a failed same-view request.
      if (generation.current !== submittedGeneration) return;
      submittedForm.reset();
      if (rejected && submittedForm === form.current) {
        const key =
          submittedView === "login"
            ? "identifier"
            : submittedView === "resetRequest"
              ? "email"
              : null;
        if (key && submittedForm.elements.namedItem(key))
          submittedForm.elements.namedItem(key).value = String(
            values[key] || "",
          );
      }
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
      {view === "challenge" && <p>{t.challengeHelp}</p>}
      {view === "enrollmentConfirm" && enrollmentDetails && (
        <section
          className="forma-identity__secrets"
          aria-label={t.enrollmentConfirm}
        >
          <p>{t.enrollmentHelp}</p>
          <p>{t.qrHelp}</p>
          {enrollmentDetails.qrDataURL?.startsWith(
            "data:image/png;base64,",
          ) && (
            <img
              src={enrollmentDetails.qrDataURL}
              width="240"
              height="240"
              alt={t.qrAlt}
            />
          )}
          {enrollmentDetails.manualKey && (
            <div>
              <label htmlFor={`${id}-manual-key`}>{t.manualKey}</label>
              <input
                id={`${id}-manual-key`}
                aria-label={t.manualKey}
                readOnly
                value={enrollmentDetails.manualKey}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <label htmlFor={`${id}-authenticator-uri`}>
            {t.authenticatorUri}
          </label>
          <textarea
            id={`${id}-authenticator-uri`}
            aria-label={t.authenticatorUri}
            readOnly
            value={enrollmentDetails.totpURI}
            autoComplete="off"
            spellCheck={false}
          />
          <h2>{t.backupCodes}</h2>
          <ul>
            {enrollmentDetails.backupCodes.map((code, index) => (
              <li key={index}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed && (
        <p id={`${id}-error`} ref={error} tabIndex={-1} role="alert">
          {errorCode === "social" ? t.socialError : t.error}
        </p>
      )}
      {noticeCode === "accepted" && <p role="status">{t.accepted}</p>}
      {noticeCode === "socialCancelled" && (
        <p role="status">{t.socialCancelled}</p>
      )}
      {view === "setPassword" && <p>{t.setPasswordHelp}</p>}
      {view === "login" &&
        providers.some((provider) => provider.mode === "mock") && (
          <p>{t.mockHelp}</p>
        )}
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
            {identityText(
              provider.mode === "mock" ? t.mockProvider : t.provider,
              { provider: provider.label },
            )}
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
          {view === "login" && (
            <AuthButton
              type="button"
              disabled={pending}
              onClick={() => onNavigate("register")}
            >
              {t.register}
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
