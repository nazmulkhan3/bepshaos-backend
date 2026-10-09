import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

export const BYPASS_RESPONSE_INTERCEPTOR = 'BypassResponseInterceptor';
export const BypassResponseInterceptor = Reflector.createDecorator<boolean>({ key: BYPASS_RESPONSE_INTERCEPTOR });

export interface Response<T> {
  success: boolean;
  data: T;
  meta: any;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T> | T> {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T> | T> {
    const bypass = this.reflector.getAllAndOverride<boolean>(BYPASS_RESPONSE_INTERCEPTOR, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (bypass) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // If the data already contains meta/data (e.g. pagination), just format it
        if (data && typeof data === 'object' && ('data' in data || 'meta' in data)) {
           return {
             success: true,
             data: data.data !== undefined ? data.data : data,
             meta: data.meta || null
           };
        }
        
        return {
          success: true,
          data: data !== undefined ? data : null,
          meta: null,
        };
      }),
    );
  }
}
