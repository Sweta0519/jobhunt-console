/**
 * What the post will actually look like.
 *
 * Approving a poster you have not seen is approving a description of it, so
 * every visual post carries its render. Posters are tall, hence the cap and the
 * click-through to the full image.
 */
export function Preview({ src, alt, max = 320 }: { src?: string; alt?: string; max?: number }) {
  if (!src) return null
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 12 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || 'Post preview'}
        style={{
          width: '100%',
          maxWidth: max,
          borderRadius: 8,
          border: '1px solid var(--border)',
          display: 'block',
        }}
        loading="lazy"
      />
    </a>
  )
}
