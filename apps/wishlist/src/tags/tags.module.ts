import { Module } from '@nestjs/common';
import { AuthzModule } from '@app/auth';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from '../gifts/tag.entity';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [AuthzModule, TypeOrmModule.forFeature([Tag])],
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
