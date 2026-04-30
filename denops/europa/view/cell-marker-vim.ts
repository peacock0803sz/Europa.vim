/**
 * Vim text-property based cell marker.
 *
 * @category View
 * @spec-id europa.view.cell-marker.vim
 */

import type { Denops } from "@denops/std";
import type { CellMarker } from "./cell-marker.ts";

const PROP_TYPES = ["EuropaCellHead", "EuropaCellOut"] as const;
type PropType = (typeof PROP_TYPES)[number];

type MarkerRecord = {
  lnum: number;
  label: string;
  propType: PropType;
};

/**
 * CellMarker implementation for Vim using the `prop_*` text-property API.
 *
 * @spec-id europa.view.cell-marker.vim
 */
export class VimCellMarker implements CellMarker {
  private _host?: Denops;
  private readonly _markers = new Map<number, MarkerRecord[]>();

  async init(host: Denops): Promise<void> {
    this._host = host;
    const existing =
      ((await host.eval("prop_type_list()")) as string[] | null) ?? [];
    for (const name of PROP_TYPES) {
      if (!existing.includes(name)) {
        await host.call("prop_type_add", name, {
          highlight: name,
          combine: true,
        });
      }
    }
  }

  async setHead(bufnr: number, lnum: number, label: string): Promise<void> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, propType: "EuropaCellHead" });
    this._markers.set(bufnr, recs);
    await this._host!.call("prop_add", lnum, 0, {
      type: "EuropaCellHead",
      bufnr,
      text: label,
    });
  }

  async setOutputBoundary(
    bufnr: number,
    lnum: number,
    label = "",
  ): Promise<void> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, propType: "EuropaCellOut" });
    this._markers.set(bufnr, recs);
    await this._host!.call("prop_add", lnum, 0, {
      type: "EuropaCellOut",
      bufnr,
      text: label,
    });
  }

  async clear(bufnr: number): Promise<void> {
    for (const name of PROP_TYPES) {
      await this._host!.call("prop_remove", { type: name, bufnr, all: true });
    }
    this._markers.delete(bufnr);
  }

  async refresh(bufnr: number): Promise<void> {
    const saved = this._markers.get(bufnr) ?? [];
    await this.clear(bufnr);
    for (const rec of saved) {
      await this._host!.call("prop_add", rec.lnum, 0, {
        type: rec.propType,
        bufnr,
        text: rec.label,
      });
    }
  }
}
