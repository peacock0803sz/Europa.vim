if exists('b:loaded_europa_ftplugin') | finish | endif
let b:loaded_europa_ftplugin = 1

" Buffer-local u / <C-r> override for ft=europa (FR-004 / SC-007).
" The <buffer> modifier makes these mappings active only in this buffer —
" ftplugin-scope rebind, not a global default override.
" Set g:europa_disable_default_mappings = v:true to opt-out (FR-004).
" `<Plug>(europa-undo)` and `<Plug>(europa-redo)` are inner mappings defined
" with `:nnoremap` in plugin/mappings.vim. The outer wrapper here MUST be
" `:nmap` (recursive) so the `<Plug>` keys actually expand. With `:nnoremap`
" the `<Plug>` is silently consumed and the literal letters of `(europa-undo)`
" leak through to normal mode, where the `u` would trigger native Vim undo
" against this `&modifiable=0` viewer buffer and surface E21.
if !get(g:, 'europa_disable_default_mappings', v:false)
  nmap <buffer><silent> u <Plug>(europa-undo)
  nmap <buffer><silent> <C-r> <Plug>(europa-redo)
endif
