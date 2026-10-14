import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SESSION_COOKIE_NAME } from './auth/session-cookie';
import { createGlobalValidationPipe } from './common/validation-pipe';
import { loadListenAddress } from './listen-address';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Stop the photo-import worker (and Prisma) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  app.useGlobalPipes(createGlobalValidationPipe());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('GameShelf API')
    .setDescription('Catalog API for the GameShelf game library.')
    .setVersion('0.1')
    .addCookieAuth(SESSION_COOKIE_NAME)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const { port, host } = loadListenAddress(app.get(ConfigService));
  // No API_HOST: Node's default bind, every interface (IPv4 + IPv6).
  if (host === undefined) {
    await app.listen(port);
  } else {
    await app.listen(port, host);
  }
  console.log(
    `GameShelf API listening on http://${host ?? 'localhost'}:${String(port)}`,
  );
}

void bootstrap();
