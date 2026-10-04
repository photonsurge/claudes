/**
 * The Words list's query string ↔ BankWordQuery, and the Mongo filter the
 * shared builder makes from it.
 */
import { bankPaging, bankWordFilter, bankWordSort } from "@photonsurge/shared/crossword-bank";
import { bankQueryString, parseBankQuery } from "./query";

const parse = (qs: string) => parseBankQuery(new URLSearchParams(qs));

it("is empty for the default view", () => {
  expect(parse("")).toEqual({});
  expect(bankQueryString({})).toBe("");
});

it("reads every filter", () => {
  expect(parse("q=wreck&letter=w&status=done&band=common&accepted=1&sort=zipf&dir=asc&page=3&size=100")).toEqual({
    search: "wreck",
    startsWith: "W",
    clueStatus: "done",
    band: "common",
    acceptedOnly: true,
    sort: "zipf",
    dir: "asc",
    page: 3,
    pageSize: 100,
  });
  expect(parse("review=true&band=none")).toEqual({ reviewOnly: true, band: "none" });
});

it("drops unknown or malformed values", () => {
  expect(
    parse("letter=ab&status=nope&band=huge&accepted=yes&sort=random&dir=up&page=-2&size=7&q=%20%20"),
  ).toEqual({});
  expect(parse("page=1.5&size=abc")).toEqual({});
  expect(parse("page=1")).toEqual({});
});

it("round-trips through the query string", () => {
  const q = { search: "milk", startsWith: "M", clueStatus: "failed" as const, reviewOnly: true, sort: "length" as const, page: 2, pageSize: 25 };
  expect(parse(bankQueryString(q))).toEqual(q);
});

it("builds the Mongo filter, sort and paging from the URL", () => {
  const q = parse("q=ar&letter=c&status=done&band=known&accepted=1&sort=word&size=25&page=4");
  expect(bankWordFilter(q)).toEqual({
    $and: [
      { norm: { $regex: "^C" } },
      { norm: { $regex: "AR" } },
      { "enrichment.status": "done" },
      { "validation.decision": "accepted" },
      { "validation.sources.wordfreq.zipf": { $gte: 3, $lt: 4 } },
    ],
  });
  expect(bankWordSort(q)).toEqual({ norm: 1, _id: 1 });
  expect(bankPaging(q)).toEqual({ skip: 75, limit: 25, page: 4, pageSize: 25 });
});
