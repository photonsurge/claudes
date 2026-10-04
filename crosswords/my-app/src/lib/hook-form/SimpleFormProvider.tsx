import React from "react";
import {
  FormProvider as RHFProvider,
  useForm,
  type DefaultValues,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";

type FormProviderProps<T extends FieldValues> = {
  values: DefaultValues<T>;
  children: React.ReactNode;
  clearOnSubmit?: boolean;
  autoComplete?: boolean;
  onSubmit: (data: T, methods: UseFormReturn<T>) => void | Promise<void>;
};

const toEmpty = (v: any): any => {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return [];
  const t = typeof v;
  if (t === "string") return "";
  if (t === "number") return 0;
  if (t === "boolean") return false;
  if (v instanceof Date) return null; // or new Date(0) if you prefer
  if (t === "object") {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = toEmpty(v[k]);
    return out;
  }
  return undefined;
};

export const PSSimpleFormProvider = <T extends FieldValues,>({
  values,
  children,
  clearOnSubmit,
  autoComplete = false,
  onSubmit,
}: FormProviderProps<T>) => {
  const methods = useForm<T>({
    defaultValues: values as DefaultValues<T>,
    // This often helps with “fields that disappear don’t reset”
    shouldUnregister: true,
  });

  // keep form synced when values change (edit mode etc)
  React.useEffect(() => {
    methods.reset(values as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  return (
    <RHFProvider {...methods}>
      <form
        onSubmit={methods.handleSubmit(async (data) => {
          try {
            await onSubmit(data, methods);
          } finally {
            if (clearOnSubmit) {
              const empty = toEmpty(values) as T;

              // Let submit state settle, then reset (prevents “snap back” in some setups)
              queueMicrotask(() => {
                methods.reset(empty, {
                  keepErrors: false,
                  keepDirty: false,
                  keepTouched: false,
                  keepIsSubmitted: false,
                  keepSubmitCount: false,
                });
              });
            }
          }
        })}
        autoComplete={autoComplete ? undefined : "off"}
      >
        {children}
      </form>
    </RHFProvider>
  );
};

export default PSSimpleFormProvider;
