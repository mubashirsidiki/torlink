import { describe, it, expect } from "vitest";
import { parsePostRows, parseDetailInfo } from "./audiobookbay";

describe("parsePostRows", () => {
  it("extracts post title and relative URL", () => {
    const html = `
      <div class="postTitle">
        <h2><a href="/post/dune-audiobook/">Dune - Frank Herbert</a></h2>
      </div>
    `;
    const rows = parsePostRows(html);
    expect(rows).toEqual([
      { path: "/post/dune-audiobook/", name: "Dune - Frank Herbert" },
    ]);
  });
});

describe("parseDetailInfo", () => {
  it("extracts info hash and file size from detail page HTML with inner tags and plural units", () => {
    const html = `
      <tr><td>Info Hash:</td>
      <td>e0355dc8df90778b0e22f37c04b8953603ecc991</td></tr>
      <tr><td>Combined File Size:</td>
      <td><span style='color:#00f;'>1.1</span> GBs</td></tr>
    `;
    const info = parseDetailInfo(html);
    expect(info.infoHash).toBe("e0355dc8df90778b0e22f37c04b8953603ecc991");
    expect(info.sizeBytes).toBe(1100000000);
  });
});
