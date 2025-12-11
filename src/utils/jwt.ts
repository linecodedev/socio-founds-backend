import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  cooperativeId: string | null;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
}

export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}
