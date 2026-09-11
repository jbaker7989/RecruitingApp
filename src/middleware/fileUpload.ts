import { Request, Response, NextFunction } from 'express';

export function handleFileUpload(req: Request, res: Response, next: NextFunction) {
  next();
}
