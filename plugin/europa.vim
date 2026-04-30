if exists('g:loaded_europa')
  finish
endif
let g:loaded_europa = 1

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
  autocmd BufReadCmd *.ipynb call europa#open(str2nr(expand('<abuf>')), expand('<afile>'))
  autocmd BufWriteCmd *.ipynb call europa#save()
  autocmd BufUnload *.ipynb call europa#cleanup(str2nr(expand('<abuf>')))
augroup END
