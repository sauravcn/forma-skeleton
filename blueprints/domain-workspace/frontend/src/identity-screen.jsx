"use client";
import { AuthPage } from "@forma/app-foundation";
import { useI18n } from "@forma/localization";
import config from "./foundation.config.js";
function AuthLayout({ title, children }) {
  const i = useI18n();
  return (
    <section className="forma-identity workspace-identity" aria-label={title}>
      <header>
        <b>{i.t(config.brandLabelKey)}</b>
      </header>
      <div className="forma-identity__panel">{children}</div>
    </section>
  );
}
export default function IdentityScreen() {
  return <AuthPage components={{ AuthLayout }} />;
}
