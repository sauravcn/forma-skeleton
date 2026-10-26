"use client";
import { useRef } from "react";
import Icon from "./Icon.jsx";
export default function RecordForm({ i, busy, onCreate, error }) {
  const title = useRef(null);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    if (
      await onCreate({ title: data.title.trim(), details: data.details.trim() })
    ) {
      form.reset();
      title.current?.focus();
    }
  }
  return (
    <section className="record-form-panel">
      <div className="section-heading">
        <span className="section-icon">
          <Icon name="plus" />
        </span>
        <div>
          <h2>{i.t("records.newTitle")}</h2>
          <p>{i.t("records.newHint")}</p>
        </div>
      </div>
      <form
        onSubmit={submit}
        aria-busy={busy}
        aria-describedby={error ? "workspace-error" : undefined}
      >
        <fieldset disabled={busy}>
          <label className="field">
            <span>{i.t("records.titleLabel")}</span>
            <input
              ref={title}
              name="title"
              required
              maxLength={200}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>
              {i.t("records.detailsLabel")}
              <small>{i.t("records.optional")}</small>
            </span>
            <textarea name="details" rows={4} maxLength={2000} />
          </label>
          <button className="primary-button" type="submit">
            <Icon name="plus" />
            {i.t(busy ? "records.saving" : "records.save")}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
