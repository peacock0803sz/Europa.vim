" denops#notify throws E605 (`Channel is not ready yet`) when called before
" the plugin finishes registering. denops#plugin#wait_async defers the call
" without blocking Vim — safe for autocmds that may fire during boot.

function! europa#open(bufnr, path) abort
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'open', [a:bufnr, a:path]) })
endfunction

function! europa#save() abort
  let l:bufnr = bufnr('%')
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'save', [l:bufnr]) })
endfunction

function! europa#preview_output(cell_idx, output_idx) abort
  let l:bufnr = bufnr('%')
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'previewOutput',
        \                    [l:bufnr, a:cell_idx, a:output_idx]) })
endfunction

function! europa#cleanup(bufnr) abort
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'cleanup', [a:bufnr]) })
endfunction

" Insert a new cell. bang=1 means 'before', bang=0 means 'after'.
" type is the first extra argument (e.g. 'code', 'markdown', 'raw').
function! europa#insert_cell(bang, ...) abort
  let l:type = get(a:000, 0, 'code')
  let l:position = a:bang ? 'before' : 'after'
  let l:anchor = europa#current_cell_id()
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'insertCell',
        \                    [l:bufnr, l:type, l:position, l:anchor]) })
endfunction

" Delete the cell at the cursor in the current viewer buffer.
function! europa#delete_cell() abort
  let l:cell_id = europa#current_cell_id()
  if type(l:cell_id) == v:t_string && l:cell_id ==# ''
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  if l:cell_id is v:null
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'deleteCell', [l:bufnr, l:cell_id]) })
endfunction

" Move the cell at the cursor up or down (swap with the adjacent cell).
" direction is 'up' or 'down'. Boundary cases (first cell + 'up' / last cell
" + 'down') surface guidance via :messages from the dispatcher.
function! europa#move_cell(direction) abort
  let l:cell_id = europa#current_cell_id()
  if type(l:cell_id) == v:t_string && l:cell_id ==# ''
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  if l:cell_id is v:null
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'moveCell',
        \                    [l:bufnr, l:cell_id, a:direction]) })
endfunction

" Split the cell at the cursor at the current line.
" Unlike other helpers, this passes bufnr('%') as-is so the dispatcher can
" detect viewer vs scratch context and resolve the line accordingly
" (see Phase 3.1 splitCell contract, Codex review H2-r2).
function! europa#split_cell() abort
  let l:cell_id = europa#current_cell_id()
  if type(l:cell_id) == v:t_string && l:cell_id ==# ''
    echohl WarningMsg | echom 'Europa: No cell at cursor for split' | echohl None
    return
  endif
  if l:cell_id is v:null
    echohl WarningMsg | echom 'Europa: No cell at cursor for split' | echohl None
    return
  endif
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'splitCell',
        \                    [bufnr('%'), l:cell_id, line('.')]) })
endfunction

" Join the cell at the cursor with the previous cell.
function! europa#join_cell() abort
  let l:cell_id = europa#current_cell_id()
  if type(l:cell_id) == v:t_string && l:cell_id ==# ''
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  if l:cell_id is v:null
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'joinCell', [l:bufnr, l:cell_id]) })
endfunction

" Open (or refocus) a scratch buffer to edit the cell at the cursor.
function! europa#edit_cell() abort
  let l:cell_id = europa#current_cell_id()
  if type(l:cell_id) == v:t_string && l:cell_id ==# ''
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  if l:cell_id is v:null
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'editCell', [l:bufnr, l:cell_id]) })
endfunction

" Change the type of the cell at the cursor to code, markdown, or raw.
function! europa#change_cell_type(type) abort
  let l:valid_types = ['code', 'markdown', 'raw']
  if index(l:valid_types, a:type) == -1
    echohl WarningMsg | echom 'Europa: invalid cell type: ' . a:type | echohl None
    return
  endif
  let l:cell_id = europa#current_cell_id()
  if type(l:cell_id) == v:t_string && l:cell_id ==# ''
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  if l:cell_id is v:null
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'changeCellType',
        \                    [l:bufnr, l:cell_id, a:type]) })
endfunction

" Start (or reconnect to) the kernel for the current buffer.
" name: kernel name to start; falls back to g:europa_default_kernel when empty.
function! europa#start_kernel(name, ...) abort
  let l:name = empty(a:name)
        \ ? get(g:, 'europa_default_kernel', 'python3')
        \ : a:name
  let l:bufnr = get(a:000, 0, bufnr('%'))
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'startKernel', [l:bufnr, l:name]) })
endfunction

" Shut down the kernel attached to the current buffer.
function! europa#shutdown_kernel() abort
  let l:bufnr = bufnr('%')
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'shutdownKernel', [l:bufnr]) })
endfunction

" Returns the cell id at the cursor.
" In a scratch edit buffer, reads b:europa_cell_id directly.
" Otherwise, makes a synchronous RPC to lineToCellId.
function! europa#current_cell_id() abort
  if exists('b:europa_cell_id')
    return b:europa_cell_id
  endif
  return denops#request('europa', 'lineToCellId', [bufnr('%'), line('.')])
endfunction

" Returns the viewer buffer number for the current context.
" In a scratch edit buffer, reads b:europa_viewer_bufnr directly.
" Otherwise, returns the current buffer number (the viewer itself).
function! europa#current_viewer_bufnr() abort
  if exists('b:europa_viewer_bufnr')
    return b:europa_viewer_bufnr
  endif
  return bufnr('%')
endfunction
