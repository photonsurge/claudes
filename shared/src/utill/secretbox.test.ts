import { encryptSecret, decryptSecret, secretboxConfigured, _resetSecretboxKey } from "./secretbox";

describe("secretbox", () => {
  const prevAppSecret = process.env.APP_SECRET;
  const prevKey = process.env.SECRETBOX_KEY;

  beforeEach(() => {
    delete process.env.SECRETBOX_KEY;
    process.env.APP_SECRET = "test-app-secret-please-change";
    _resetSecretboxKey();
  });

  afterAll(() => {
    if (prevAppSecret === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = prevAppSecret;
    if (prevKey === undefined) delete process.env.SECRETBOX_KEY;
    else process.env.SECRETBOX_KEY = prevKey;
    _resetSecretboxKey();
  });

  it("round-trips a secret", () => {
    const token = "1//0abcdef-refresh-token_XYZ";
    const blob = encryptSecret(token);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain(token);
    expect(decryptSecret(blob)).toBe(token);
  });

  it("produces a fresh IV each time (ciphertext differs, plaintext matches)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("rejects a tampered blob (auth tag fails)", () => {
    const blob = encryptSecret("secret");
    const parts = blob.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects an unrecognised format", () => {
    expect(() => decryptSecret("nope")).toThrow(/blob format/);
  });

  it("fails to decrypt with a different key", () => {
    const blob = encryptSecret("secret");
    process.env.APP_SECRET = "a-totally-different-secret";
    _resetSecretboxKey();
    expect(() => decryptSecret(blob)).toThrow();
  });

  it("accepts an explicit 32-byte base64 key and reports configured", () => {
    delete process.env.APP_SECRET;
    process.env.SECRETBOX_KEY = Buffer.alloc(32, 7).toString("base64");
    _resetSecretboxKey();
    expect(secretboxConfigured()).toBe(true);
    const blob = encryptSecret("hello");
    expect(decryptSecret(blob)).toBe("hello");
  });
});
