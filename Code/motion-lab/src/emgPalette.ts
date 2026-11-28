export const emgPalette = {
  BB:  { raw: '#2B8CBE', envelope: '#176087' },
  TB:  { raw: '#7E57C2', envelope: '#543592' },
  AD:  { raw: '#009E73', envelope: '#006E4F' },
  MD:  { raw: '#D95F02', envelope: '#A34300' },
  FCR: { raw: '#C94A7C', envelope: '#942E57' },
  ECR: { raw: '#64748B', envelope: '#3F4C5E' },
} as const;

export type EmgColor = (typeof emgPalette)[keyof typeof emgPalette];
