if exists('b:loaded_europa_ftplugin') | finish | endif
let b:loaded_europa_ftplugin = 1

" Buffer-local u / <C-r> override for ft=europa (FR-004 / SC-007).
" The <buffer> modifier makes these mappings active only in this buffer —
" ftplugin-scope rebind, not a global default override.
" Set g:europa_disable_default_mappings = v:true to opt-out (FR-004).
if !get(g:, 'europa_disable_default_mappings', v:false)
  nnoremap <buffer><silent> u <Plug>(europa-undo)
  nnoremap <buffer><silent> <C-r> <Plug>(europa-redo)
endif
