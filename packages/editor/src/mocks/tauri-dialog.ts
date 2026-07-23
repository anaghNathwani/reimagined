export async function open(opts?: any): Promise<string | null> {
  // Use a plain input prompt as fallback
  return window.prompt("Enter folder path:") ?? null
}
