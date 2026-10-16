export function layoutTimeBlocks(items: { key: string; startsAt: string; endsAt?: string }[], from: number, before: number) {
  const blocks = items.map(item => ({ key: item.key, start: Math.max(from, Date.parse(item.startsAt)),
    end: Math.min(before, item.endsAt ? Date.parse(item.endsAt) : Date.parse(item.startsAt) + 30 * 60000), column: 0, columns: 1 }))
    .filter(block => block.start < before && block.end > from).sort((a,b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
  let group: typeof blocks = [], groupEnd = 0;
  const finish = () => { const columns = Math.max(1, ...group.map(block => block.column + 1)); for (const block of group) block.columns = columns; };
  for (const block of blocks) {
    if (block.start >= groupEnd) { finish(); group = []; }
    const occupied = new Set(group.filter(other => other.end > block.start).map(other => other.column));
    while (occupied.has(block.column)) block.column++;
    group.push(block); groupEnd = Math.max(block.end, ...group.map(other => other.end));
  }
  finish();
  return blocks;
}
