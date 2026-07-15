import ReactDOM from "react-dom/client";
import App from "./App";

// 注：去掉 React.StrictMode —— 它会双调用 useEffect，与 mind-elixir 的 destroy/init
// 生命周期冲突（destroy 清空 el 后无法在同一 el 上重新 init）。开发副作用检测改用 ESLint 规则。
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
