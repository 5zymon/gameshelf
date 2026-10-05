import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const FORBIDDEN_JWT_PACKAGES = [
  '@nestjs/jwt',
  'jsonwebtoken',
  'passport-jwt',
  'jose',
  'jwks-rsa',
  'express-jwt',
];

describe('API package.json (unit)', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as PackageJson;
  const names = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];

  it.each(FORBIDDEN_JWT_PACKAGES)('does not depend on %s', (name) => {
    expect(names).not.toContain(name);
  });

  it('depends on argon2 and @nestjs/schedule', () => {
    expect(names).toContain('argon2');
    expect(names).toContain('@nestjs/schedule');
  });
});
