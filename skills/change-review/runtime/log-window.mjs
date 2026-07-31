export function sliceLogWindow(lines, capacity, offset = 0) {
  const visibleCapacity = Math.max(0, capacity);
  const maximumOffset = Math.max(0, lines.length - visibleCapacity);
  const boundedOffset = Math.max(0, Math.min(offset, maximumOffset));
  const end = lines.length - boundedOffset;
  const start = Math.max(0, end - visibleCapacity);
  return lines.slice(start, end);
}
