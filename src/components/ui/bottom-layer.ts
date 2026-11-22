import { useEffect } from "react";
import { useSyncExternalStore } from "react";

/**
 * 底部胶囊的共享状态：**由谁提供内容 + 页面提供的分类项**。
 *
 * ## 为什么要放在模块级
 *
 * 底部胶囊渲染在布局层（`layouts/dashboard.tsx`），而分类项的归属页面
 * （抽卡页）在路由子树里。两者是**兄弟**关系，只能通过共享状态通信。
 *
 * ## 为什么不直接把分类节点 portal 进胶囊
 *
 * 试过。portal 依赖挂载点节点，胶囊一旦重建（key 变化、条件渲染）节点就失效，
 * 表现为「胶囊空掉」或「显示上一个页面的分类」；配合 effect 时序问题极难排查。
 * 现在页面只**交出数据**（key + 文案 + 回调），胶囊在布局层自己渲染 ——
 * 只有一层 DOM、一套命中区，没有跨组件的节点迁移。
 */

export interface PageFilter {
  key: string;
  label: string;
  onSelect: () => void;
}

interface State {
  /** 提供分类的页面路径；null 表示没有页面提供 */
  owner: string | null;
  /** 分类项 */
  filters: PageFilter[];
  /** 当前选中项 */
  activeKey: string | undefined;
  /** 用户是否手动切到了导航层 */
  manualNav: boolean;
}

let state: State = { owner: null, filters: [], activeKey: undefined, manualNav: false };

const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  const merged = { ...state, ...next };
  // 浅比较：避免无意义的通知（React 会用快照引用做相等判断）
  if (
    merged.owner === state.owner &&
    merged.filters === state.filters &&
    merged.activeKey === state.activeKey &&
    merged.manualNav === state.manualNav
  ) {
    return;
  }
  state = merged;
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

/** 页面注册自己的分类项。`filters` 引用要稳定（用 useMemo），否则会反复通知。 */
export function useRegisterPageFilters(
  path: string,
  filters: PageFilter[],
  activeKey: string | undefined,
) {
  // 注册 / 注销
  useEffect(() => {
    setState({ owner: path, manualNav: false });
    return () => {
      // 只在自己的占位仍然有效时清空，避免清掉新页面的注册
      if (state.owner === path) {
        setState({ owner: null, filters: [], activeKey: undefined, manualNav: false });
      }
    };
  }, [path]);

  // 分类项 / 选中项变化时同步
  useEffect(() => {
    if (state.owner !== path) return;
    setState({ filters, activeKey });
  }, [path, filters, activeKey]);
}

/** 底部胶囊读取当前状态。 */
export function useBottomLayer(): {
  owner: string | null;
  filters: PageFilter[];
  activeKey: string | undefined;
  showsNav: boolean;
  toggle: () => void;
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const hasFilters = snap.owner !== null && snap.filters.length > 0;
  return {
    owner: snap.owner,
    filters: snap.filters,
    activeKey: snap.activeKey,
    showsNav: !hasFilters || snap.manualNav,
    toggle: () => setState({ manualNav: !snap.manualNav }),
  };
}