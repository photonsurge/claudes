
export const pickRandomItems = <T>(arr: T[], count = 10): T[] => {
  if (!Array.isArray(arr)) throw new Error("pickRandomItems: arr is not an array");

  const n = arr.length;
  if (n === 0) return [];
  const k = Math.min(count, n);

  const copy = [...arr]; // if you can mutate original, remove this line and use arr directly

  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy.slice(0, k);
};
