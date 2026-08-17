/**
 * 通用「挂载 / 依赖变化时发起一次 IPC 调用」状态机，取代在每个页面里重复
 * 手写 loading/error/data 三态 `useState` + `useEffect`。
 *
 * 不做请求去重、不做跨组件缓存——每次挂载/依赖变化都会重新调用一次
 * `fn()`，语义上等价于"页面重新可见就该看到最新数据"。这也是导入存档后
 * 各页面能自然看到新账号/新记录的机制：路由切换会重新挂载目标页面，
 * 不需要额外维护一套全局缓存失效逻辑（见 Settings.tsx 导入流程的注释）。
 */
import { useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  // fn 本身通常是每次渲染新建的闭包（页面组件里的箭头函数），不能进 deps
  // 数组——那会导致每次渲染都重新拉取。用 ref 存最新的 fn，deps 数组只放
  // 调用方明确声明的"真正应该触发重新拉取"的值。
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fnRef.current().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方决定，故意不含 fnRef
  }, [...deps, reloadToken]);

  // 展开成新对象而不是 Object.assign(state, ...) 原地修改——`state` 是
  // useState 内部持有的那个引用，原地改它会绕开 React 的状态不可变假设，
  // 即使当下没有触发可见的 bug 也是隐患。这里接受"每次渲染都是新对象"的
  // 代价（下游若把整个返回值放进 useMemo/useEffect 依赖数组，等于放弃这层
  // 记忆化），量级上不构成性能问题。
  return { ...state, reload: () => setReloadToken((t) => t + 1) };
}
