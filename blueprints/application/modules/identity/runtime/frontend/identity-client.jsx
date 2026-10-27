"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import QRCode from "qrcode";
import {
  configuredMockProviders,
  consumeSocialResult,
  mockRedirectURL,
} from "./social-contract.mjs";
import AuthPresentation from "./presentation/AuthPresentation.jsx";
import { en } from "./presentation/en.js";
import "./presentation/styles.css";
const IdentityContext = createContext(null);
const stages = new Set([
  "signed-out",
  "enroll",
  "challenge",
  "authenticated",
  "forbidden",
]);
async function request(endpoint, body) {
  const response = await fetch(endpoint, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error("identity.request");
  }
  if (!response.ok) throw Error("identity.request");
  return result;
}
export function IdentityProvider({ children }) {
  const [descriptor, setDescriptor] = useState(null),
    [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const value = await request("/api/identity");
      if (!value || !stages.has(value.stage))
        throw Error("identity.descriptor");
      configuredMockProviders(value);
      if (current === sequence.current) {
        setDescriptor(value);
        setFailed(false);
      }
      return value;
    } catch {
      if (current === sequence.current) {
        setDescriptor(null);
        setFailed(true);
      }
      throw Error("identity.request");
    }
  }, []);
  useEffect(() => {
    refresh().catch(() => {});
    return () => {
      sequence.current += 1;
    };
  }, [refresh]);
  return (
    <IdentityContext.Provider value={{ descriptor, failed, refresh }}>
      {children}
    </IdentityContext.Provider>
  );
}
export function useIdentity() {
  const identity = useContext(IdentityContext);
  if (!identity) throw Error("IdentityProvider required");
  return identity;
}
export function IdentityControls() {
  const { descriptor, refresh } = useIdentity();
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <section className="forma-identity-controls" aria-label={en.authenticated}>
      {descriptor?.stage === "authenticated" && <span>{en.authenticated}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await request("/api/auth/sign-out", {});
            await refresh();
            window.location.assign("/auth");
          } catch {
            await refresh().catch(() => {});
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {en.signOut}
      </button>
      {failed && <p role="alert">{en.error}</p>}
    </section>
  );
}
export function AuthPage() {
  const { descriptor, failed, refresh } = useIdentity();
  const [choice, setChoice] = useState("login"),
    [notice, setNotice] = useState(null),
    [error, setError] = useState(null),
    [enrollment, setEnrollment] = useState(null),
    [resetToken, setResetToken] = useState(null),
    [verificationEmail, setVerificationEmail] = useState(""),
    [qrDataURL, setQrDataURL] = useState(null),
    [navigationBusy, setNavigationBusy] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    const socialResult = consumeSocialResult(url);
    if (socialResult === "cancelled") setNotice("socialCancelled");
    if (socialResult === "error") setError("social");
    if (socialResult) window.history.replaceState(null, "", url.pathname);
    if (url.searchParams.has("token")) {
      setResetToken(url.searchParams.get("token"));
      setChoice("reset");
      window.history.replaceState(null, "", url.pathname);
    }
  }, []);
  const stage = descriptor?.stage;
  useEffect(() => {
    if (stage !== "enroll") setEnrollment(null);
  }, [stage]);
  useEffect(() => {
    let active = true;
    setQrDataURL(null);
    if (enrollment)
      QRCode.toDataURL(enrollment.totpURI, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "M",
      })
        .then((data) => {
          if (active) setQrDataURL(data);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [enrollment]);
  async function navigate(next) {
    if (next !== "reset") setResetToken(null);
    setError(null);
    setNotice(null);
    setEnrollment(null);
    if (next === "login" && (stage === "challenge" || stage === "enroll")) {
      setNavigationBusy(true);
      try {
        await request("/api/auth/sign-out", {});
        await refresh();
        setChoice("login");
      } catch {
        await refresh().catch(() => {});
        setError("identity.request");
      } finally {
        setNavigationBusy(false);
      }
    } else {
      setChoice(next);
    }
  }
  // Local choices select a form only. Only refreshed server stage permits the workspace.
  let view = ["login", "register", "verify", "resetRequest", "reset"].includes(
    choice,
  )
    ? choice
    : "login";
  if (resetToken !== null) view = "reset";
  else if (stage === "challenge")
    view = choice === "recovery" ? "recovery" : "challenge";
  else if (stage === "enroll")
    view =
      descriptor.passwordRequired === true
        ? "setPassword"
        : enrollment
          ? "enrollmentConfirm"
          : "enroll";
  async function submit({ view, values }) {
    setError(null);
    setNotice(null);
    try {
      if (view === "register") {
        await request("/api/auth/sign-up/email", {
          email: values.email,
          username: values.username,
          name: values.name,
          password: values.password,
          callbackURL: new URL("/auth", window.location.origin).href,
        });
        setVerificationEmail(values.email);
        setChoice("verify");
        setNotice("accepted");
      } else if (view === "verify") {
        await request("/api/auth/send-verification-email", {
          email: verificationEmail,
          callbackURL: new URL("/auth", window.location.origin).href,
        });
        setNotice("accepted");
      } else if (view === "login") {
        await request(
          values.identifier.includes("@")
            ? "/api/auth/sign-in/email"
            : "/api/auth/sign-in/username",
          values.identifier.includes("@")
            ? { email: values.identifier, password: values.password }
            : { username: values.identifier, password: values.password },
        );
        await refresh();
      } else if (view === "resetRequest") {
        await request("/api/auth/request-password-reset", {
          email: values.email,
          redirectTo: new URL("/auth", window.location.origin).href,
        });
        setNotice("accepted");
      } else if (view === "reset") {
        if (!resetToken) throw Error("identity.reset");
        await request("/api/auth/reset-password", {
          token: resetToken,
          newPassword: values.newPassword,
        });
        setResetToken(null);
        setEnrollment(null);
        setChoice("login");
        await refresh();
      } else if (view === "setPassword") {
        await request("/api/auth/forma-set-password", {
          newPassword: values.newPassword,
        });
        await refresh();
      } else if (view === "enroll") {
        const result = await request("/api/auth/two-factor/enable", {
          password: values.currentPassword,
        });
        if (
          typeof result.totpURI !== "string" ||
          !Array.isArray(result.backupCodes) ||
          result.backupCodes.some((code) => typeof code !== "string")
        )
          throw Error("identity.enrollment");
        const uri = new URL(result.totpURI);
        if (
          uri.protocol !== "otpauth:" ||
          uri.hostname !== "totp" ||
          !uri.searchParams.get("secret")
        )
          throw Error("identity.enrollment");
        setEnrollment({
          manualKey: uri.searchParams.get("secret"),
          totpURI: result.totpURI,
          backupCodes: result.backupCodes,
        });
      } else if (view === "challenge" || view === "enrollmentConfirm") {
        await request("/api/auth/two-factor/verify-totp", {
          code: values.code,
        });
        setEnrollment(null);
        await refresh();
      } else if (view === "recovery") {
        await request("/api/auth/two-factor/verify-backup-code", {
          code: values.recoveryCode,
        });
        setEnrollment(null);
        await refresh();
      }
      const current = await refresh();
      if (current.stage === "authenticated") window.location.assign("/");
    } catch {
      setError("identity.request");
      await refresh().catch(() => {});
      throw Error("identity.request");
    }
  }
  const providers = configuredMockProviders(descriptor || {}).map(
    (provider) => ({
      ...provider,
      label: en[provider.labelKey],
      onSelect: async () => {
        setError(null);
        setNotice(null);
        try {
          const callbackURL = new URL("" + "/auth", window.location.origin)
            .href;
          const result = await request("/api/auth/sign-in/social", {
            provider: provider.id,
            callbackURL,
            errorCallbackURL: callbackURL,
            disableRedirect: true,
          });
          window.location.assign(
            mockRedirectURL(result, {
              origin: window.location.origin,
              basePath: "",
              providerId: provider.id,
            }),
          );
        } catch {
          setError("social");
          throw Error("identity.request");
        }
      },
    }),
  );
  if (!descriptor)
    return (
      <main>
        <p role={failed ? "alert" : "status"}>
          {failed ? en.error : en.loading}
        </p>
        {failed && (
          <button type="button" onClick={() => refresh().catch(() => {})}>
            {en.checkSession}
          </button>
        )}
      </main>
    );
  if (stage === "authenticated" && resetToken === null)
    return (
      <main>
        <p>{en.authenticated}</p>
        <a href="/">{en.openWorkspace}</a>
        <IdentityControls />
      </main>
    );
  if (stage === "forbidden" && resetToken === null)
    return (
      <main>
        <p role="alert">{en.forbidden}</p>
        <IdentityControls />
      </main>
    );
  return (
    <main>
      <AuthPresentation
        view={view}
        onSubmit={submit}
        onNavigate={navigate}
        busy={navigationBusy}
        enrollmentDetails={enrollment ? { ...enrollment, qrDataURL } : null}
        noticeCode={notice}
        errorCode={error}
        providers={providers}
      />
      {error && (
        <button type="button" onClick={() => refresh().catch(() => {})}>
          {en.checkSession}
        </button>
      )}
      {(stage === "enroll" || stage === "challenge") && <IdentityControls />}
    </main>
  );
}
