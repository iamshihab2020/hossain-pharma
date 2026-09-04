import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleController } from './google.controller.js';
import { GoogleService } from './google.service.js';

@Module({
  controllers: [AuthController, GoogleController],
  providers: [AuthService, GoogleService],
  exports: [AuthService],
})
export class AuthModule {}
