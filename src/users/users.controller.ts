import {
  Body,
  Controller,
  Get,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lihat profil user yang sedang login' })
  getProfile(@CurrentUser() user: User) {
    return { data: user };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Edit profil user' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('umkm_certificate', {
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|pdf)$/i;
        cb(null, allowed.test(file.originalname));
      },
      limits: { fileSize: 3 * 1024 * 1024 },
    }),
  )
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const updated = await this.usersService.updateProfile(user.id, dto, file);
    return { message: 'Profile updated successfully', data: updated };
  }
}
