if exists('g:loaded_europa_mappings')
  finish
endif
let g:loaded_europa_mappings = 1

" Insertion (3 mappings)
nnoremap <silent> <Plug>(europa-insert-code)     :<C-u>EuropaInsertCell code<CR>
nnoremap <silent> <Plug>(europa-insert-markdown) :<C-u>EuropaInsertCell markdown<CR>
nnoremap <silent> <Plug>(europa-insert-raw)      :<C-u>EuropaInsertCell raw<CR>

" Deletion / motion (3 mappings)
nnoremap <silent> <Plug>(europa-delete-cell)     :<C-u>EuropaDeleteCell<CR>
nnoremap <silent> <Plug>(europa-cell-up)         :<C-u>EuropaMoveCellUp<CR>
nnoremap <silent> <Plug>(europa-cell-down)       :<C-u>EuropaMoveCellDown<CR>

" Edit / split / join (3 mappings)
nnoremap <silent> <Plug>(europa-edit-cell)       :<C-u>EuropaEditCell<CR>
nnoremap <silent> <Plug>(europa-split-cell)      :<C-u>EuropaSplitCell<CR>
nnoremap <silent> <Plug>(europa-join-cell)       :<C-u>EuropaJoinCell<CR>

" Phase 3.3: kernel execution (run-cell implemented)
nnoremap <silent> <Plug>(europa-run-cell)        :<C-u>EuropaRunCell<CR>
