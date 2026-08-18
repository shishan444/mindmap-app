import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import PreferencesView from "./components/PreferencesModal";

// 注：去掉 React.StrictMode —— 它会双调用 useEffect，与 mind-elixir 的 destroy/init
// 生命周期冲突（destroy 清空 el 后无法在同一 el 上重新 init）。开发副作用检测改用 ESLint 规则。

// 独立偏好设置窗口(?view=preferences,由 Rust open_preference_window 创建):
// 只渲染设置视图,不走主 App(文档加载/托盘/MCP 桥接均不启动)。
const isPrefsWindow = new URL(window.location.href).searchParams.get("view") === "preferences";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    {isPrefsWindow ? <PreferencesView /> : <App />}
  </ErrorBoundary>,
);
