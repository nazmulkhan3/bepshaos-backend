import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service.js';


describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should hash a password', async () => {
    const password = 'StrongPassword123!';
    const hash = await service.hash(password);
    expect(hash).toBeDefined();
    expect(hash).not.toEqual(password);
  });

  it('should verify a hashed password', async () => {
    const password = 'StrongPassword123!';
    const hash = await service.hash(password);
    
    const isValid = await service.verify(hash, password);
    expect(isValid).toBe(true);
  });

  it('should reject invalid password', async () => {
    const password = 'StrongPassword123!';
    const hash = await service.hash(password);
    
    const isValid = await service.verify(hash, 'WrongPassword123!');
    expect(isValid).toBe(false);
  });
});
