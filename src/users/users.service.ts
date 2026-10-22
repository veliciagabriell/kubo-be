import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SupabaseStorageService } from '../supabase/supabase-storage.service';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly storage: SupabaseStorageService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.userRepo.create(data);
    return this.userRepo.save(user);
  }

  async deleteById(userId: string): Promise<void> {
    await this.userRepo.delete({ id: userId });
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    certificate?: Express.Multer.File,
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    Object.assign(user, dto);
    if (certificate) {
      const previousReference = user.umkmCertificateUrl;
      const objectPath = `users/${user.id}/certificates/${randomUUID()}${extname(certificate.originalname).toLowerCase()}`;
      user.umkmCertificateUrl = await this.storage.upload(
        objectPath,
        certificate.buffer,
        certificate.mimetype,
      );
      const saved = await this.userRepo.save(user);
      if (previousReference) await this.storage.remove([previousReference]);
      return saved;
    }

    return this.userRepo.save(user);
  }
}
