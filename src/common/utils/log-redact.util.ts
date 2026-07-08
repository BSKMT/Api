export function maskAmount(_amount: number | string): string {
  return "***";
}

export function maskReference(ref: string): string {
  if (!ref || ref.length < 8) return "***";
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

export function maskUserId(id: string): string {
  if (!id || id.length < 8) return "***";
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}
