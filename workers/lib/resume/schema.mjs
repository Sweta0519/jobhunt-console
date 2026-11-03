// The only shape Claude may answer in. Pure: no imports, no env.
//
// Claude returns ids for everything that is pinned (employers, titles, dates)
// and text only for what may change, so a posting cannot alter a fact.

const str = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const bullet = { type: 'object', additionalProperties: false, required: ['text', 'from'],
  properties: { text: str(260), from: { type: 'array', minItems: 1, maxItems: 4, items: str(12) } } };

export const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tagline', 'summary', 'skills', 'experience', 'open_source', 'projects', 'requirements', 'suspicious_instructions'],
  properties: {
    tagline: str(140),
    summary: str(700),
    skills: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['group', 'items'],
      properties: { group: str(8), items: { type: 'array', minItems: 1, maxItems: 16, items: str(80) } } } },
    experience: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['role', 'bullets'],
      properties: { role: str(8), bullets: { type: 'array', minItems: 1, maxItems: 8, items: bullet } } } },
    open_source: { type: 'array', maxItems: 6, items: bullet },
    projects: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['project', 'bullets'],
      properties: { project: str(8), bullets: { type: 'array', minItems: 1, maxItems: 5, items: bullet } } } },
    requirements: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', additionalProperties: false,
      required: ['text', 'kind', 'status', 'evidence', 'note'],
      properties: { text: str(200), kind: { enum: ['must', 'nice'] }, status: { enum: ['met', 'partial', 'gap'] },
        evidence: { type: 'array', maxItems: 6, items: str(12) }, note: { type: 'string', maxLength: 200 } } } },
    suspicious_instructions: { type: 'boolean' },
  },
};

/** Walk the schema by hand. Returns a path string for the first violation, or null. */
export function walk(schema, v, path) {
  if (schema.enum) return schema.enum.includes(v) ? null : path;
  switch (schema.type) {
    case 'string':
      if (typeof v !== 'string') return path;
      if (schema.minLength != null && v.length < schema.minLength) return path;
      if (schema.maxLength != null && v.length > schema.maxLength) return path;
      return null;
    case 'boolean':
      return typeof v === 'boolean' ? null : path;
    case 'array': {
      if (!Array.isArray(v)) return path;
      if (schema.minItems != null && v.length < schema.minItems) return path;
      if (schema.maxItems != null && v.length > schema.maxItems) return path;
      for (let i = 0; i < v.length; i++) {
        const bad = walk(schema.items, v[i], `${path}.${i}`);
        if (bad) return bad;
      }
      return null;
    }
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return path;
      for (const k of Object.keys(v)) if (!(k in schema.properties)) return `${path}.${k}`;
      for (const k of schema.required || []) if (!(k in v)) return `${path}.${k}`;
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in v) {
          const bad = walk(sub, v[k], `${path}.${k}`);
          if (bad) return bad;
        }
      }
      return null;
    }
    default:
      return path;
  }
}

/** Re-checks everything by hand: the CLI's own enforcement of maxLength was not proven. */
export function validateDraft(obj) {
  const bad = walk(DRAFT_SCHEMA, obj, '$');
  return bad ? { ok: false, code: 'schema_invalid', ref: bad } : { ok: true, code: null };
}
