const BUCKET = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/logos/`

/** Stable pastel per company, so a logo-less row still reads as that company. */
function monogramColour(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return { bg: `hsl(${h} 62% 92%)`, fg: `hsl(${h} 55% 32%)` }
}

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Company mark. Renders the stored favicon when there is one, otherwise a
 * deterministic monogram — never a broken image and never a blank square.
 *
 * Logos are fetched once by `workers/logos.mjs` and served from our own bucket,
 * so no third party learns which companies she is tracking.
 */
export function Logo({
  name,
  slug,
  path,
  src,
  size = 28,
  round,
}: {
  name: string | null
  slug?: string | null
  /** Object path in the public logos bucket. */
  path?: string | null
  /** A ready-made URL, used for signed avatars from the private bucket. */
  src?: string | null
  size?: number
  round?: boolean
}) {
  const label = name || slug || '?'
  const box: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    borderRadius: round ? '50%' : size > 32 ? 8 : 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
  }

  const url = src || (path ? BUCKET + encodeURIComponent(path) : null)
  if (url) {
    return (
      <span style={box} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          width={src ? size : size - 6}
          height={src ? size : size - 6}
          style={{ objectFit: src ? 'cover' : 'contain', borderRadius: round ? '50%' : undefined }}
          loading="lazy"
        />
      </span>
    )
  }

  const c = monogramColour(slug || label)
  return (
    <span
      style={{ ...box, background: c.bg, border: 'none', color: c.fg, fontSize: Math.round(size * 0.4), fontWeight: 600 }}
      aria-hidden="true"
    >
      {initials(label)}
    </span>
  )
}
