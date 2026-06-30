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

command! -nargs=0 EuropaEditCell
      \ call europa#edit_cell()

command! -nargs=0 EuropaMoveCellUp
      \ call europa#move_cell('up')

command! -nargs=0 EuropaMoveCellDown
      \ call europa#move_cell('down')

command! -nargs=0 EuropaSplitCell
      \ call europa#split_cell()

command! -nargs=0 EuropaJoinCell
      \ call europa#join_cell()

command! -nargs=1 EuropaCellType
      \ call europa#change_cell_type(<f-args>)

command! -nargs=? EuropaStartKernel
      \ call europa#start_kernel(<q-args>)

command! -nargs=0 EuropaShutdownKernel
      \ call europa#shutdown_kernel()

command! -nargs=0 EuropaKernelStatus
      \ call europa#kernel_status()

command! -nargs=0 EuropaCommStatus
      \ call europa#comm_status(bufnr('%'))

command! -nargs=0 EuropaRunCell
      \ call europa#run_cell()
command! -nargs=0 EuropaRunAll
      \ call europa#run_all()
command! -nargs=0 EuropaCancelCell
      \ call europa#cancel_cell()
command! -nargs=0 EuropaInterrupt
      \ call europa#interrupt()
command! -nargs=0 EuropaRestartKernel
      \ call europa#restart_kernel()

" Phase 008: undo / redo (T012)
command! -nargs=0 EuropaUndo
      \ call denops#notify('europa', 'europaUndo', [bufnr('%')])
command! -nargs=0 EuropaRedo
      \ call denops#notify('europa', 'europaRedo', [bufnr('%')])

" Phase 3.8: traceback line jump
command! -nargs=0 EuropaJumpError
      \ call europa#jump_error()
command! -nargs=0 EuropaJumpErrorList
      \ call europa#jump_error_list()
