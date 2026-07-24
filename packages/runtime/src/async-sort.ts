// Stable merge sort with an async comparator. Sorting goes through `host.callSort`, which is
// async (it may marshal into the isolate), so `Array.prototype.sort` can't be used. Personal
// scale keeps this cheap; stability preserves insertion order for equal keys.

export async function asyncSort<T>(arr: T[], cmp: (a: T, b: T) => Promise<number> | number): Promise<T[]> {
  if (arr.length <= 1) return arr.slice();
  const mid = arr.length >> 1;
  const [left, right] = await Promise.all([asyncSort(arr.slice(0, mid), cmp), asyncSort(arr.slice(mid), cmp)]);
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if ((await cmp(left[i]!, right[j]!)) <= 0) out.push(left[i++]!);
    else out.push(right[j++]!);
  }
  while (i < left.length) out.push(left[i++]!);
  while (j < right.length) out.push(right[j++]!);
  return out;
}
