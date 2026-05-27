if exists('g:loaded_europa_mappings')
  finish
endif
let g:loaded_europa_mappings = 1

" Insertion (insert below — append after current cell)
nnoremap <silent> <Plug>(europa-insert-code)           :<C-u>EuropaInsertCell code<CR>
nnoremap <silent> <Plug>(europa-insert-markdown)       :<C-u>EuropaInsertCell markdown<CR>
nnoremap <silent> <Plug>(europa-insert-raw)            :<C-u>EuropaInsertCell raw<CR>

" Insertion (insert above — :EuropaInsertCell! bang variant)
nnoremap <silent> <Plug>(europa-insert-code-above)     :<C-u>EuropaInsertCell! code<CR>
nnoremap <silent> <Plug>(europa-insert-markdown-above) :<C-u>EuropaInsertCell! markdown<CR>
nnoremap <silent> <Plug>(europa-insert-raw-above)      :<C-u>EuropaInsertCell! raw<CR>

" Deletion / motion
nnoremap <silent> <Plug>(europa-delete-cell)           :<C-u>EuropaDeleteCell<CR>
nnoremap <silent> <Plug>(europa-cell-up)               :<C-u>EuropaMoveCellUp<CR>
nnoremap <silent> <Plug>(europa-cell-down)             :<C-u>EuropaMoveCellDown<CR>

" Edit / split / join
nnoremap <silent> <Plug>(europa-edit-cell)             :<C-u>EuropaEditCell<CR>
nnoremap <silent> <Plug>(europa-split-cell)            :<C-u>EuropaSplitCell<CR>
nnoremap <silent> <Plug>(europa-join-cell)             :<C-u>EuropaJoinCell<CR>

" Cell type change (one <Plug> per type, since <Plug> cannot take arguments)
nnoremap <silent> <Plug>(europa-celltype-code)         :<C-u>EuropaCellType code<CR>
nnoremap <silent> <Plug>(europa-celltype-markdown)     :<C-u>EuropaCellType markdown<CR>
nnoremap <silent> <Plug>(europa-celltype-raw)          :<C-u>EuropaCellType raw<CR>

" Kernel execution
nnoremap <silent> <Plug>(europa-run-cell)              :<C-u>EuropaRunCell<CR>
nnoremap <silent> <Plug>(europa-run-all)               :<C-u>EuropaRunAll<CR>
nnoremap <silent> <Plug>(europa-cancel-cell)           :<C-u>EuropaCancelCell<CR>
nnoremap <silent> <Plug>(europa-interrupt)             :<C-u>EuropaInterrupt<CR>
nnoremap <silent> <Plug>(europa-restart-kernel)        :<C-u>EuropaRestartKernel<CR>

" Kernel lifecycle (start uses default kernel — pass an arg via :EuropaStartKernel for non-default)
nnoremap <silent> <Plug>(europa-start-kernel)          :<C-u>EuropaStartKernel<CR>
nnoremap <silent> <Plug>(europa-shutdown-kernel)       :<C-u>EuropaShutdownKernel<CR>
nnoremap <silent> <Plug>(europa-kernel-status)         :<C-u>EuropaKernelStatus<CR>

" Phase 008: undo / redo <Plug> mappings — global, buffer-local rebind in ftplugin/europa.vim (T013)
nnoremap <silent> <Plug>(europa-undo)                  :call denops#notify('europa', 'europaUndo', [bufnr('%')])<CR>
nnoremap <silent> <Plug>(europa-redo)                  :call denops#notify('europa', 'europaRedo', [bufnr('%')])<CR>

" Phase 3.8: traceback line jump — no default key binding (FR-022)
nnoremap <silent> <Plug>(europa-jump-error)            :<C-u>EuropaJumpError<CR>
nnoremap <silent> <Plug>(europa-jump-error-list)       :<C-u>EuropaJumpErrorList<CR>
