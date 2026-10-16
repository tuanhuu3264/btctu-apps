/**
 * Ảnh chụp các trường được nêu của một đối tượng, để ghi `before` và `after` vào nhật ký khi sửa
 * (PLAN-A A5.2). Trường nhạy cảm đưa vào `exclude` thì không bao giờ có giá trị trong ảnh chụp.
 */
export function snapshot<T extends object>(source: T, keys: readonly string[], exclude: readonly string[] = []): Record<string, unknown> {
  const skip = new Set(exclude);
  return Object.fromEntries(keys.filter((k) => !skip.has(k)).map((k) => [k, (source as Record<string, unknown>)[k] ?? null]));
}
