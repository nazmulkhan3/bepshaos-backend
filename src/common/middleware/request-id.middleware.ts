import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const reqId = req.headers['x-request-id'] || randomUUID();
    (req as any).id = reqId; // Assign to req object for easier access
    res.setHeader('X-Request-ID', reqId);
    next();
  }
}
