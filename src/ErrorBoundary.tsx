import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * 全局错误边界:任何子组件抛错时,显示错误信息而不是白屏
 *
 * 用于诊断 Tauri webview 白板问题:如果 React 渲染中断,
 * 错误会在这里显示,而不是空白页面。
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] 捕获错误:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, fontFamily: "monospace", fontSize: 13, color: "#e74c3c" }}>
          <h2 style={{ color: "#e74c3c", marginBottom: 12 }}>⚠ React 渲染崩溃</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error?.message}
          </pre>
          <pre style={{ marginTop: 12, fontSize: 11, color: "#666" }}>
            {this.state.error?.stack}
          </pre>
          <pre style={{ marginTop: 12, fontSize: 11, color: "#999" }}>
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
