if exists('g:loaded_europa')
  finish
endif
let g:loaded_europa = 1

augroup europa_plugin
  autocmd!
  autocmd User DenopsPluginPost:europa call denops#notify('europa', 'init', [])
augroup END
