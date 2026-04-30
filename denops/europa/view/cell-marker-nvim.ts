/**
 * Neovim extmark-based cell marker.
 *
 * @category View
 * @spec-id europa.view.cell-marker.nvim
 */

import type { Denops } from "@denops/std";
import type { CellMarker } from "./cell-marker.ts";

type ExtmarkRecord = {
  lnum: number;
  label: string;
  kind: "head" | "output";
};

/**
 * CellMarker implementation for Neovim using the `nvim_buf_set_extmark` API.
 *
 * @spec-id europa.view.cell-marker.nvim
 */
export class NvimCellMarker implements CellMarker {
  private _host?: Denops;
  private _nsId?: number;
  private readonly _markers = new Map<number, ExtmarkRecord[]>();

  async init(host: Denops): Promise<void> {
    this._host = host;
    if (this._nsId !== undefined) return;
    this._nsId = (await host.call(
      "nvim_create_namespace",
      "Europa",
    )) as number;
  }

  async setHead(bufnr: number, lnum: number, label: string): Promise<void> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, kind: "head" });
    this._markers.set(bufnr, recs);
    await this._host!.call(
      "nvim_buf_set_extmark",
      bufnr,
      this._nsId!,
      lnum - 1,
      0,
      { virt_lines: [[[label, "EuropaCellHead"]]] },
    );
  }

  async setOutputBoundary(
    bufnr: number,
    lnum: number,
    label = "",
  ): Promise<void> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, kind: "output" });
    this._markers.set(bufnr, recs);
    await this._host!.call(
      "nvim_buf_set_extmark",
      bufnr,
      this._nsId!,
      lnum - 1,
      0,
      { virt_lines: [[[label, "EuropaCellOut"]]] },
    );
  }

  async clear(bufnr: number): Promise<void> {
    await this._host!.call(
      "nvim_buf_clear_namespace",
      bufnr,
      this._nsId!,
      0,
      -1,
    );
    this._markers.delete(bufnr);
  }

  async refresh(bufnr: number): Promise<void> {
    const saved = this._markers.get(bufnr) ?? [];
    await this.clear(bufnr);
    for (const rec of saved) {
      if (rec.kind === "head") {
        await this.setHead(bufnr, rec.lnum, rec.label);
      } else {
        await this.setOutputBoundary(bufnr, rec.lnum, rec.label);
      }
    }
  }
}
