import { bustManifestCache } from "./manifestCache";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { MANIFEST_CACHE_KEY } from "@photonsurge/shared/manifest";

jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn() }));
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const mockGetQueue = getQueue as jest.Mock;

describe("bustManifestCache", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes the shared manifest cache key on the BullMQ redis client", async () => {
    const del = jest.fn().mockResolvedValue(1);
    mockGetQueue.mockReturnValue({ client: Promise.resolve({ del }) });
    await bustManifestCache();
    expect(del).toHaveBeenCalledWith(MANIFEST_CACHE_KEY);
  });

  it("never throws when redis is unavailable (fail-open)", async () => {
    mockGetQueue.mockImplementation(() => {
      throw new Error("no redis");
    });
    await expect(bustManifestCache()).resolves.toBeUndefined();
  });
});
