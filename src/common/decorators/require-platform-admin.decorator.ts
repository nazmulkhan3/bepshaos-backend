import { SetMetadata } from '@nestjs/common';

export const IS_PLATFORM_ADMIN_KEY = 'isPlatformAdmin';
export const RequirePlatformAdmin = () => SetMetadata(IS_PLATFORM_ADMIN_KEY, true);
