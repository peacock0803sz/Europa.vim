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
