import { STATUS_LABEL } from "../../lib/format";

export function PageHead({ title, children }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export const StatusPill = ({ status }) => <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>;

export const Kpi = ({ label, value, hint }) => (
  <div className="kpi"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
);
