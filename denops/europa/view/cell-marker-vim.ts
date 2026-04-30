/**
 * Vim text-property based cell marker.
 *
 * @category View
 */

import type { Denops } from "@denops/std";
import type { CellMarker, MarkerId } from "../../../contracts/cell-marker.ts";

const PROP_TYPES = ["EuropaCellHeader", "EuropaCellFooter"] as const;

/**
 * CellMarker implementation for Vim using the `prop_*` text-property API.
 *
 * @spec-id europa.view.cell-marker.vim
 */
export class VimCellMarker implements CellMarker {
  private _host?: Denops;
  private readonly _markers = new Map<
    number,
    Array<{ lnum: number; label: string; propType: string }>
  >();

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

  async setHead(
    bufnr: number,
    lnum: number,
    label: string,
  ): Promise<MarkerId> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, propType: "EuropaCellHeader" });
    this._markers.set(bufnr, recs);
    const id = (await this._host!.call("prop_add", lnum, 0, {
      type: "EuropaCellHeader",
      bufnr,
      text: label,
    })) as MarkerId | null;
    return id ?? 0;
  }

  async setOutputBoundary(
    bufnr: number,
    lnum: number,
    label = "",
  ): Promise<MarkerId> {
    const recs = this._markers.get(bufnr) ?? [];
    recs.push({ lnum, label, propType: "EuropaCellFooter" });
    this._markers.set(bufnr, recs);
    const id = (await this._host!.call("prop_add", lnum, 0, {
      type: "EuropaCellFooter",
      bufnr,
      text: label,
    })) as MarkerId | null;
    return id ?? 0;
  }

  async clear(bufnr: number, _ids?: MarkerId[]): Promise<void> {
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
