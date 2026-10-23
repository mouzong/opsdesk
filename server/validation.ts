import { z } from 'zod';
import { ENVIRONMENTS, ICON_NAMES, LIMITS } from '../shared/constants.js';
import { checkBookmarkUrl } from '../shared/url.js';
import { AppError } from './errors.js';

// Strips control characters except tab / newline / carriage return.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const cleanText = (s: string): string => s.replace(CONTROL, '').trim();

const text = (max: number, label: string, min = 0) => {
  let inner = z.string().max(max, `${label} must be at most ${max} characters.`);
  if (min > 0) inner = inner.min(min, `${label} is required.`);
  // .meta() makes the generated OpenAPI schema show the real limits instead of the pre-cleaning ones
  return z.string().max(max * 4).transform(cleanText).pipe(inner).meta({ maxLength: max, ...(min > 0 ? { minLength: min } : {}) });
};

const urlField = z.string().transform((value, ctx) => {
  const check = checkBookmarkUrl(value);
  if (!check.ok) {
    ctx.addIssue({ code: 'custom', message: check.error });
    return z.NEVER;
  }
  return check.url;
}).meta({ type: 'string', format: 'uri', maxLength: LIMITS.url, description: 'Only http:// and https:// URLs; no embedded user:password@.' });

const tagsField = z
  .array(z.string().max(LIMITS.tag * 4))
  .max(LIMITS.tagsPerBookmark * 3, `At most ${LIMITS.tagsPerBookmark} tags.`)
  .transform((tags) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const t = cleanText(raw).replace(/\s+/g, ' ').replace(/,/g, '');
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  })
  .pipe(
    z
      .array(z.string().max(LIMITS.tag, `Each tag must be at most ${LIMITS.tag} characters.`))
      .max(LIMITS.tagsPerBookmark, `At most ${LIMITS.tagsPerBookmark} tags.`),
  )
  .meta({ type: 'array', items: { type: 'string', maxLength: LIMITS.tag }, maxItems: LIMITS.tagsPerBookmark, description: 'Duplicates (case-insensitive) are removed; commas are stripped.' });

export const bookmarkShape = {
  title: text(LIMITS.title, 'Title', 1),
  url: urlField,
  description: text(LIMITS.description, 'Description').optional(),
  environment: z.enum(ENVIRONMENTS).optional(),
  owner: text(LIMITS.owner, 'Owner').optional(),
  icon: z.enum(ICON_NAMES).nullable().optional(),
  tags: tagsField.optional(),
  favorite: z.boolean().optional(),
  note: text(LIMITS.note, 'Note').optional(),
};

export const bookmarkCreate = z.object(bookmarkShape);
export const bookmarkPatch = z.object(bookmarkShape).partial();

export const workspaceCreate = z.object({
  name: text(LIMITS.name, 'Name', 1),
  icon: z.enum(ICON_NAMES).optional(),
});
export const workspacePatch = workspaceCreate.partial();

export const groupCreate = z.object({ name: text(LIMITS.name, 'Name', 1) });
export const groupPatch = z.object({ name: text(LIMITS.name, 'Name', 1).optional(), collapsed: z.boolean().optional() });

const index = z.number().int().min(0).max(100000);
export const moveWorkspaceBody = z.object({ index });
export const moveGroupBody = z.object({ workspaceId: z.string().min(1).max(64).optional(), index });
export const moveBookmarkBody = z.object({ groupId: z.string().min(1).max(64), index });

export const deleteBody = z.object({
  mode: z.enum(['delete', 'move']).optional(),
  targetId: z.string().min(1).max(64).optional(),
});

export const settingsPatch = z.object({ title: text(LIMITS.dashboardTitle, 'Title', 1) });
export const setupBody = z.object({ choice: z.enum(['sample', 'empty']) });

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  const message = first ? (first[0] === '_' ? first[1] : `${first[0]}: ${first[1]}`) : 'Invalid request.';
  throw new AppError(400, 'validation_error', message, fields);
}
