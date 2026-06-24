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

" Attach to an externally-started kernel from a Jupyter connection file.
" path: connection.json path passed to :EuropaAttach (required).
function! europa#attach_kernel(path) abort
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'attachKernel', [l:bufnr, a:path]) })
endfunction

" Shut down the kernel attached to the current buffer.
function! europa#shutdown_kernel() abort
  let l:bufnr = bufnr('%')
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'shutdownKernel', [l:bufnr]) })
endfunction

" Display kernel connection status for the current buffer via :messages.
" Prints info, WebSocket state, reconnect progress, and server refcount.
" When no kernel is attached, prints a startup guidance message instead.
function! europa#kernel_status() abort
  let l:bufnr = bufnr('%')
  call denops#plugin#wait_async('europa', { ->
        \ s:show_kernel_status(l:bufnr) })
endfunction

function! s:show_kernel_status(bufnr) abort
  let l:report = denops#request('europa', 'kernelStatus', [a:bufnr])
  if type(l:report) != v:t_dict || l:report.info is v:null
    echom 'Europa: No kernel attached to this buffer. Use :EuropaStartKernel to start one.'
    return
  endif
  let l:info = l:report.info
  let l:lines = []
  call add(l:lines, 'Kernel: ' . l:info.kernelName . ' (' . l:info.kernelId . ')')
  call add(l:lines, 'State:  ' . l:info.state . ' | WS: ' . l:report.wsState)
  if has_key(l:report, 'reconnect') && type(l:report.reconnect) == v:t_dict
    call add(l:lines, 'Reconnect: ' . l:report.reconnect.retry . '/' . l:report.reconnect.max)
  endif
  if has_key(l:info, 'languageInfo') && type(l:info.languageInfo) == v:t_dict
    call add(l:lines, 'Language: ' . l:info.languageInfo.name . ' ' . l:info.languageInfo.version)
  endif
  if has_key(l:report, 'serverRefcount')
    call add(l:lines, 'Server refcount: ' . l:report.serverRefcount)
  endif
  for l:line in l:lines
    echom 'Europa: ' . l:line
  endfor
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

function! europa#interrupt() abort
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'interruptKernel', [l:bufnr]) })
endfunction

function! europa#restart_kernel() abort
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'restartKernel', [l:bufnr]) })
endfunction

function! europa#run_cell() abort
  let l:bufnr = europa#current_viewer_bufnr()
  let l:cell_id = europa#current_cell_id()
  if empty(l:cell_id)
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'runCell', [l:bufnr, l:cell_id]) })
endfunction

" Execute all code cells in order from top to bottom.
function! europa#run_all() abort
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'runAll', [l:bufnr]) })
endfunction

" Cancel a queued cell without sending a network message.
function! europa#cancel_cell() abort
  let l:bufnr = europa#current_viewer_bufnr()
  let l:cell_id = europa#current_cell_id()
  if empty(l:cell_id)
    echohl WarningMsg | echom 'Europa: No cell at cursor' | echohl None
    return
  endif
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'cancelCell', [l:bufnr, l:cell_id]) })
endfunction

" Phase 3.8: jump to the traceback frame under the cursor.  Reads
" line('.') / col('.') eagerly so the values capture the cursor at
" invocation time even if denops dispatches the RPC after a context
" switch.  No-op when there is no clickable at the cursor — dispatcher
" handles the silent fallback (FR-014).
function! europa#jump_error() abort
  let l:bufnr = europa#current_viewer_bufnr()
  let l:line = line('.')
  let l:col = col('.')
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'jumpToTraceback',
        \                    [l:bufnr, l:line, l:col]) })
endfunction

" Phase 3.8: populate the quickfix list with every actionable traceback
" frame from the cached RenderPlan. Does NOT open the qf window — the
" user invokes :copen / :cnext explicitly so they retain control of
" their layout (US3 AC2).
function! europa#jump_error_list() abort
  let l:bufnr = europa#current_viewer_bufnr()
  call denops#plugin#wait_async('europa',
        \ { -> denops#notify('europa', 'jumpToTracebackList', [l:bufnr]) })
endfunction
