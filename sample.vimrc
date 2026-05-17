set nocompatible

" Required for ftplugin/europa.vim to load (= buffer-local `u` / `<C-r>` undo
" bindings under FR-004). Vim leaves filetype plugin loading off by default;
" Neovim already enables it, which is why Vim hits E21 on `u` while Neovim
" does not when this directive is missing.
filetype plugin on

set runtimepath+=$VIM_PLUGINS_DIR/denops.vim/
if isdirectory($VIM_PLUGINS_DIR .. '/capture.vim')
  set runtimepath+=$VIM_PLUGINS_DIR/capture.vim/ " Optional, for capturing messages
endif

let s:here = expand('<sfile>:p:h')
execute 'set runtimepath+=' .. s:here

" Neovim only: wire the tree-sitter parsers Europa.vim consumes
" (python / markdown / markdown_inline) onto the runtimepath. Europa's
" syntax-highlight pipeline swallows parser-load failures per-cell (FR-006);
" that's good for graceful degradation but means a missing parser is invisible
" to the end user, so we must point Neovim at both the parser .so files and
" the query .scm files explicitly here. Two locations cover both
" nvim-treesitter master (parsers bundled inside the plugin) and main (parsers
" placed under stdpath('data')/treesitter via :TSUpdate).
if has('nvim')
  let s:ts_data_dir = stdpath('data') .. '/treesitter'
  if isdirectory(s:ts_data_dir)
    execute 'set runtimepath+=' .. s:ts_data_dir
  endif

  if isdirectory($VIM_PLUGINS_DIR .. '/nvim-treesitter')
    set runtimepath+=$VIM_PLUGINS_DIR/nvim-treesitter/
  endif

  augroup europa_sample_treesitter
    autocmd!
    autocmd VimEnter * call s:europa_report_parsers()
  augroup END

  function! s:europa_report_parsers() abort
    let l:required = ['python', 'markdown', 'markdown_inline']
    let l:missing = []
    for l:lang in l:required
      " pcall returns (ok, ...); luaeval surfaces the first value only.
      if !luaeval('pcall(vim.treesitter.language.add, _A)', l:lang)
        call add(l:missing, l:lang)
      endif
    endfor
    if !empty(l:missing)
      echohl WarningMsg
      echom 'Europa: tree-sitter parsers unavailable: ' .. join(l:missing, ' ')
      echom 'Europa: install via :TSInstall '
            \ .. join(l:missing, ' ')
            \ .. '  (legacy master branch) or'
            \ .. ' :lua require("nvim-treesitter").install('
            \ .. string(l:missing) .. ')'
            \ .. '  (main branch >= Neovim 0.12); re-open the notebook afterward'
      echohl None
    endif
  endfunction
endif

let g:denops#debug = 1
let g:denops#trace = 1

let g:europa_image_backend = 'sixel' " 'auto', 'sixel', 'kitty', 'iterm2_osc1337'
let g:europa_mime_priority = ['image/png', 'image/jpeg', 'image/svg+xml', 'text/html', 'text/plain']
let g:europa_max_output_lines = 100
let g:europa_cell_border_chars = ['╭', '─', '╮', '╰', '╯']
let g:europa_cell_border_align = 'left'
let g:europa_cell_border_padding = 88
let g:europa_lazy_padding = 10

let g:europa_jupyter_executable = s:here .. '/tests/.venv/bin/jupyter'

" JupyterLab-flavored keymap, scoped to europa buffers only.
" Mappings live inside a FileType autocmd so that <buffer> attaches to the
" actual ipynb buffer set by ftdetect/ipynb.vim, not the startup [No Name].
augroup europa_sample_vimrc_keymap
  autocmd!
  autocmd FileType europa call s:europa_keymap()
augroup END

function! s:europa_keymap() abort
  " Execution (JupyterLab Shift-Enter / Ctrl-Enter / Alt-Enter).
  nmap <buffer><silent> <S-CR> <Plug>(europa-run-cell)
  nmap <buffer><silent> <C-CR> <Plug>(europa-run-cell)
  nmap <buffer><silent> <M-CR> <Plug>(europa-run-cell)<Plug>(europa-insert-code)

  " Cell insertion (JupyterLab A above / B below).
  nmap <buffer><silent> a <Plug>(europa-insert-code-above)
  nmap <buffer><silent> b <Plug>(europa-insert-code)

  " Cell deletion / merge / split (JupyterLab D D / Shift-M / Ctrl-Shift--).
  nmap <buffer><silent> dd <Plug>(europa-delete-cell)
  nmap <buffer><silent> M  <Plug>(europa-join-cell)
  nmap <buffer><silent> -  <Plug>(europa-split-cell)

  " Edit cell body in scratch (JupyterLab Enter to enter edit mode).
  nmap <buffer><silent> <CR> <Plug>(europa-edit-cell)
  nmap <buffer><silent> i    <Plug>(europa-edit-cell)

  " Kernel control (JupyterLab I I interrupt / 0 0 restart).
  nmap <buffer><silent> ii <Plug>(europa-interrupt)
  nmap <buffer><silent> 00 <Plug>(europa-restart-kernel)

  nmap <buffer><silent> <Space> <localleader>
  " Cell type lives under <localleader> so Vim's m / y / r single-key
  " primitives (mark, yank operator, replace-char) stay usable.
  nmap <buffer><silent> <localleader>m <Plug>(europa-celltype-markdown)
  nmap <buffer><silent> <localleader>y <Plug>(europa-celltype-code)
  nmap <buffer><silent> <localleader>r <Plug>(europa-celltype-raw)

  " Auxiliary (no JupyterLab single-key equivalent).
  nmap <buffer><silent> <localleader>R <Plug>(europa-run-all)
  nmap <buffer><silent> <localleader>c <Plug>(europa-cancel-cell)
  nmap <buffer><silent> <localleader>k <Plug>(europa-cell-up)
  nmap <buffer><silent> <localleader>j <Plug>(europa-cell-down)

  " Kernel lifecycle (no JupyterLab single-key equivalent).
  nmap <buffer><silent> <localleader>s <Plug>(europa-start-kernel)
  nmap <buffer><silent> <localleader>q <Plug>(europa-shutdown-kernel)
  nmap <buffer><silent> <localleader>K <Plug>(europa-kernel-status)
endfunction
