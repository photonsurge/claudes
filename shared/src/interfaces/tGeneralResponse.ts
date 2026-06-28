export type tGeneralResponse<T = any> = {
  success: boolean;
  errors?: Record<string, string[]>;
  data?: T;
  totalCount?: number;
};
