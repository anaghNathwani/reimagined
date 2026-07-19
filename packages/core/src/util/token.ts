export * as Token from "./token"

const CHARS_PER_TOKEN = 4

export const estimate = (input: string) => Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))

// Estimate token count from an object without allocating a full JSON string.
// Traverses the structure and sums string lengths with small constant overhead per node.
export function estimateObject(value: unknown): number {
  if (value === null || value === undefined) return 1
  if (typeof value === "boolean") return 1
  if (typeof value === "number") return String(value).length / CHARS_PER_TOKEN
  if (typeof value === "string") return Math.max(0, Math.round((value.length + 2) / CHARS_PER_TOKEN))
  if (Array.isArray(value)) {
    let size = 2 // [ ]
    for (let i = 0; i < value.length; i++) {
      size += estimateObject(value[i])
      if (i < value.length - 1) size += 1 // comma
    }
    return size
  }
  if (typeof value === "object") {
    let size = 2 // { }
    const keys = Object.keys(value as object)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!
      size += k.length / CHARS_PER_TOKEN + 1 // key + colon
      size += estimateObject((value as Record<string, unknown>)[k])
      if (i < keys.length - 1) size += 1 // comma
    }
    return size
  }
  return 1
}
