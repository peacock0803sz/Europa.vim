if exists('g:loaded_europa_commands')
  finish
endif
let g:loaded_europa_commands = 1

command! -nargs=? -complete=file EuropaOpen
      \ call europa#open(empty(<q-args>) ? expand('%:p') : <q-args>)

command! -nargs=+ EuropaPreviewOutput
      \ call europa#preview_output(<f-args>)
