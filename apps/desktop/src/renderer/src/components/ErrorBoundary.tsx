import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Copy, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, copied: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled rendering error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, copied: false });
    this.props.onReset?.();
  };

  handleCopy = () => {
    const text = `${this.state.error?.name}: ${this.state.error?.message}\n\nStack:\n${this.state.error?.stack ?? ''}`;
    void navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-view" role="alert">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">
              <AlertTriangle size={36} />
            </div>
            <h2>{this.props.fallbackTitle ?? 'Something went wrong rendering this view'}</h2>
            <p className="muted small">
              An unexpected error occurred. You can reload this view or copy the error details for reporting.
            </p>
            {this.state.error && (
              <pre className="error-boundary-pre">
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <div className="error-boundary-actions">
              <button className="btn primary" onClick={this.handleReload}>
                <RotateCw size={14} /> Reload view
              </button>
              <button className="btn" onClick={this.handleCopy}>
                <Copy size={14} /> {this.state.copied ? 'Copied!' : 'Copy details'}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

