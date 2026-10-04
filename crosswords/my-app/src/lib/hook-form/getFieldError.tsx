import { FieldErrors, get } from 'react-hook-form';

export function getFieldError(
  errors: FieldErrors,
  name: string
) {
  const err = get(errors, name) as { message?: string } | undefined;
  const message = err?.message;
  return {
    message,
    hasError: Boolean(message),
  };
}
