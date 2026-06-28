// utils.ts
// Tiny worker-local helpers. `summarizeForLog` flattens an unknown error into a
// loggable { name, message, stack } (or string) for the structured logger.
export const summarizeForLog = (error: unknown) => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return String(error);
};
