import { Test, TestingModule } from '@nestjs/testing';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

describe('GiftsController', () => {
  let giftsController: GiftsController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [GiftsController],
      providers: [GiftsService],
    }).compile();

    giftsController = app.get<GiftsController>(GiftsController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(giftsController.getHello()).toBe('Hello World!');
    });
  });
});
