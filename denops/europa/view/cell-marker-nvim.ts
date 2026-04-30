/**
 * Neovim extmark-based cell marker.
 *
 * @category View
 */

import type { Denops } from "@denops/std";
import type { CellMarker, MarkerId } from "../../../contracts/cell-marker.ts";

/**
 * CellMarker implementation for Neovim using the `nvim_buf_set_extmark` API.
 *
 * @spec-id europa.view.cell-marker.nvim
 */
export class NvimCellMarker implements CellMarker {
  private _host?: Denops;
  private _nsId?: number;
  private readonly _markers = new Map<
    number,
    Array<{ lnum: number; label: string; kind: "head" | "output" }>
  >();

  async init(host: Denops): Promise<void> {
    this._host = host;
    if (this._nsId !== undefined) return;
    this._nsId = (await host.call(
      "nvim_create_namespace",
      "Europa",
    )) as number;
  }

  async setHead(
    bufnr: number,
    lnum: number,
    label: string,
  ): Promise<MarkerId> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, kind: "head" });
    this._markers.set(bufnr, recs);
    const id = (await this._host!.call(
      "nvim_buf_set_extmark",
      bufnr,
      this._nsId!,
      lnum - 1,
      0,
      { virt_lines: [[[label, "EuropaCellHeader"]]] },
    )) as MarkerId | null;
    return id ?? 0;
  }

  async setOutputBoundary(
    bufnr: number,
    lnum: number,
    label = "",
  ): Promise<MarkerId> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, kind: "output" });
    this._markers.set(bufnr, recs);
    const id = (await this._host!.call(
      "nvim_buf_set_extmark",
      bufnr,
      this._nsId!,
      lnum - 1,
      0,
      { virt_lines: [[[label, "EuropaCellFooter"]]] },
    )) as MarkerId | null;
    return id ?? 0;
  }

  async clear(bufnr: number, _ids?: MarkerId[]): Promise<void> {
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
