import { RefreshCw, X } from "lucide-react";
import type { RefreshStatus } from "../../types";

type MobileRefreshStatusSheetProps = {
  open: boolean;
  status?: RefreshStatus | null;
  pending: boolean;
  onClose: () => void;
  onCheck: () => void;
};

export default function MobileRefreshStatusSheet({
  open,
  status,
  pending,
  onClose,
  onCheck,
}: MobileRefreshStatusSheetProps) {
  if (!open) return null;

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-bottom-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-sheet-handle" />
        <div className="mobile-sheet-header">
          <div>
            <span className="mobile-pill">SYNC</span>
            <h2>Library Refresh</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="mobile-refresh-sheet">
          <div className="mobile-refresh-sheet__status">
            <strong>{status?.status || "idle"}</strong>
            <span>{status?.message || "The library is ready."}</span>
          </div>
          <div className="mobile-refresh-sheet__meta">
            <span>Current: {status?.currentVersion || "unknown"}</span>
            <span>Remote: {status?.remoteVersion || "unknown"}</span>
            <span>Checked: {status?.checkedAt || "not yet"}</span>
          </div>
          <button
            type="button"
            className="mobile-sheet-submit"
            onClick={onCheck}
            disabled={pending || status?.status === "checking" || status?.status === "downloading" || status?.status === "applying"}
          >
            <RefreshCw size={16} />
            {pending ? "Checking…" : "Check for update"}
          </button>
        </div>
      </div>
    </div>
  );
}
