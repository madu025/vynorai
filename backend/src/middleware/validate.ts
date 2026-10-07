import { Request, Response, NextFunction } from "express";
import { z, ZodError, ZodType } from "zod";

export { z };

export interface ValidateOptions {
  shape?: "flat" | "nested";
  code?: string;
  statusCode?: number;
}

export function formatZodError(error: ZodError): string {
  const issues = (error && (error.issues || (error as any).errors)) || [];
  const first = issues[0];
  if (!first) return "Validation error";
  return first.message || "Validation error";
}

/**
 * Express middleware that validates req.body against a Zod schema.
 * Replaces req.body with the parsed/transformed data if valid.
 * Returns 400 Bad Request with structured error if invalid.
 */
export function validateBody<T>(schema: ZodType<T>, options?: ValidateOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const msg = formatZodError(parsed.error);
      const issues =
        parsed.error?.issues || (parsed.error as any)?.errors || [];
      const status = options?.statusCode || 400;
      if (options?.shape === "nested") {
        return res.status(status).json({
          error: {
            code: options?.code || "VALIDATION_ERROR",
            message: msg,
            details: issues,
          },
        });
      }
      return res.status(status).json({
        error: msg,
        details: issues,
      });
    }
    req.body = parsed.data;
    next();
  };
}

/**
 * Express middleware that validates req.query against a Zod schema.
 */
export function validateQuery<T>(
  schema: ZodType<T>,
  options?: ValidateOptions,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      const msg = formatZodError(parsed.error);
      const issues =
        parsed.error?.issues || (parsed.error as any)?.errors || [];
      const status = options?.statusCode || 400;
      if (options?.shape === "nested") {
        return res.status(status).json({
          error: {
            code: options?.code || "VALIDATION_ERROR",
            message: msg,
            details: issues,
          },
        });
      }
      return res.status(status).json({
        error: msg,
        details: issues,
      });
    }
    (req as any).validatedQuery = parsed.data;
    next();
  };
}

/**
 * Express middleware that validates req.params against a Zod schema.
 */
export function validateParams<T>(
  schema: ZodType<T>,
  options?: ValidateOptions,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      const msg = formatZodError(parsed.error);
      const issues =
        parsed.error?.issues || (parsed.error as any)?.errors || [];
      const status = options?.statusCode || 400;
      if (options?.shape === "nested") {
        return res.status(status).json({
          error: {
            code: options?.code || "VALIDATION_ERROR",
            message: msg,
            details: issues,
          },
        });
      }
      return res.status(status).json({
        error: msg,
        details: issues,
      });
    }
    (req as any).validatedParams = parsed.data;
    next();
  };
}
