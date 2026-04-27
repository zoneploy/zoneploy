import slugify from 'slugify'
import { nanoid } from 'nanoid'

/**
 * Generates a URL-friendly slug from text.
 * Adds a short random suffix to guarantee uniqueness.
 */
export function generateSlug(text: string): string {
  const base = slugify(text, {
    lower: true,
    strict: true,   // Only alphanumeric characters and hyphens.
    trim: true,
  }).slice(0, 40)   // Maximum 40 chars from the base segment.

  const suffix = nanoid(6).toLowerCase()
  return `${base}-${suffix}`
}
