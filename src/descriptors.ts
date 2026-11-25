/** Contiguous CBV/SRV/UAV slot search. NVIDIA descriptor size is 32 bytes. */

export interface DescriptorRange {
  offset: number;
  count: number;
}

export const DESCRIPTOR_BYTES = 32;
export const SAMPLER_HEAP_CAPACITY = 2048;
/** Shader-visible heap used by the 3060 reference plan. Not the 1e6 hardware cap. */
export const REFERENCE_VIEW_CAPACITY = 262_144;

export class DescriptorHeap {
  readonly capacity: number;
  private free: DescriptorRange[];

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("capacité de tas nulle");
    this.capacity = capacity;
    this.free = [{ offset: 0, count: capacity }];
  }

  /** First contiguous range. Returns the base slot, or null if none fits. */
  alloc(count: number): number | null {
    if (count <= 0) throw new Error("allocation vide");
    const index = this.free.findIndex((range) => range.count >= count);
    if (index < 0) return null;
    const range = this.free[index]!;
    const offset = range.offset;
    if (range.count === count) this.free.splice(index, 1);
    else this.free[index] = { offset: range.offset + count, count: range.count - count };
    return offset;
  }

  freeRange(offset: number, count: number): void {
    if (count <= 0) throw new Error("libération vide");
    if (offset < 0 || offset + count > this.capacity) throw new Error("libération hors tas");
    this.free.push({ offset, count });
    this.free.sort((a, b) => a.offset - b.offset);
    const merged: DescriptorRange[] = [];
    for (const range of this.free) {
      const prev = merged[merged.length - 1];
      if (prev && prev.offset + prev.count === range.offset) prev.count += range.count;
      else merged.push({ ...range });
    }
    this.free = merged;
  }

  freeCount(): number {
    return this.free.reduce((sum, range) => sum + range.count, 0);
  }

  largestFree(): number {
    return this.free.reduce((max, range) => Math.max(max, range.count), 0);
  }

  bytes(): number {
    return this.capacity * DESCRIPTOR_BYTES;
  }
}
