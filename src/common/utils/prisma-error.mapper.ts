import { HttpException, HttpStatus } from '@nestjs/common';

export function mapPrismaError(exception: any): HttpException {
  if (exception.code === 'P2002') {
    const target = exception.meta?.target || 'Resource';
    return new HttpException(
      { message: `${target} already exists.`, code: 'P2002' },
      HttpStatus.CONFLICT,
    );
  }

  if (exception.code === 'P2025') {
    return new HttpException(
      { message: 'Resource not found.', code: 'P2025' },
      HttpStatus.NOT_FOUND,
    );
  }

  if (exception.code === 'P2003') {
    return new HttpException(
      { message: 'Foreign key constraint failed.', code: 'P2003' },
      HttpStatus.BAD_REQUEST,
    );
  }

  if (exception.code === 'P2014') {
     return new HttpException(
      { message: 'Invalid ID. The change you are trying to make would violate the required relation.', code: 'P2014' },
      HttpStatus.BAD_REQUEST,
    );
  }

  // Fallback for unknown Prisma Client errors
  return new HttpException(
    { message: 'Database operation failed.', code: exception.code },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

export function isPrismaError(exception: any): boolean {
  return typeof exception === 'object' && exception !== null && 'code' in exception && typeof exception.code === 'string' && exception.code.startsWith('P');
}
