// ESLint 9 flat config(P2-6 整改:质量门补 lint 环节)
// 策略:宽松起步(error 只保留高价值规则),存量警告逐步清零后收紧
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/target/**", "node_modules/**", "works/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // src 前端代码
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TS 项目:未定义检查由 tsc 负责(避免 window/process 误报)
      "no-undef": "off",
      // 项目风格:容错路径大量有意空 catch(带注释),降警告
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // react-hooks v6 编译器类新规则过于激进(误伤 useRef 立即更新/
      // render 期 Date.now 等既有惯用模式),降警告待逐步治理
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      // 防御式初始化(let x = null 后 try 重赋值)是既有容错风格,降警告
      "no-useless-assignment": "warn",
      // 存量债务降为警告(any 用法多,逐步收紧)
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 测试文件:静态资源读取(CSS 断言)等 require 用法合法
    files: ["src/**/*.test.*", "tests/**/*"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-assignment": "off",
    },
  },
  {
    // Node 辅助脚本(scripts/*.cjs 等,CommonJS 合法)
    files: ["**/*.{js,cjs,mjs}"],
    ignores: ["dist/**", "node_modules/**", "works/**"],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-assignment": "off",
    },
  },
);
