import { z } from 'zod';

const queryBoolean = z.preprocess(
  (value) => value === undefined ? 'true' : value,
  z.enum(['true', 'false']).transform((value) => value === 'true'),
);

export const excelExportQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  includeCommands: queryBoolean,
  includeEvents: queryBoolean,
}).superRefine((value, context) => {
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  if (to <= from) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Thời gian kết thúc phải sau thời gian bắt đầu.' });
    return;
  }
  const maximumRangeMs = 31 * 24 * 60 * 60 * 1_000;
  if (to - from > maximumRangeMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Mỗi lần chỉ được xuất tối đa 31 ngày.' });
  }
});

export type ExcelExportQuery = z.infer<typeof excelExportQuerySchema>;
