import { ValueTransformer } from 'typeorm';

/** Store dates in a format supported by both SQLite and PostgreSQL. */
export const dateColumnTransformer: ValueTransformer = {
  to(value: Date | string | null | undefined): string | null {
    if (value == null) return null;
    return (value instanceof Date ? value : new Date(value)).toISOString();
  },
  from(value: string | null): Date | null {
    return value == null ? null : new Date(value);
  },
};
