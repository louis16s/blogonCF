export function decodeRouteSegment(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}
