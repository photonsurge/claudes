import type { Model } from "mongoose";
import { makeUserRepo } from "./user-repo";
import type { iUserModel } from "./user-model";

/** A minimal chainable query stub that resolves `.exec()` to `result`. */
const query = (result: unknown) => {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.sort = jest.fn(chain);
  q.lean = jest.fn(chain);
  q.exec = jest.fn(async () => result);
  return q;
};

describe("makeUserRepo", () => {
  it("create() lowercases/trims email and defaults role to admin", async () => {
    const created = {
      id: "u1",
      email: "a@b.com",
      passwordHash: "hash",
      role: "admin",
      active: true,
      _id: "x",
      __v: 0,
    };
    const model = {
      create: jest.fn(async () => ({ toObject: () => created })),
    } as unknown as Model<iUserModel>;

    const repo = makeUserRepo(model);
    const out = await repo.create({ email: " A@B.com ", passwordHash: "hash" });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", role: "admin" }),
    );
    expect(out.email).toBe("a@b.com");
  });

  it("findByEmail() lowercases the lookup and includes passwordHash", async () => {
    const doc = { id: "u1", email: "a@b.com", passwordHash: "hash", role: "admin", active: true };
    const findOne = jest.fn(() => query(doc));
    const model = { findOne } as unknown as Model<iUserModel>;

    const repo = makeUserRepo(model);
    const out = await repo.findByEmail("A@B.com");
    expect(findOne).toHaveBeenCalledWith({ email: "a@b.com" });
    expect(out?.passwordHash).toBe("hash");
  });

  it("list() never leaks passwordHash or mongo internals", async () => {
    const docs = [
      { id: "u1", email: "a@b.com", passwordHash: "hash", role: "admin", active: true, _id: "x", __v: 0 },
    ];
    const find = jest.fn(() => query(docs));
    const model = { find } as unknown as Model<iUserModel>;

    const repo = makeUserRepo(model);
    const out = await repo.list();
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("passwordHash");
    expect(out[0]).not.toHaveProperty("_id");
    expect(out[0]).not.toHaveProperty("__v");
  });

  it("findById() strips passwordHash", async () => {
    const doc = { id: "u1", email: "a@b.com", passwordHash: "hash", role: "admin", active: true };
    const findOne = jest.fn(() => query(doc));
    const model = { findOne } as unknown as Model<iUserModel>;

    const repo = makeUserRepo(model);
    const out = await repo.findById("u1");
    expect(out).not.toHaveProperty("passwordHash");
  });
});
