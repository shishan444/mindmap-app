import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";

/**
 * 自动保存 hook：监听 store 变化，防抖 N 秒后保存。
 *
 * 实现方式：用 store.subscribe 监听所有 state 变化（不依赖 React re-render），
 * 每次变化都重置计时器。这样 markDirty、updateContent、setPriorityForSelected
 * 都能正确触发防抖。
 *
 * - 仅在 dirty=true + content + filePath 同时满足时调度
 * - 防抖：每次相关 state 变化都重置计时器
 * - 保存中不重复触发
 * - 失败时设置 saveStatus='error'，下次尝试仍可触发
 */
export function useAutoSave() {
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    const scheduleSave = () => {
      const s = useMindMapStore.getState();
      if (!s.dirty || !s.content || !s.filePath) return;
      if (savingRef.current) return;

      // 清除已有计时器（防抖）
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      const interval = (s.config?.auto_save_interval_sec ?? 2) * 1000;
      timerRef.current = window.setTimeout(async () => {
        timerRef.current = null;
        if (savingRef.current) return;
        savingRef.current = true;
        try {
          const latest = useMindMapStore.getState();
          if (!latest.content || !latest.filePath) {
            savingRef.current = false;
            return;
          }
          latest.setSaveStatus("saving");
          await invoke("save_mmap", {
            path: latest.filePath,
            content: latest.content,
          });
          latest.markSaved();
        } catch (e) {
          console.error("[auto-save] 失败", e);
          useMindMapStore.getState().setSaveStatus("error");
        } finally {
          savingRef.current = false;
        }
      }, interval);
    };

    // 首次挂载时主动检查一次（处理 hook 挂载时已经 dirty 的情况）
    scheduleSave();

    const unsub = useMindMapStore.subscribe(scheduleSave);

    return () => {
      unsub();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
