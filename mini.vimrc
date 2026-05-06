set nocompatible

set runtimepath+=$VIM_PLUGINS_DIR/denops.vim/
if isdirectory($VIM_PLUGINS_DIR .. '/capture.vim')
  set runtimepath+=$VIM_PLUGINS_DIR/capture.vim/ " Optional, for capturing messages
endif

let s:here = expand('<sfile>:p:h')
execute 'set runtimepath+=' .. s:here

let g:denops#debug = 1
let g:denops#trace = 1

let g:europa_image_backend = 'sixel' " 'auto', 'sixel', 'kitty', 'iterm2_osc1337'
let g:europa_mime_priority = ['image/png', 'image/jpeg', 'text/html', 'text/plain']
let g:europa_max_output_lines = 100
let g:europa_cell_border_chars = ['╭', '─', '╮', '╰', '╯']
let g:europa_cell_border_align = 'left'
let g:europa_cell_border_padding = 88
let g:europa_lazy_padding = 10

let g:europa_jupyter_executable = s:here .. '/tests/.venv/bin/jupyter'

" JupyterLab-flavored keymap, scoped to europa buffers only.
" Mappings live inside a FileType autocmd so that <buffer> attaches to the
" actual ipynb buffer set by ftdetect/ipynb.vim, not the startup [No Name].
augroup europa_mini_vimrc_keymap
  autocmd!
  autocmd FileType europa call s:europa_keymap()
augroup END

function! s:europa_keymap() abort
  " Execution (JupyterLab Shift-Enter / Ctrl-Enter / Alt-Enter).
  nmap <buffer><silent> <S-CR> <Plug>(europa-run-cell)
  nmap <buffer><silent> <C-CR> <Plug>(europa-run-cell)
  nmap <buffer><silent> <M-CR> <Plug>(europa-run-cell)<Plug>(europa-insert-code)

  " Cell insertion (JupyterLab A above / B below).
  nnoremap <buffer><silent> a :<C-u>EuropaInsertCell! code<CR>
  nmap     <buffer><silent> b <Plug>(europa-insert-code)

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
  nnoremap <buffer><silent> <localleader>m :<C-u>EuropaCellType markdown<CR>
  nnoremap <buffer><silent> <localleader>y :<C-u>EuropaCellType code<CR>
  nnoremap <buffer><silent> <localleader>r :<C-u>EuropaCellType raw<CR>

  " Auxiliary (no JupyterLab single-key equivalent).
  nmap <buffer><silent> <localleader>R <Plug>(europa-run-all)
  nmap <buffer><silent> <localleader>c <Plug>(europa-cancel-cell)
  nmap <buffer><silent> <localleader>k <Plug>(europa-cell-up)
  nmap <buffer><silent> <localleader>j <Plug>(europa-cell-down)

  " Kernel lifecycle (no JupyterLab single-key equivalent).
  nnoremap <buffer><silent> <localleader>s :<C-u>EuropaStartKernel<CR>
  nnoremap <buffer><silent> <localleader>q :<C-u>EuropaShutdownKernel<CR>
  nnoremap <buffer><silent> <localleader>K :<C-u>EuropaKernelStatus<CR>
endfunction
