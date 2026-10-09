import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { isPrismaError, mapPrismaError } from '../utils/prisma-error.mapper.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any).id || null;
    
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = [];

    let activeException = exception;

    if (isPrismaError(exception)) {
      activeException = mapPrismaError(exception);
    }

    if (activeException instanceof HttpException) {
      status = activeException.getStatus();
      const exceptionResponse: any = activeException.getResponse();
      message = typeof exceptionResponse === 'string' ? exceptionResponse : exceptionResponse.message || 'Error';
      if (typeof exceptionResponse === 'object' && Array.isArray(exceptionResponse.message)) {
        errors = exceptionResponse.message;
        message = 'Validation failed';
      } else if (typeof exceptionResponse === 'object' && exceptionResponse.code) {
        errors = [exceptionResponse.code];
      }
    } else {
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : 'Unknown'}`,
        exception instanceof Error ? exception.stack : '',
        requestId
      );
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };

    if (status >= 500) {
        this.logger.error(`${request.method} ${request.url} ${status} - ${message}`, exception instanceof Error ? exception.stack : '', requestId);
    } else {
        this.logger.warn(`${request.method} ${request.url} ${status} - ${message}`, requestId);
    }

    response.status(status).json(errorResponse);
  }
}
