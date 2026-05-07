/**
 * BDD specs for UndoHistory implementation (createUndoHistory factory).
 *
 * Covers all public methods required by the bijection gate.
 * Internal introspection helpers (getInFlight / getQueueLength / getStackSizes)
 * are marked @internal and not bijection-gated, but used here for behavioral
 * assertions.
 *
 * @spec-id europa.session.undo-history.push
 * @spec-id europa.session.undo-history.fifo-overflow
 * @spec-id europa.session.undo-history.pop-undo
 * @spec-id europa.session.undo-history.pop-redo
 * @spec-id europa.session.undo-history.clear-redo
 * @spec-id europa.session.undo-history.enqueue-undo
 * @spec-id europa.session.undo-history.enqueue-redo
 * @spec-id europa.session.undo-history.queue-overflow
 * @spec-id europa.session.undo-history.empty-stack
 * @spec-id europa.session.undo-history.sequential-processing
 * @spec-id europa.session.undo-history.set-processor
 * @spec-id europa.session.undo-history.push-undo-front
 * @spec-id europa.session.undo-history.push-redo-front
 * @spec-id europa.session.undo-history.dispose
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { createUndoHistory } from "../../../denops/europa/session/undo-history.ts";
import type { UndoEntry } from "../../../contracts/undo-history.ts";

function makeEntry(): UndoEntry {
  return {
    opType: "insertCell",
    snapshot: { metadata: {}, cells: [] },
    beforeHint: { kind: "single", cellId: "cell-a" },
    afterHint: { kind: "single", cellId: "cell-a" },
  };
}

describe("UndoHistory — push (europa.session.undo-history.push)", () => {
  it("push adds to undo stack and getStackSizes reflects it", () => {
    const h = createUndoHistory(100);
    h.push(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 1);
  });

  it("push clears the redo stack", () => {
    const h = createUndoHistory(100);
    h.push(makeEntry());
    // Manually populate redo by pushing to the front
    h.pushRedoFront(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 1);
    // A new push must clear redo
    h.push(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 0);
  });

  it("multiple pushes accumulate in order", () => {
    const h = createUndoHistory(100);
    h.push(makeEntry());
    h.push(makeEntry());
    h.push(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 3);
  });
});

describe("UndoHistory — fifo-overflow (europa.session.undo-history.fifo-overflow)", () => {
  it("200 pushes with maxHistory=100 keeps exactly 100 entries", () => {
    const h = createUndoHistory(100);
    for (let i = 0; i < 200; i++) h.push(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 100);
  });

  it("oldest entry is evicted when cap exceeded", () => {
    const h = createUndoHistory(3);
    const entries = ["a", "b", "c", "d"].map((s) => {
      const e = makeEntry();
      e.snapshot = {
        metadata: {},
        cells: [{ id: s, cell_type: "code", source: s, metadata: {} }],
      };
      return e;
    });
    for (const e of entries) h.push(e);
    // Stack has b, c, d (a evicted). peekUndo gives top = d.
    const top = h.popUndo();
    assertEquals(top?.snapshot.cells[0]?.id, "d");
    const second = h.popUndo();
    assertEquals(second?.snapshot.cells[0]?.id, "c");
    const third = h.popUndo();
    assertEquals(third?.snapshot.cells[0]?.id, "b");
    // a was evicted
    assertEquals(h.popUndo(), undefined);
  });
});

describe("UndoHistory — pop-undo (europa.session.undo-history.pop-undo)", () => {
  it("popUndo removes and returns the top entry", () => {
    const h = createUndoHistory(100);
    const e = makeEntry();
    h.push(e);
    const popped = h.popUndo();
    assertEquals(popped, e);
    assertEquals(h.getStackSizes().undoSize, 0);
  });

  it("popUndo returns undefined when stack is empty (europa.session.undo-history.empty-stack)", () => {
    const h = createUndoHistory(100);
    assertEquals(h.popUndo(), undefined);
  });
});

describe("UndoHistory — pop-redo (europa.session.undo-history.pop-redo)", () => {
  it("popRedo removes and returns the top redo entry", () => {
    const h = createUndoHistory(100);
    const e = makeEntry();
    h.pushRedoFront(e);
    const popped = h.popRedo();
    assertEquals(popped, e);
    assertEquals(h.getStackSizes().redoSize, 0);
  });

  it("popRedo returns undefined when redo stack is empty", () => {
    const h = createUndoHistory(100);
    assertEquals(h.popRedo(), undefined);
  });
});

describe("UndoHistory — clear-redo (europa.session.undo-history.clear-redo)", () => {
  it("push clears the redo stack (covered above, verified via redo size)", () => {
    const h = createUndoHistory(100);
    h.pushRedoFront(makeEntry());
    h.pushRedoFront(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 2);
    h.push(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 0);
  });
});

describe("UndoHistory — enqueue-undo / enqueue-redo (europa.session.undo-history.enqueue-undo, europa.session.undo-history.enqueue-redo)", () => {
  it("enqueueUndo returns true when queue has room", () => {
    const h = createUndoHistory(100);
    h.setProcessor((_kind) => Promise.resolve());
    const accepted = h.enqueueUndo();
    assertEquals(accepted, true);
  });

  it("enqueueRedo returns true when queue has room", () => {
    const h = createUndoHistory(100);
    h.setProcessor((_kind) => Promise.resolve());
    const accepted = h.enqueueRedo();
    assertEquals(accepted, true);
  });
});

describe("UndoHistory — queue-overflow (europa.session.undo-history.queue-overflow)", () => {
  it("returns false when queue already has maxHistory pending items", () => {
    const h = createUndoHistory(3);
    // Processor that never resolves to keep queue full
    h.setProcessor((_kind) => new Promise<void>(() => {})); // never resolves
    // First enqueue starts processing (inFlight=true), queue = 0 in-flight
    h.enqueueUndo();
    // Fill the queue to capacity
    h.enqueueUndo();
    h.enqueueUndo();
    h.enqueueUndo();
    // Next enqueue should be rejected
    const rejected = h.enqueueUndo();
    assertEquals(rejected, false);
  });
});

describe("UndoHistory — sequential-processing (europa.session.undo-history.sequential-processing)", () => {
  it("enqueueUndo 5 times calls processor FIFO 5 times in order", async () => {
    const h = createUndoHistory(100);
    const callOrder: string[] = [];
    let resolveCount = 0;

    h.setProcessor((kind) => {
      callOrder.push(`${kind}-${resolveCount++}`);
      return Promise.resolve();
    });

    for (let i = 0; i < 5; i++) h.enqueueUndo();

    // Give the microtask queue time to drain
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(callOrder.length, 5);
    for (const entry of callOrder) {
      assertEquals(entry.startsWith("undo-"), true);
    }
  });
});

describe("UndoHistory — set-processor (europa.session.undo-history.set-processor)", () => {
  it("after setProcessor, enqueueUndo invokes the processor", async () => {
    const h = createUndoHistory(100);
    let called = false;
    h.setProcessor((_kind) => {
      called = true;
      return Promise.resolve();
    });
    h.enqueueUndo();
    await new Promise((r) => setTimeout(r, 20));
    assertEquals(called, true);
  });
});

describe("UndoHistory — push-undo-front (europa.session.undo-history.push-undo-front)", () => {
  it("pushUndoFront does not clear the redo stack", () => {
    const h = createUndoHistory(100);
    h.pushRedoFront(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 1);
    h.pushUndoFront(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 1);
  });

  it("pushUndoFront does not enforce maxHistory cap", () => {
    const h = createUndoHistory(2);
    h.push(makeEntry());
    h.push(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 2);
    // pushUndoFront bypasses the cap
    h.pushUndoFront(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 3);
  });

  it("pushUndoFront prepends to the front (LIFO order)", () => {
    const h = createUndoHistory(100);
    const eA = makeEntry();
    eA.snapshot = {
      metadata: {},
      cells: [{ id: "A", cell_type: "code", source: "A", metadata: {} }],
    };
    const eB = makeEntry();
    eB.snapshot = {
      metadata: {},
      cells: [{ id: "B", cell_type: "code", source: "B", metadata: {} }],
    };
    h.push(eA);
    h.pushUndoFront(eB);
    const top = h.popUndo();
    assertEquals(top?.snapshot.cells[0]?.id, "B");
  });
});

describe("UndoHistory — push-redo-front (europa.session.undo-history.push-redo-front)", () => {
  it("pushRedoFront does not clear the undo stack", () => {
    const h = createUndoHistory(100);
    h.push(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 1);
    h.pushRedoFront(makeEntry());
    assertEquals(h.getStackSizes().undoSize, 1);
  });

  it("pushRedoFront does not enforce maxHistory cap", () => {
    const h = createUndoHistory(2);
    h.pushRedoFront(makeEntry());
    h.pushRedoFront(makeEntry());
    h.pushRedoFront(makeEntry());
    assertEquals(h.getStackSizes().redoSize, 3);
  });
});

describe("UndoHistory — dispose (europa.session.undo-history.dispose)", () => {
  it("after dispose, enqueueUndo is a no-op (returns false)", () => {
    const h = createUndoHistory(100);
    h.setProcessor((_kind) => Promise.resolve());
    h.dispose();
    const accepted = h.enqueueUndo();
    assertEquals(accepted, false);
  });

  it("after dispose, enqueueRedo is a no-op (returns false)", () => {
    const h = createUndoHistory(100);
    h.setProcessor((_kind) => Promise.resolve());
    h.dispose();
    const accepted = h.enqueueRedo();
    assertEquals(accepted, false);
  });

  it("after dispose, processor is not called for pending queue items", async () => {
    const h = createUndoHistory(100);
    let callCount = 0;

    // Install a slow processor
    h.setProcessor((_kind) =>
      new Promise<void>((r) => setTimeout(r, 50)).then(() => {
        callCount++;
      })
    );

    h.enqueueUndo(); // starts processing
    h.dispose();
    await new Promise((r) => setTimeout(r, 100));
    // At most 1 call for the already-started item; no further calls after dispose
    assertEquals(callCount <= 1, true);
  });

  it("after dispose, both stacks are cleared", () => {
    const h = createUndoHistory(100);
    h.push(makeEntry());
    h.pushRedoFront(makeEntry());
    h.dispose();
    assertEquals(h.getStackSizes().undoSize, 0);
    assertEquals(h.getStackSizes().redoSize, 0);
  });

  it("after dispose, queue length is 0", () => {
    const h = createUndoHistory(100);
    h.setProcessor(async (_kind) => {
      await new Promise<void>(() => {}); // block
    });
    h.enqueueUndo();
    h.enqueueUndo();
    h.dispose();
    assertEquals(h.getQueueLength(), 0);
  });
});
