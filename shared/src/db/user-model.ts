import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Admin accounts. `role` is a plain string (not a schema enum) so a second
 * role can be introduced later by extending `ALLOWED_ROLES` — nothing about
 * the schema or storage layer needs to change.
 */
export const ALLOWED_ROLES = ["admin"] as const;
export type UserRole = (typeof ALLOWED_ROLES)[number];

export interface iUser extends iGeneralModel {
  email: string;
  passwordHash: string;
  role: string;
  active: boolean;
  lastLoginAt?: Date;
}

export interface iUserModel extends iUser {
  id: string;
  _id: string;
}

const UserSchema = new mongoose.Schema<iUserModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, default: "admin" },
    active: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date, required: false },
  },
  mongoTimestamps,
);

UserSchema.index({ email: 1 }, { unique: true, name: "user_email_ix" });

export const getUserModel = (conn: Connection) => getModel<iUserModel>(conn, "User", UserSchema);
