# Europa.vim

![artwork](https://img.p3ac0ck.net/figs/europa-vim.png)

A Vim and Neovim plugin that orbits Jupyter. It runs on Deno, keeps Python off the host, and edits `.ipynb` files directly.

See [`:help europa`](./doc/europa.txt) for details. A runnable JupyterLab-flavored sample config lives in [`sample.vimrc`](./sample.vimrc); see also [`:help europa-jupyterlab-mappings`](./doc/europa-mappings.txt).

## Why Europa.vim

Europa is Jupiter's second moon: icy, quiet, always close. Europa.vim brings the same idea into your editor. It puts Vim and Neovim in orbit around a Jupyter kernel without dragging Python onto the host or pulling you out of `:edit`. The notebook stays an `.ipynb`. Your editor stays your editor.

## Differentiators

- Python stays off the host. Europa.vim runs on Deno through [denops.vim](https://github.com/vim-denops/denops.vim), so `pip install` is never required on the editor side. The plugin only spawns `jupyter` from your project environment, auto-detecting `.venv/`, `VIRTUAL_ENV`, and `CONDA_PREFIX`.
- Works in both Vim and Neovim. Most Jupyter integrations like molten-nvim, magma-nvim, and jupynium.nvim are Neovim-only. Europa.vim targets both through denops.
- You edit `.ipynb` directly. No conversion to `.py` the way jupytext does it, and no sidecar directories the way vim-jukit leaves behind.
- Outputs, metadata, and attachments survive. Europa.vim round-trips the notebook through a canonical form, so existing cell outputs and metadata are preserved across `:w`.

## Features

### Available today

- Open and view `.ipynb` notebooks with cell boundaries
- Tree-sitter syntax highlighting per cell language
- Cell operations: insert, delete, edit, move, split, join, change type
- Kernel lifecycle: start, shutdown, restart, interrupt, status
- Run the current cell, run all, or cancel a running cell
- Undo and redo across notebook edits
- Render text, JSON, Markdown, and ANSI-colored tracebacks

### In progress

- Image rendering through Sixel and Kitty Unicode Placeholder
- Streaming output polish, including iopub batching and large-output handling

### Planned

- Extended MIME types: Vega-Lite, PDF, LaTeX
- Direct ZMQ kernel connection as an opt-in, bypassing Jupyter Server
- `ipywidgets` over the comm channel

## Requirements

- Vim 9.1.1646 or later
- Neovim 0.11.3 or later
- Deno 2.3.0 or later
- denops.vim, latest
- A `jupyter` command available in your environment, providing `jupyter_server` and `ipykernel`
