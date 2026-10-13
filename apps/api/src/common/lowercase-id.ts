import type { TransformFnParams } from 'class-transformer';

/**
 * Lowercases a UUIDv7 id, or every string element of an id array, before
 * validation. Non-string values pass through unchanged so the validators still
 * reject them.
 *
 * `@IsUUID('7')` is case-insensitive, so without this an uppercase id would
 * pass validation and then be stored or compared verbatim (ADR-006 D6): e.g.
 * `games.platform_id` would hold an uppercase UUID, and the merge self-check
 * in `PlatformsService` would miss an uppercase copy of its own source id.
 */
export function lowercaseIdValue(value: unknown): unknown {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) return value.map(lowercaseIdValue);
  return value;
}

/**
 * `@Transform(lowercaseId)` for a single id property. The global
 * `ValidationPipe` runs with `transform: true`, so class-transformer applies
 * this before `@IsUUID('7')` validates.
 */
export function lowercaseId({ value }: TransformFnParams): unknown {
  return lowercaseIdValue(value);
}

/**
 * `@Transform(lowercaseIdArray)` for a repeated query id: wraps a single value
 * into a one-element array (the existing query behaviour) and lowercases every
 * element.
 */
export function lowercaseIdArray({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null) return undefined;
  return lowercaseIdValue(Array.isArray(value) ? value : [value]);
}
