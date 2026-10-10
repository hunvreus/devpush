export type FormErrors = Record<string, string | undefined>

export function formErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): FormErrors {
  const errors: FormErrors = {}
  for (const issue of issues)
    errors[issue.path.map(String).join('.') || 'form'] ??= issue.message
  return errors
}
