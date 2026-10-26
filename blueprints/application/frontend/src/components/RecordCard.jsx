import Icon from "./Icon.jsx";
export default function RecordCard({
  record,
  i,
  busy,
  onStatus,
  compact = false,
}) {
  return (
    <article
      className={`record-card record-${record.status}`}
      data-record-id={record.id}
    >
      <span className="record-symbol">
        <Icon name={record.status === "done" ? "check" : "records"} />
      </span>
      <div className="record-content">
        <div className="record-title-row">
          <h3>{record.title}</h3>
          <span className={`record-status status-${record.status}`}>
            {i.t(`records.status.${record.status}`)}
          </span>
        </div>
        {record.details && <p className="record-details">{record.details}</p>}
        <div className="record-meta">
          <time dateTime={record.updated_at}>
            {i.t("records.updatedAt", { date: i.date(record.updated_at) })}
          </time>
          <span>
            {i.t("records.revision", { revision: i.number(record.revision) })}
          </span>
        </div>
      </div>
      {!compact && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => onStatus(record)}
        >
          {i.t(
            record.status === "done" ? "records.reopen" : "records.markDone",
          )}
          <Icon
            name={record.status === "done" ? "refresh" : "check"}
            width="16"
            height="16"
          />
        </button>
      )}
    </article>
  );
}
