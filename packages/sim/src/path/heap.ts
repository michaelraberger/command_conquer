/** Binary min-heap of integer items keyed by integer priority. */
export class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.prios.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent]! <= this.prios[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Removes and returns the item with the lowest priority (-1 if empty). */
  pop(): number {
    const n = this.items.length;
    if (n === 0) return -1;
    const top = this.items[0]!;
    if (n === 1) {
      this.items.pop();
      this.prios.pop();
      return top;
    }
    this.items[0] = this.items.pop()!;
    this.prios[0] = this.prios.pop()!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < this.items.length && this.prios[l]! < this.prios[smallest]!) smallest = l;
      if (r < this.items.length && this.prios[r]! < this.prios[smallest]!) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = ti;
    const tp = this.prios[a]!;
    this.prios[a] = this.prios[b]!;
    this.prios[b] = tp;
  }
}
