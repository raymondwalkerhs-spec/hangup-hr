import { CircleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { queryErrorCopy } from "@/lib/queryErrorCopy";
import styles from "./QueryErrorCard.module.css";

export function QueryErrorCard({
  error,
  pageName,
  onRetry,
  onGoBack,
}: {
  error?: unknown;
  pageName?: string;
  onRetry?: () => void;
  onGoBack?: () => void;
}) {
  const navigate = useNavigate();
  const { title, reason } = queryErrorCopy(error, pageName || "this page");

  return (
    <div className={styles.card} role="alert">
      <CircleAlert className={styles.icon} size={28} aria-hidden />
      <h2>{title}</h2>
      <p className={styles.reason}>{reason}</p>
      <div className={styles.actions}>
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (onGoBack) onGoBack();
            else if (window.history.length > 1) navigate(-1);
            else navigate("/dashboard");
          }}
        >
          Go back
        </Button>
      </div>
    </div>
  );
}
