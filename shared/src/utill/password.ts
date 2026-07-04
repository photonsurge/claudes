/**
 * Password hashing for admin accounts. Centralized here so `public` (login,
 * user creation) and `worker` (the seed-admin script) never import `bcryptjs`
 * directly — one library, one place it's configured.
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, SALT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
