import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export const hashPassword = async (plainTextPassword: string) => {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
};

export const verifyPassword = async (plainTextPassword: string, passwordHash: string) => {
  return bcrypt.compare(plainTextPassword, passwordHash);
};
