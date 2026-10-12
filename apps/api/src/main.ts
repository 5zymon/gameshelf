import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SESSION_COOKIE_NAME } from './auth/session-cookie';
import { createGlobalValidationPipe } from './common/validation-pipe';

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

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`GameShelf API listening on http://localhost:${String(port)}`);
}

void bootstrap();
