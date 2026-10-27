// Minimal external store with React binding (useSyncExternalStore)

import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(update: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
  use<R>(selector: (s: T) => R): R;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use<R>(selector: (s: T) => R): R {
      return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(state));
    },
  };
  return store;
}
