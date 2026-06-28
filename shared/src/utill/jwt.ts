import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

const ISSUER = "thronix";

export type DecodedToken = JwtPayload & {
  sub?: string;
  actorType?: string;
};

const resolveSecret = (secretOverride?: string): string => {
  const secret = secretOverride || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return secret;
};

export const validateJwt = (token: string, secretOverride?: string): DecodedToken => {
  const secret = resolveSecret(secretOverride);
  try {
    return jwt.verify(token, secret, { issuer: ISSUER }) as DecodedToken;
  } catch (err: any) {
    if (err.name === "TokenExpiredError") throw new Error("Token expired");
    if (err.name === "JsonWebTokenError") throw new Error("Invalid token");
    throw err;
  }
};

export const generateShortLivedJwt = (
  payload: JwtPayload,
  expiresIn: SignOptions["expiresIn"] = "5m",
  secretOverride?: string,
): string => {
  const secret = resolveSecret(secretOverride);
  return jwt.sign(payload, secret, { expiresIn, issuer: ISSUER });
};
