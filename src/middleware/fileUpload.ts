import fileUpload from 'express-fileupload';
import { Request, Response, NextFunction } from 'express';

export function handleFileUpload(req: Request, res: Response, next: NextFunction) {
  fileUpload({
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    abortOnLimit: true,
    useTempFiles: true,
    tempFileDir: '/tmp/',
  })(req, res, next);
}

export default handleFileUpload;
