import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    umkmCertificateUrl?: string,
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    Object.assign(user, dto);
    if (umkmCertificateUrl) user.umkmCertificateUrl = umkmCertificateUrl;

    return this.userRepo.save(user);
  }
}
