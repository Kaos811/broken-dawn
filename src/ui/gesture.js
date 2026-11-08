// A touch on a phone is sometimes followed by a compatibility mouse click at the same spot.
// Dismiss controls use this so that extra click cannot activate them. It is not a timer:
// one nearby mouse press is ignored after a touch, and a later press still works.
export function syntheticClickFilter(opening) {
  let arm = !!(opening && opening.wasTouch);
  let origin = opening ? { x: opening.x, y: opening.y } : null;
  return (pointer) => {
    if (!pointer) return true;
    if (pointer.wasTouch) {
      arm = true;
      origin = { x: pointer.x, y: pointer.y };
      return true;
    }
    if (arm && origin && Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < 96) {
      arm = false;
      return false;
    }
    return true;
  };
}
