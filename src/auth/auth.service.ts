import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto, umkmCertificateUrl?: string) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      password: hashed,
      businessName: dto.businessName,
      businessType: dto.businessType,
      ownerAddress: dto.ownerAddress,
      businessAddress: dto.businessAddress,
      nib: dto.nib,
      umkmCertificateUrl,
    });

    const { password: _, ...result } = user as any;
    return {
      message: 'Registration successful',
      user: result,
      access_token: this.signToken(user.id, user.email),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const { password: _, ...result } = user as any;
    return {
      message: 'Login successful',
      user: result,
      access_token: this.signToken(user.id, user.email),
    };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
