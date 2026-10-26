"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import config from "./config.js";
import { localization } from "./i18n.js";
import { recordStats } from "./navigation.js";
import { components } from "./components/registry.jsx";
import Icon from "./components/Icon.jsx";
const i = localization(config.locale),
  { Shell, RecordForm, RecordCard } = components;
const knownErrors = new Set([
  "records.error.invalid",
  "records.error.notFound",
  "records.error.stale",
  "records.error.origin",
  "records.error.request",
]);
async function request(path, method = "GET", data) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: data ? { "Content-Type": "application/json" } : {},
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("records.error.request");
  }
  if (!response.ok)
    throw new Error(
      knownErrors.has(result.error_code)
        ? result.error_code
        : "records.error.request",
    );
  return result;
}
export default function Starter({ page }) {
  const [records, setRecords] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [notice, setNotice] = useState(null),
    [connection, setConnection] = useState("connecting"),
    [filter, setFilter] = useState("all");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request("/api/records");
      setRecords(data.records);
      setConnection("connected");
      return true;
    } catch (e) {
      setError(
        knownErrors.has(e.message) ? e.message : "records.error.request",
      );
      setConnection("unavailable");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    request("/api/records")
      .then((data) => {
        if (active) {
          setRecords(data.records);
          setConnection("connected");
        }
      })
      .catch((e) => {
        if (active) {
          setError(
            knownErrors.has(e.message) ? e.message : "records.error.request",
          );
          setConnection("unavailable");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function mutate(path, method, data, message) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request(path, method, data);
      setNotice(message);
      await refresh();
      return true;
    } catch (e) {
      setError(
        knownErrors.has(e.message) ? e.message : "records.error.request",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const stats = recordStats(records);
  function empty() {
    return (
      <div className="empty-state">
        <span>
          <Icon name="records" width="28" height="28" />
        </span>
        <h3>{i.t("records.emptyTitle")}</h3>
        <p>{i.t("records.emptyHint")}</p>
      </div>
    );
  }
  return (
    <Shell
      config={config}
      page={page}
      i={i}
      connection={connection}
      onRefresh={() => {
        setError(null);
        setNotice(null);
        refresh();
      }}
      refreshing={loading || busy}
    >
      <section className="page-heading">
        <p className="eyebrow">
          {i.t(`${page === "configuration" ? "guide" : page}.eyebrow`)}
        </p>
        <h1>{i.t(`${page === "configuration" ? "guide" : page}.title`)}</h1>
        <p>{i.t(`${page === "configuration" ? "guide" : page}.subtitle`)}</p>
      </section>
      {error && (
        <div
          id="workspace-error"
          className="feedback error-feedback"
          role="alert"
        >
          {i.t(error)}
        </div>
      )}
      {notice && (
        <div className="feedback success-feedback" role="status">
          {i.t(notice)}
        </div>
      )}
      {page === "overview" ? (
        <>
          <section className="metrics" aria-busy={loading}>
            {[
              [stats.total, "overview.total", "records"],
              [stats.open, "overview.open", "overview"],
              [stats.completed, "overview.complete", "check"],
            ].map(([value, label, icon]) => (
              <article key={label}>
                <span className="metric-icon">
                  <Icon name={icon} />
                </span>
                <p>{i.t(label)}</p>
                <strong>{loading ? "—" : i.number(value)}</strong>
              </article>
            ))}
            <article className="progress-metric">
              <p>{i.t("overview.progress")}</p>
              <strong>
                {loading
                  ? "—"
                  : i.number(stats.progress, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    })}
              </strong>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${stats.progress * 100}%` }} />
              </div>
            </article>
          </section>
          <div className="overview-grid">
            <section className="panel recent-panel">
              <div className="panel-header">
                <div>
                  <h2>{i.t("overview.recent")}</h2>
                  <p>{i.t("overview.recentHint")}</p>
                </div>
                <Link className="text-button" href="/records">
                  {i.t("overview.seeAll")}
                  <Icon name="arrow" width="16" height="16" />
                </Link>
              </div>
              {loading ? (
                <p className="loading-state" role="status">
                  {i.t("records.loading")}
                </p>
              ) : records.length ? (
                <div>
                  {records.slice(0, 4).map((record) => (
                    <RecordCard key={record.id} record={record} i={i} compact />
                  ))}
                </div>
              ) : (
                empty()
              )}
            </section>
            <aside className="source-card">
              <div className="source-orbit">
                <Icon name="mark" width="46" height="46" />
              </div>
              <p className="eyebrow">{i.t("overview.customizationLabel")}</p>
              <h2>{i.t("overview.foundation")}</h2>
              <p>{i.t("overview.foundationHint")}</p>
              <Link className="text-button" href="/configuration">
                {i.t("overview.explore")}
                <Icon name="arrow" />
              </Link>
            </aside>
          </div>
          <section className="customization-banner">
            <span className="section-icon">
              <Icon name="source" />
            </span>
            <div>
              <h2>{i.t("overview.customizationTitle")}</h2>
              <p>{i.t("overview.customizationText")}</p>
            </div>
          </section>
        </>
      ) : page === "records" ? (
        <div className="records-grid">
          <RecordForm
            i={i}
            error={error}
            busy={busy}
            onCreate={(data) =>
              mutate("/api/records", "POST", data, "records.saved")
            }
          />
          <section className="panel records-panel">
            <div className="panel-header">
              <div>
                <h2>{i.t("records.listTitle")}</h2>
                <p>{i.t("app.recordsCount", { count: records.length })}</p>
              </div>
              <label className="filter-label">
                <span className="visually-hidden">
                  {i.t("records.filterLabel")}
                </span>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  {["all", "todo", "done"].map((value) => (
                    <option key={value} value={value}>
                      {i.t(`records.filter.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {loading ? (
              <p role="status" className="loading-state">
                {i.t("records.loading")}
              </p>
            ) : !records.length ? (
              empty()
            ) : records.filter((r) => filter === "all" || r.status === filter)
                .length ? (
              records
                .filter((r) => filter === "all" || r.status === filter)
                .map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    i={i}
                    busy={busy}
                    onStatus={(row) =>
                      mutate(
                        `/api/records/${row.id}`,
                        "PATCH",
                        {
                          status: row.status === "done" ? "todo" : "done",
                          expected_revision: row.revision,
                        },
                        "records.updated",
                      )
                    }
                  />
                ))
            ) : (
              <p className="loading-state">{i.t("records.filteredEmpty")}</p>
            )}
          </section>
        </div>
      ) : (
        <div className="guide-grid">
          <section className="panel guide-panel">
            {[
              ["config", "app.config.json"],
              ["components", "frontend/src/components/registry.jsx"],
              ["data", "backend/server.py"],
              ["limit", null],
            ].map(([key, path]) => (
              <article key={key}>
                <span className="section-icon">
                  <Icon
                    name={
                      key === "components"
                        ? "source"
                        : key === "data"
                          ? "records"
                          : "overview"
                    }
                  />
                </span>
                <div>
                  <h2>{i.t(`guide.${key}Title`)}</h2>
                  <p>{i.t(`guide.${key}Hint`)}</p>
                  {path && <code>{path}</code>}
                </div>
              </article>
            ))}
          </section>
          <aside className="panel settings-panel">
            <h2>{i.t("guide.settingsTitle")}</h2>
            <dl>
              {[
                ["theme", i.t(`guide.theme.${config.theme.preset}`)],
                ["layout", i.t(`guide.layout.${config.navigation.layout}`)],
                ["locale", i.t(`guide.locale.${config.locale}`)],
                ["auth", i.t("guide.auth.none")],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{i.t(`guide.setting.${key}`)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      )}
    </Shell>
  );
}
