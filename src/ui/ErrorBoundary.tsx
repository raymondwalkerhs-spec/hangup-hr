import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./ErrorBoundary.module.css";

type Props = {
  children: ReactNode;
  label?: string;
  onRetry?: () => void;
};
type State = { error: Error | null; remount: number };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, remount: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState((s) => ({ error: null, remount: s.remount + 1 }));
  };

  render() {
    if (this.state.error) {
      const isChunk = /chunkload|loading chunk|failed to fetch dynamically/i.test(this.state.error.message);
      return (
        <div className={styles.wrap} data-error-boundary="1">
          <h2>{isChunk ? "Reload the app" : `Something went wrong${this.props.label ? ` on ${this.props.label}` : ""}`}</h2>
          <p className="muted">
            {isChunk
              ? "The app was updated. Reload to get the latest version."
              : this.state.error.message}
          </p>
          {isChunk ? (
            <Button onClick={() => window.location.reload()}>Reload</Button>
          ) : (
            <Button onClick={this.retry}>Try again</Button>
          )}
        </div>
      );
    }
    return <div key={this.state.remount} data-error-boundary-root="1">{this.props.children}</div>;
  }
}
