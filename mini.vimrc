set nocompatible

set runtimepath+=$VIM_PLUGINS_DIR/denops.vim/
if isdirectory($VIM_PLUGINS_DIR .. '/capture.vim')
  set runtimepath+=$VIM_PLUGINS_DIR/capture.vim/ " Optional, for capturing messages
endif

let s:here = expand('<sfile>:p:h')
execute 'set runtimepath+=' .. s:here

let g:denops#debug=1
let g:denops#trace=1

let g:europa_image_backend='sixel' " 'auto', 'sixel', 'kitty', 'iterm2_osc1337'
let g:europa_mime_priority=['image/png', 'image/jpeg', 'text/html', 'text/plain']
let g:europa_max_output_lines=100
let g:europa_cell_border_chars=['╭', '─', '╮', '╰', '╯']
let g:europa_cell_border_align='left'
let g:europa_cell_border_padding=88
let g:europa_lazy_padding=10

let g:europa_jupyter_executable=s:here .. '/tests/.venv/bin/jupyter'
