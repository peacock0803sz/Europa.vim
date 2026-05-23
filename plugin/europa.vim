if exists('g:loaded_europa')
  finish
endif
let g:loaded_europa = 1

" Phase 3.8: text-property types for the traceback line-jump highlight
" groups. Idempotent via prop_type_exists (R9). Only Vim 9.x exposes the
" prop_type_* API; on Neovim these calls are no-ops because the function
" guard short-circuits.
if exists('*prop_type_exists')
  if !prop_type_exists('EuropaErrorJump')
    call prop_type_add('EuropaErrorJump', {'highlight': 'EuropaErrorJump'})
  endif
  if !prop_type_exists('EuropaErrorJumpMissing')
    call prop_type_add('EuropaErrorJumpMissing', {'highlight': 'EuropaErrorJumpMissing'})
  endif
endif

augroup europa_plugin
  autocmd!
  autocmd User DenopsPluginPost:europa call denops#notify('europa', 'init', [])
augroup END

" Static fallback so the first `:edit foo.ipynb` is captured even when denops
" is still booting (denops#notify queues until the plugin registers).
" setupAutocmds() in denops/europa/session/events.ts re-registers identical
" entries inside the init handler — same group, autocmd! resets, no double-fire.
augroup europa_ipynb
  autocmd!
  autocmd BufReadCmd *.ipynb setfiletype europa | call europa#open(str2nr(expand('<abuf>')), expand('<afile>'))
  autocmd BufWriteCmd *.ipynb call europa#save()
  autocmd BufUnload *.ipynb call europa#cleanup(str2nr(expand('<abuf>')))
augroup END
