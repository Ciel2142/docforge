import { Keyv } from "keyv";

type EventListener = (...args: unknown[]) => void;

// keyv@5 ships a hand-rolled EventManager whose once() wrapper has no
// Node-style `.listener` back-pointer, so removeListener(event, original)
// fails to find it. cacheable-request@13 follows the Node EE contract
// (cache.once('error', h) + cache.removeListener('error', h)), so without
// this fix every HTTP request leaks one error listener.
export class CompatKeyv<Value = unknown> extends Keyv<Value> {
  override once(event: string, listener: EventListener): void {
    const wrapper: EventListener & { listener?: EventListener } = (
      ...args: unknown[]
    ) => {
      listener(...args);
      this.off(event, wrapper);
    };
    wrapper.listener = listener;
    this.on(event, wrapper);
  }

  override off(event: string, listener: EventListener): void {
    const arr = this._eventListeners.get(event);
    if (!arr) return;
    let idx = arr.indexOf(listener);
    if (idx === -1) {
      idx = arr.findIndex(
        (l) => (l as { listener?: EventListener }).listener === listener,
      );
    }
    if (idx !== -1) {
      arr.splice(idx, 1);
      if (arr.length === 0) this._eventListeners.delete(event);
    }
  }

  override removeListener(event: string, listener: EventListener): void {
    this.off(event, listener);
  }
}
