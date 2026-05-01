if exists('g:loaded_europa_commands')
  finish
endif
let g:loaded_europa_commands = 1

command! -nargs=? -complete=file EuropaOpen
      \ call europa#open(bufnr('%'), empty(<q-args>) ? expand('%:p') : <q-args>)

command! -nargs=+ EuropaPreviewOutput
      \ call europa#preview_output(<f-args>)

command! -nargs=1 -bang EuropaInsertCell
      \ call europa#insert_cell(<bang>0, <f-args>)

command! -nargs=0 EuropaDeleteCell
      \ call europa#delete_cell()
