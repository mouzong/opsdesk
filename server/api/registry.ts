import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Executor } from '../db/types.js';
import type { ApplyHooks } from '../importExport.js';
import type { createHealthService } from '../health.js';

export type Access = 'public' | 'read' | 'write';
export type Idempotency = 'safe' | 'idempotent' | 'not-idempotent';

export interface Ctx {
  app: AppContext;
  /** Database executor; inside a conditional (If-Match) route this is already the open transaction. */
  db: Executor;
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: any;
  body: any;
  auth: 'bearer' | 'ui' | 'anonymous';
  health: ReturnType<typeof createHealthService>;
  requestId: string;
  /** Test seam only; never reachable from HTTP input. */
  importHooks?: ApplyHooks | undefined;
}

export interface Out {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Streams a raw response (downloads). Takes precedence over body. */
  send?: (res: Response) => void | Promise<void>;
}

export interface ResponseDoc {
  description: string;
  /** Component schema id, or an inline JSON-schema object. */
  schema?: string | Record<string, unknown>;
  contentType?: string;
  headers?: Record<string, { description: string; schema: Record<string, unknown> }>;
  examples?: Record<string, { summary: string; value: unknown }>;
}

export interface RouteDef {
  operationId: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  /** OpenAPI-style path relative to the API prefix, e.g. /workspaces/{id} */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** public: no credentials. read: anonymous on localhost or bearer. write: bearer token or the bundled UI session. */
  access: Access;
  idempotency: Idempotency;
  /** Honour the Idempotency-Key header (replay of the first response). */
  idempotencyKey?: boolean;
  /** Supports If-Match / returns ETag for this resource kind (path parameter `id`). */
  conditional?: 'workspace' | 'group' | 'bookmark';
  destructive?: boolean;
  /** Used by the bundled UI only; kept for compatibility. */
  internal?: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  bodyRequired?: boolean;
  bodyDescription?: string;
  bodyExamples?: Record<string, { summary: string; value: unknown }>;
  /** multipart/form-data alternative for the request body (bearer clients only). */
  multipart?: Record<string, unknown>;
  /** Converts multipart fields + uploaded file into the JSON body shape. */
  fromMultipart?: (fields: Record<string, string>, file: { text: string; filename: string } | null) => unknown;
  success: { status: number; response: ResponseDoc };
  /** Additional documented status codes (error codes are described generically). */
  errors?: number[];
  handler: (c: Ctx) => Promise<Out>;
}
