/**
 * BDD specs for parseTraceback — IPython 8.x traceback frame extraction.
 *
 * @spec-id europa.render.traceback.parse.ipython8
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { parseTraceback } from "../../../denops/europa/render/traceback-parser.ts";

describe("parseTraceback", () => {
  it("extracts a Cell frame with line/colStart/colEnd populated", () => {
    const frames = parseTraceback(["Cell In[3], line 5"]);
    assertEquals(frames, [
      {
        kind: "cell",
        line: 0,
        colStart: 0,
        colEnd: 18,
        executionCount: 3,
        sourceLine: 5,
      },
    ]);
  });

  it("computes col offsets relative to leading whitespace, ignoring trailing text", () => {
    const frames = parseTraceback(["  Cell In[10], line 42  trailing"]);
    assertEquals(frames.length, 1);
    const f = frames[0];
    assertEquals(f.kind, "cell");
    assertEquals(f.colStart, 2);
    assertEquals(f.colEnd, 22);
  });

  it("extracts a File frame with path + sourceLine + in-func suffix in colEnd", () => {
    const frames = parseTraceback(["File ~/proj/util.py:10, in foo()"]);
    assertEquals(frames, [
      {
        kind: "file",
        line: 0,
        colStart: 0,
        colEnd: 32,
        path: "~/proj/util.py",
        sourceLine: 10,
      },
    ]);
  });

  it("strips quotes around paths containing spaces", () => {
    const frames = parseTraceback(['File "/path with space/x.py":5']);
    assertEquals(frames.length, 1);
    const f = frames[0];
    assertEquals(f.kind, "file");
    if (f.kind === "file") {
      assertEquals(f.path, "/path with space/x.py");
      assertEquals(f.sourceLine, 5);
    }
  });

  it("extracts a File frame with absolute path (no quote, no leading whitespace)", () => {
    const frames = parseTraceback([
      "File /usr/lib/python3.12/json/__init__.py:123, in loads()",
    ]);
    assertEquals(frames.length, 1);
    const f = frames[0];
    assertEquals(f.kind, "file");
    if (f.kind === "file") {
      assertEquals(f.path, "/usr/lib/python3.12/json/__init__.py");
      assertEquals(f.sourceLine, 123);
    }
  });

  it("extracts a File frame without the `, in <func>` suffix", () => {
    const frames = parseTraceback(["File ./util.py:5"]);
    assertEquals(frames.length, 1);
    const f = frames[0];
    assertEquals(f.kind, "file");
    if (f.kind === "file") {
      assertEquals(f.path, "./util.py");
      assertEquals(f.sourceLine, 5);
    }
  });

  it("does NOT match the legacy IPython 7.x <ipython-input-N-...> format (SC-017)", () => {
    const frames = parseTraceback(["<ipython-input-3-0d4c1234abcd>"]);
    assertEquals(frames, []);
  });

  it("records only the first match per line when multiple frames coexist", () => {
    const frames = parseTraceback([
      "...Cell In[3], line 5...Cell In[4], line 1...",
    ]);
    assertEquals(frames.length, 1);
    const f = frames[0];
    assertEquals(f.kind, "cell");
    if (f.kind === "cell") {
      assertEquals(f.executionCount, 3);
      assertEquals(f.sourceLine, 5);
    }
  });

  it("ignores the ename:evalue trailer line (no frame produced)", () => {
    const frames = parseTraceback([
      "Cell In[3], line 5",
      "ValueError: oops",
    ]);
    assertEquals(frames.length, 1);
    assertEquals(frames[0].line, 0);
  });

  it("produces zero frames for non-frame plain text lines", () => {
    const frames = parseTraceback(["    plain text", "  another plain"]);
    assertEquals(frames, []);
  });

  it("handles an empty input array", () => {
    assertEquals(parseTraceback([]), []);
  });
});
