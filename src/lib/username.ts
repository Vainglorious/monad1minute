export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

export type UsernameResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate and normalize a username (public display handle).
 * Rules: 3-20 chars, letters/digits/underscore only. Trimmed of surrounding space.
 */
export function validateUsername(input: unknown): UsernameResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Username is required." };
  }
  const value = input.trim();
  if (value.length < USERNAME_MIN) {
    return { ok: false, error: `Username must be at least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, error: `Username must be at most ${USERNAME_MAX} characters.` };
  }
  if (!USERNAME_RE.test(value)) {
    return { ok: false, error: "Use only letters, numbers, and underscores." };
  }
  return { ok: true, value };
}
