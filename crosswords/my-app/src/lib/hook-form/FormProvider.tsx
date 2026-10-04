'use client'
import { ReactNode } from 'react';
import { useForm, FormProvider as RHFProvider, FieldValues, DefaultValues, UseFormReturn } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";

export interface FormProviderProps<T extends FieldValues> {
  values: DefaultValues<T>;
  children: ReactNode;
  schema: any;
  autoComplete?:boolean
  onSubmit: (data: T, methods: UseFormReturn<T>) => void | Promise<void>;
}

export const PSFormProvider = <T extends FieldValues,>({
  values,
  children,
  schema,
  autoComplete = false,
  onSubmit,
}: FormProviderProps<T>) => {
  const methods = useForm<T>({
    defaultValues: values,
    resolver: zodResolver(schema),
  });

  return (
    <RHFProvider {...methods}>

        <form onSubmit={methods.handleSubmit((data) => onSubmit(data, methods))} autoComplete={autoComplete===false?'off':''}>
          {children}
        </form>


    </RHFProvider>
  );
};
export default PSFormProvider;