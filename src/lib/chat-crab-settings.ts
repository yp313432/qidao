/** Migrate old choices on read, including imported backups. */
export function chatCrabSize(size?: number): 36 | 44 | 52 {
  if (size === 28) return 36;
  if (size === 32) return 44;
  if (size === 36 || size === 44 || size === 52) return size;
  return 44;
}
