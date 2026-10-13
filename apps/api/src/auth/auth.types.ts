import type { Request } from 'express';

export interface SessionUser {
  id: string;
}

export interface SessionContext {
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedRequest extends Request {
  user: SessionUser;
  session: SessionContext;
}
