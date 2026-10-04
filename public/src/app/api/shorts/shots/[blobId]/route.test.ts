/** @jest-environment node */

/** GET /api/shorts/shots/[blobId] — an offline test's OBS screenshot from the short-tests blob namespace. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const get = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => ({ blobs: { shortTest: { get } } })) }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { GET } from "./route";

const fetchShot = (id: string) => GET(new Request(`http://x/api/shorts/shots/${id}`) as never, { params: Promise.resolve({ blobId: id }) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("serves the JPEG", async () => {
  get.mockResolvedValue(Buffer.from([0xff, 0xd8, 1]));
  const res = await fetchShot("run-1-0.jpg");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 1]));
  expect(get).toHaveBeenCalledWith("run-1-0.jpg");
});

it("404s a replaced shot, 400s a bad id, 401s a non-admin", async () => {
  get.mockResolvedValue(null);
  expect((await fetchShot("run-1-0.jpg")).status).toBe(404);
  expect((await fetchShot("..%2Fetc.jpg")).status).toBe(400);
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await fetchShot("run-1-0.jpg")).status).toBe(401);
});
