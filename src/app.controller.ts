import { Controller, Get } from '@nestjs/common';

import { Public } from './modules/auth/decorators/public.decorator.js';

@Controller()
export class AppController {
  @Public()
  @Get()
  getHello() {
    return {
      message: 'Welcome to BebshaOS API',
      version: '1.0.0',
    };
  }
}
