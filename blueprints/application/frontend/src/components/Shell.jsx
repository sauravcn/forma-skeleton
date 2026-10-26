"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon.jsx";
import {
  navigationFor,
  navigationTree,
  navigationLabelKey,
} from "../navigation.js";
export default function Shell({
  config,
  page,
  i,
  children,
  connection,
  onRefresh,
  refreshing,
  navigationContext = {},
}) {
  const [open, setOpen] = useState(false),
    button = useRef(null),
    dialog = useRef(null),
    closeButton = useRef(null),
    main = useRef(null);
  useEffect(() => {
    if (open) {
      if (!dialog.current?.open) dialog.current?.showModal();
      closeButton.current?.focus();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    setOpen(false);
    if (dialog.current?.open) dialog.current.close();
    main.current?.focus();
  }, [page]);
  function closeMenu(restoreFocus = true) {
    setOpen(false);
    if (dialog.current?.open) dialog.current.close();
    if (restoreFocus) button.current?.focus();
  }
  function navigate() {
    closeMenu(false);
    requestAnimationFrame(() => {
      if (main.current?.isConnected) main.current.focus();
    });
  }
  function trapDialogFocus(event) {
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.current.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]",
      ),
    ].filter(
      (element) => element.tabIndex >= 0 && element.getClientRects().length,
    );
    const first = controls[0],
      last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      dialog.current.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function links(position) {
    const tree = navigationTree(
      navigationFor(
        config.navigation.layout,
        position,
        undefined,
        navigationContext,
      ),
    );
    function list(nodes, nested = false) {
      return (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            paddingInlineStart: nested ? 14 : 0,
            ...(position === "top" && !nested
              ? {
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 4,
                }
              : {}),
          }}
        >
          {nodes.map((item) => (
            <li
              key={item.id}
              style={{
                margin: 0,
                padding: 0,
                marginBlockEnd: position === "top" ? 0 : 7,
              }}
            >
              <Link
                href={item.href}
                data-navigation-id={item.id}
                aria-current={page === item.id ? "page" : undefined}
                className={page === item.id ? "nav-link active" : "nav-link"}
                onClick={navigate}
              >
                <Icon name={item.icon} />
                <span>{i.t(item.labelKey)}</span>
              </Link>
              {item.children.length > 0 && list(item.children, true)}
            </li>
          ))}
        </ul>
      );
    }
    return list(tree);
  }
  const brand = (
    <Link className="app-brand" href="/" onClick={navigate}>
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
            aria-controls="mobile-navigation"
            aria-haspopup="dialog"
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
              <strong>{i.t(navigationLabelKey(page))}</strong>
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
        <main ref={main} id="main-content" tabIndex="-1">
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
        id="mobile-navigation"
        aria-labelledby="mobile-navigation-title"
        className="mobile-navigation"
        onKeyDown={trapDialogFocus}
        onCancel={(event) => {
          event.preventDefault();
          closeMenu();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) closeMenu();
        }}
      >
        <h2 id="mobile-navigation-title" className="visually-hidden">
          {i.t("app.navigation")}
        </h2>
        <div className="mobile-navigation-head">
          {brand}
          <button
            type="button"
            className="icon-button"
            ref={closeButton}
            aria-label={i.t("app.closeMenu")}
            onClick={() => closeMenu()}
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
