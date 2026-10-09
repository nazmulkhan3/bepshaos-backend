import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service.js';
import { DatabaseService } from '../../../database/database.service.js';
import { PasswordService } from './password.service.js';
import { vi } from 'vitest';

describe('SessionService', () => {
  let service: SessionService;
  let mockDb: any;
  let mockPasswordService: any;

  beforeEach(async () => {
    mockDb = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'new-session', userId: 'user1' }),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    mockPasswordService = {
      hash: vi.fn().mockResolvedValue('hashed-token'),
      verify: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: PasswordService, useValue: mockPasswordService },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  it('should create a session', async () => {
    const res = await service.createSession('user1', 'refresh', new Date());
    expect(res.id).toBe('new-session');
    expect(mockPasswordService.hash).toHaveBeenCalledWith('refresh');
    expect(mockDb.session.create).toHaveBeenCalled();
  });

  it('should verify a valid session', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    
    mockDb.session.findUnique.mockResolvedValue({
      id: 'session1',
      userId: 'user1',
      refreshTokenHash: 'hash',
      expiresAt: futureDate,
      revokedAt: null,
    });
    mockPasswordService.verify.mockResolvedValue(true);

    const res = await service.verifySession('session1', 'token');
    expect(res).toBeDefined();
    expect(res?.id).toBe('session1');
  });

  it('should return null if session is expired or revoked', async () => {
    mockDb.session.findUnique.mockResolvedValue({
      id: 'session1',
      expiresAt: new Date(Date.now() - 10000), // expired
      revokedAt: null,
    });
    
    expect(await service.verifySession('session1', 'token')).toBeNull();

    mockDb.session.findUnique.mockResolvedValue({
      id: 'session1',
      expiresAt: new Date(Date.now() + 10000),
      revokedAt: new Date(), // revoked
    });

    expect(await service.verifySession('session1', 'token')).toBeNull();
  });

  it('should revoke all sessions if token verify fails (reuse detection)', async () => {
    mockDb.session.findUnique.mockResolvedValue({
      id: 'session1',
      userId: 'user1',
      expiresAt: new Date(Date.now() + 10000),
      revokedAt: null,
    });
    mockPasswordService.verify.mockResolvedValue(false); // bad token

    expect(await service.verifySession('session1', 'bad-token')).toBeNull();
    expect(mockDb.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user1', revokedAt: null })
    }));
  });

  it('should rotate session', async () => {
    mockDb.session.findUnique.mockResolvedValue({
      id: 'session1',
      userId: 'user1',
    });
    
    await service.rotateSession('session1', 'new-refresh', new Date());
    
    expect(mockDb.session.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session1' }
    }));
    expect(mockDb.session.create).toHaveBeenCalled();
  });
});
