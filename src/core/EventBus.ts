type Listener<T> = (payload: T) => void;

export class EventBus<M> {
  private readonly listeners = new Map<keyof M, Set<Listener<unknown>>>();

  on<K extends keyof M>(key: K, fn: (payload: M[K]) => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn as Listener<unknown>);
    return () => {
      set?.delete(fn as Listener<unknown>);
    };
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const fn of set) {
      (fn as Listener<M[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
