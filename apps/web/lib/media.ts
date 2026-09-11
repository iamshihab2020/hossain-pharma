/**
 * URLs for bytes the API serves rather than JSON.
 *
 * `NEXT_PUBLIC_` because a `<img src>` is resolved by the BROWSER, so unlike
 * every other call in `lib/api/` this one cannot go through the server-side
 * fetch wrapper - there is nothing to wrap. Next inlines the variable at build
 * time, which is what makes it readable from a client component.
 *
 * A helper rather than the string inline, because the same URL is built on the
 * product page, in the moderation queue and in the review form's preview, and
 * three copies of a base URL is how one of them ends up pointing at localhost
 * in production.
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * A review photo.
 *
 * No signing and no expiry: the review it belongs to is public, so the photo is
 * public with it. What is NOT public is a photo whose review has been removed -
 * the API refuses those, which is why this is a route rather than a link
 * straight into storage. A URL a moderator cannot revoke would be the one
 * surface that outlives a takedown.
 */
export function reviewPhotoUrl(id: string): string {
  return `${API_URL}/reviews/media/${encodeURIComponent(id)}`;
}
