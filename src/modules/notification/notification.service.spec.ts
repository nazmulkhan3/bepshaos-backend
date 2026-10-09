import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { NotificationType } from '@prisma/client';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: DatabaseService;

  const mockPrisma = {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: DatabaseService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    prisma = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should find all with pagination', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([{ id: '1' }]);
    mockPrisma.notification.count.mockResolvedValue(1);

    const result = await service.findAll('user1', { page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
    });
  });

  it('should filter unread only', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.count.mockResolvedValue(0);

    await service.findAll('user1', { unreadOnly: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1', isRead: false },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('should get unread count', async () => {
    mockPrisma.notification.count.mockResolvedValue(5);
    const result = await service.getUnreadCount('user1');
    expect(result.count).toBe(5);
    expect(mockPrisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user1', isRead: false },
    });
  });

  it('should return error if not found', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(null);
    await expect(service.findOne('user1', 'notfound')).rejects.toThrow('Notification not found');
  });

  it('should mark as read', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({ id: '1', userId: 'user1', isRead: false });
    mockPrisma.notification.update.mockResolvedValue({ id: '1', isRead: true });

    const res = await service.markAsRead('user1', '1');
    expect(res.isRead).toBe(true);
    expect(mockPrisma.notification.update).toHaveBeenCalled();
  });

  it('should not update if already read', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue({ id: '1', userId: 'user1', isRead: true });
    
    await service.markAsRead('user1', '1');
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('should mark all as read', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });
    const res = await service.markAllAsRead('user1');
    expect(res.count).toBe(3);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user1', isRead: false },
      data: expect.any(Object),
    });
  });
});
