import { applyDecorators } from '@nestjs/common';
import { ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PageDto } from '../dtos/pagination.dto.js';

export const ApiStandardResponse = (model: any, isArray: boolean = false) => {
  return applyDecorators(
    ApiResponse({
      status: 200,
      schema: {
        allOf: [
          {
            properties: {
              success: {
                type: 'boolean',
                default: true,
              },
              data: isArray
                ? {
                    type: 'array',
                    items: { $ref: getSchemaPath(model) },
                  }
                : {
                    $ref: getSchemaPath(model),
                  },
              meta: {
                type: 'object',
                nullable: true,
              },
            },
          },
        ],
      },
    }),
  );
};

export const ApiPaginatedResponse = (model: any) => {
  return applyDecorators(
    ApiResponse({
      status: 200,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageDto) },
          {
            properties: {
              success: {
                type: 'boolean',
                default: true,
              },
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(model) },
              },
              meta: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' },
                  hasPreviousPage: { type: 'boolean' },
                  hasNextPage: { type: 'boolean' },
                }
              }
            },
          },
        ],
      },
    }),
  );
};
