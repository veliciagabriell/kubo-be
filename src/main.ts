import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  app.enableCors();
  app.setGlobalPrefix('api/v1');
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('KUBO API')
    .setDescription(
      'KUBO Export Platform – API untuk UMKM Indonesia mengekspor ke mancanegara.\n\n' +
      'Fitur: Autentikasi, Document Assistant, Smart Container Matching, Checkout & Payment.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('Auth', 'Registrasi dan Login')
    .addTag('Users', 'Profil pengguna')
    .addTag('Documents', 'Document Assistant – generate dokumen ekspor')
    .addTag('Vessels', 'Pelacakan kapal live via AIS (AISstream.io) – Indonesia → Jepang')
    .addTag('Matching', 'Smart Container Matching berbasis AI')
    .addTag('Orders', 'Checkout, pembayaran, dan riwayat pengiriman')
    .addTag('Shipments', 'Data pengiriman ekspor UMKM')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`KUBO API running at: http://localhost:${port}/api/v1`);
  console.log(`Swagger docs    at: http://localhost:${port}/api/docs`);
}
bootstrap();
