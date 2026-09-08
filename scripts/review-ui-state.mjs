export function stableMediaId(item, position) {
  const value = item?.galleryLocalPaths?.[position] || item?.gallery?.[position]
    || item?.localPath || item?.image || `position-${position}`;
  const clean = String(value).split(/[?#]/)[0].replace(/\\/g, "/");
  return clean.split("/").filter(Boolean).at(-1) || `position-${position}`;
}

export function singleStateKey(item, position) {
  return `${item.id}:${stableMediaId(item, position)}`;
}

export function stableMediaIdsForPositions(item, positions) {
  return positions.map((position) => stableMediaId(item, position));
}

export function positionsForStableMedia(item, identifiers) {
  const keys = new Set(identifiers.map(String));
  return (item?.gallery || []).map((_source, position) => position).filter((position) =>
    keys.has(stableMediaId(item, position)) || keys.has(String(position)) || keys.has(`position-${position}`));
}
