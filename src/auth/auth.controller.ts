import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register akun UMKM baru' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'name',
        'email',
        'password',
        'businessName',
        'businessType',
        'ownerAddress',
        'businessAddress',
      ],
      properties: {
        name: { type: 'string', example: 'Adi Wijaya' },
        email: { type: 'string', example: 'adi@umkm.com' },
        password: { type: 'string', example: 'Password123!' },
        businessName: { type: 'string', example: 'Batik Nusantara' },
        businessType: { type: 'string', example: 'Kerajinan Tekstil' },
        ownerAddress: {
          type: 'string',
          example: 'Jl. Merdeka No. 10, Jakarta',
        },
        businessAddress: {
          type: 'string',
          example: 'Jl. Industri No. 5, Bandung',
        },
        nib: { type: 'string', example: '1234567890123456' },
        umkm_certificate: {
          type: 'string',
          format: 'binary',
          description: 'Surat Keterangan UMKM (PDF/JPG/PNG)',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('umkm_certificate', {
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|pdf)$/i;
        cb(null, allowed.test(file.originalname));
      },
      limits: { fileSize: 3 * 1024 * 1024 },
    }),
  )
  async register(
    @Body() dto: RegisterDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.authService.register(dto, file);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login dengan email dan password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
