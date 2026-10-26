"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon.jsx";
import { navigationFor } from "../navigation.js";
export default function Shell({
  config,
  page,
  i,
  children,
  connection,
  onRefresh,
  refreshing,
}) {
  const [open, setOpen] = useState(false),
    button = useRef(null),
    dialog = useRef(null);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  function closeMenu() {
    setOpen(false);
    button.current?.focus();
  }
  function links(position) {
    return navigationFor(config.navigation.layout, position).map((item) => (
      <Link
        key={item.id}
        href={item.href}
        aria-current={page === item.id ? "page" : undefined}
        className={page === item.id ? "nav-link active" : "nav-link"}
        onClick={() => setOpen(false)}
      >
        <Icon name={item.icon} />
        <span>{i.t(item.labelKey)}</span>
      </Link>
    ));
  }
  const brand = (
    <Link className="app-brand" href="/">
      <span className="brand-symbol">
        <Icon name="mark" width="24" height="24" />
      </span>
      <span>
        {config.name}
        <small>{i.t("app.workspace")}</small>
      </span>
    </Link>
  );
  return (
    <div className={`app-shell layout-${config.navigation.layout}`}>
      <a className="skip-link" href="#main-content">
        {i.t("app.skip")}
      </a>
      {config.navigation.layout !== "top" && (
        <aside className="app-sidebar">
          {brand}
          <div className="sidebar-section-label">{i.t("app.workspace")}</div>
          <nav aria-label={i.t("app.navigation")}>{links("sidebar")}</nav>
          <div className="sidebar-bottom">
            <span className="sidebar-dot" />
            {i.t("app.development")}
          </div>
        </aside>
      )}
      <div className="app-body">
        <header className="app-topbar">
          <button
            ref={button}
            type="button"
            className="icon-button mobile-menu"
            aria-label={i.t("app.menu")}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" />
          </button>
          {config.navigation.layout === "top" ? (
            brand
          ) : (
            <div className="breadcrumbs">
              <span>{config.name}</span>
              <span aria-hidden="true">/</span>
              <strong>{i.t(`nav.${page}`)}</strong>
            </div>
          )}
          <nav
            className="top-navigation"
            aria-label={i.t("app.secondaryNavigation")}
          >
            {links("top")}
          </nav>
          <span className={`connection connection-${connection}`} role="status">
            <span />
            {i.t(`app.${connection}`)}
          </span>
          <button
            type="button"
            className="icon-button refresh-button"
            aria-label={i.t(refreshing ? "app.refreshing" : "app.refresh")}
            onClick={onRefresh}
            disabled={refreshing}
          >
            <Icon name="refresh" />
          </button>
        </header>
        <main id="main-content" tabIndex="-1">
          {children}
        </main>
        <footer className="app-footer">
          <span>{config.name}</span>
          <span>{i.t("app.footer")}</span>
        </footer>
        <div className="development-notice" role="note">
          {i.t("app.publicNotice")}
        </div>
      </div>
      <dialog
        ref={dialog}
        className="mobile-navigation"
        onCancel={closeMenu}
        onClick={(e) => {
          if (e.target === dialog.current) closeMenu();
        }}
      >
        <div className="mobile-navigation-head">
          {brand}
          <button
            type="button"
            className="icon-button"
            aria-label={i.t("app.closeMenu")}
            onClick={closeMenu}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label={i.t("app.navigation")}>{links("mobile")}</nav>
        <p className="mobile-notice">{i.t("app.publicNotice")}</p>
      </dialog>
    </div>
  );
}
